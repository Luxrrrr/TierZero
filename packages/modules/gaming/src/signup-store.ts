import { prisma, type SignupEntry, type SignupEvent, type SignupMember } from "@tier0/db";
import { placementFor, promotions } from "./signup-logic.js";

/**
 * Sign-ups, their entries and the waitlist. Registering and withdrawing run in
 * one transaction with the write first, so the count that decides whether
 * someone gets a place is never stale.
 */

export type EntryWithMembers = SignupEntry & { members: SignupMember[] };
export type EventWithEntries = SignupEvent & { entries: EntryWithMembers[] };

const ENTRIES = { entries: { orderBy: { id: "asc" as const }, include: { members: { orderBy: { id: "asc" as const } } } } };

export interface NewEvent {
  guildId: string;
  channelId: string;
  title: string;
  game: string;
  note: string;
  startsAt: Date | null;
  teamSize: number;
  capacity: number;
  waitlist: boolean;
  requiredRoles: string[];
  rewardRoleId: string | null;
  createdById: string;
}

export function createEvent(event: NewEvent): Promise<EventWithEntries> {
  return prisma.signupEvent.create({ data: { ...event, requiredRoles: JSON.stringify(event.requiredRoles) }, include: ENTRIES });
}

export function eventById(guildId: string, id: number): Promise<EventWithEntries | null> {
  return prisma.signupEvent.findFirst({ where: { id, guildId }, include: ENTRIES });
}

export function attachMessage(id: number, messageId: string): Promise<SignupEvent> {
  return prisma.signupEvent.update({ where: { id }, data: { messageId } });
}

export async function discardEvent(id: number): Promise<void> {
  await prisma.signupEvent.deleteMany({ where: { id } });
}

export function eventsOf(guildId: string, status?: "open" | "closed"): Promise<SignupEvent[]> {
  return prisma.signupEvent.findMany({ where: { guildId, ...(status ? { status } : {}) }, orderBy: { id: "desc" }, take: 25 });
}

export function requiredRolesOf(event: Pick<SignupEvent, "requiredRoles">): string[] {
  try {
    const parsed: unknown = JSON.parse(event.requiredRoles);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Stops sign-ups. Conditional, so closing twice answers the second time that it was already closed. */
export async function closeEvent(id: number): Promise<boolean> {
  const closed = await prisma.signupEvent.updateMany({ where: { id, status: "open" }, data: { status: "closed", closedAt: new Date() } });
  return closed.count === 1;
}

export async function markReminded(id: number): Promise<boolean> {
  const marked = await prisma.signupEvent.updateMany({ where: { id, reminderSent: false, status: "open" }, data: { reminderSent: true } });
  return marked.count === 1;
}

export type RegisterOutcome =
  | { ok: true; entry: EntryWithMembers; placement: "registered" | "waitlist" }
  | { ok: false; code: "gone" | "closed" | "full" | "taken"; userId?: string };

class Rollback extends Error {
  constructor(readonly code: "full") {
    super(code);
  }
}

/** Puts a player or a team on a sign-up. The first of `members` is the captain. */
export async function register(guildId: string, eventId: number, members: string[], teamName: string): Promise<RegisterOutcome> {
  const captainId = members[0];
  if (!captainId) return { ok: false, code: "gone" };
  try {
    return await prisma.$transaction(async (tx) => {
      const event = await tx.signupEvent.findFirst({ where: { id: eventId, guildId } });
      if (!event) return { ok: false, code: "gone" } as const;
      if (event.status !== "open") return { ok: false, code: "closed" } as const;

      // Provisionally on the waitlist: the write takes the lock, then the count below is the real one.
      const created = await tx.signupEntry.create({ data: { eventId, captainId, teamName, status: "waitlist" } });
      await tx.signupMember.createMany({ data: members.map((userId) => ({ entryId: created.id, eventId, userId })) });

      const registered = await tx.signupEntry.count({ where: { eventId, status: "registered" } });
      const placement = placementFor(registered, event.capacity, event.waitlist);
      if (placement === "full") throw new Rollback("full");
      const entry = placement === "registered" ? await tx.signupEntry.update({ where: { id: created.id }, data: { status: "registered" } }) : created;
      const rows = await tx.signupMember.findMany({ where: { entryId: created.id }, orderBy: { id: "asc" } });
      return { ok: true, entry: { ...entry, members: rows }, placement } as const;
    });
  } catch (error) {
    if (error instanceof Rollback) return { ok: false, code: "full" };
    if (isUnique(error)) {
      const taken = await prisma.signupMember.findFirst({ where: { eventId, userId: { in: members } } });
      return { ok: false, code: "taken", ...(taken ? { userId: taken.userId } : {}) };
    }
    throw error;
  }
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

export interface WithdrawOutcome {
  /** The entry that was removed, with its people. */
  removed: EntryWithMembers;
  /** Waitlisted entries that took the places this freed, first in line first. */
  promoted: EntryWithMembers[];
}

/** Takes an entry off a sign-up and moves the waitlist up into any place that opened. */
export async function withdraw(eventId: number, entryId: number): Promise<WithdrawOutcome | null> {
  return prisma.$transaction(async (tx) => {
    const entry = await tx.signupEntry.findFirst({ where: { id: entryId, eventId }, include: { members: true } });
    if (!entry) return null;
    const deleted = await tx.signupEntry.deleteMany({ where: { id: entryId } });
    if (deleted.count === 0) return null;

    const promoted: EntryWithMembers[] = [];
    if (entry.status === "registered") {
      const event = await tx.signupEvent.findUnique({ where: { id: eventId } });
      const registered = await tx.signupEntry.count({ where: { eventId, status: "registered" } });
      const waiting = await tx.signupEntry.findMany({ where: { eventId, status: "waitlist" }, orderBy: { id: "asc" }, include: { members: true } });
      for (const next of promotions(registered, event?.capacity ?? 0, waiting)) {
        await tx.signupEntry.update({ where: { id: next.id }, data: { status: "registered" } });
        promoted.push({ ...next, status: "registered" });
      }
    }
    return { removed: entry, promoted };
  });
}

/**
 * Takes one teammate off an entry and leaves the rest of the team where it is. The
 * captain is not taken off this way, since the entry is theirs and leaving it
 * means withdrawing it.
 */
export async function removeTeammate(eventId: number, entryId: number, userId: string): Promise<boolean> {
  const removed = await prisma.signupMember.deleteMany({ where: { eventId, entryId, userId, entry: { captainId: { not: userId } } } });
  return removed.count > 0;
}

/** The entry a person is on, if any. */
export function entryOf(eventId: number, userId: string): Promise<EntryWithMembers | null> {
  return prisma.signupEntry.findFirst({ where: { eventId, members: { some: { userId } } }, include: { members: { orderBy: { id: "asc" } } } });
}
