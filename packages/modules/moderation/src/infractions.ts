import { createInfraction, prisma } from "@tier0/db";
import { isCounting, warnExpiresAt, type AutomaticCase, type EvidenceMessage } from "@tier0/shared-moderation";
import type { ModerationAction } from "./modlog.js";

export interface InfractionRecord {
  id: number;
  caseNumber: number;
  guildId: string;
  userId: string;
  moderatorId: string;
  action: string;
  reason: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  active: boolean;
  /** Messages kept with the action, as JSON. */
  evidence: string;
}

export interface RecordInfractionInput {
  guildId: string;
  userId: string;
  moderatorId: string;
  action: ModerationAction;
  reason: string | null;
  expiresAt?: Date | null;
  active?: boolean;
  evidence?: EvidenceMessage[];
  /** Set when an escalation rule took this action, not a person. */
  automatic?: AutomaticCase | null;
}

/**
 * Writes an infraction and hands back its stored case number: one past the
 * highest in the guild. Two writers can pick the same number at once, so a
 * unique-index conflict is retried with a fresh pick. Voided rows still count
 * towards the highest, which keeps numbers from being reused.
 */
export async function recordInfraction(input: RecordInfractionInput): Promise<InfractionRecord> {
  return createInfraction({
    guildId: input.guildId,
    userId: input.userId,
    moderatorId: input.moderatorId,
    action: input.action,
    reason: input.reason ?? null,
    expiresAt: input.expiresAt ?? null,
    active: input.active ?? true,
    evidence: JSON.stringify(input.evidence ?? []),
    ...(input.automatic ? { automatic: JSON.stringify(input.automatic) } : {}),
  });
}

/** How many of a member's warnings count right now, a moderator's and automod's, under the server's warning expiry. */
export async function countWarnings(guildId: string, userId: string, warnExpiryMs: number | null, now: Date = new Date()): Promise<number> {
  const rows = await prisma.infraction.findMany({
    where: { guildId, userId, action: { in: ["warn", "automod-warn"] }, voidedAt: null },
    select: { action: true, createdAt: true },
  });
  return rows.filter((row) => isCounting({ action: row.action, active: true, expiresAt: null, removed: false, warnExpiresAt: warnExpiresAt(row.action, row.createdAt, warnExpiryMs) }, now)).length;
}

/** Takes back a case written for an action Discord then refused, so the record does not claim it happened. */
export async function discardRecord(id: number): Promise<void> {
  try {
    await prisma.infraction.delete({ where: { id } });
  } catch (error) {
    console.error("moderation: could not remove the case of an action that did not go through:", error);
  }
}

/** Replaces the copies of messages kept with a case, such as to mark the ones its action deleted. */
export async function saveEvidence(id: number, evidence: EvidenceMessage[]): Promise<string> {
  const serialized = JSON.stringify(evidence);
  await prisma.infraction.update({ where: { id }, data: { evidence: serialized } });
  return serialized;
}

/** Marks the most recent open infraction of `action` inactive, for a reversal. */
export async function deactivateOpen(
  guildId: string,
  userId: string,
  action: ModerationAction,
): Promise<void> {
  const open = await prisma.infraction.findFirst({
    where: { guildId, userId, action, active: true },
    orderBy: { id: "desc" },
  });
  if (!open) return;
  await prisma.infraction.update({ where: { id: open.id }, data: { active: false } });
}

/** The newest ban on a member's record that is still flagged active and has not been removed. */
export async function latestOpenBan(guildId: string, userId: string): Promise<InfractionRecord | null> {
  return prisma.infraction.findFirst({
    where: { guildId, userId, action: "ban", active: true, voidedAt: null },
    orderBy: { id: "desc" },
  });
}

/** Looks a case up by its stored number. A voided case reads as missing. */
export async function findByCaseNumber(
  guildId: string,
  caseNumber: number,
): Promise<InfractionRecord | null> {
  if (!Number.isInteger(caseNumber) || caseNumber < 1) return null;
  return prisma.infraction.findFirst({ where: { guildId, caseNumber, voidedAt: null } });
}

/** A member's history, newest first, leaving out anything staff have removed from the record. */
export async function historyFor(
  guildId: string,
  userId: string,
  limit = 25,
): Promise<InfractionRecord[]> {
  return prisma.infraction.findMany({
    where: { guildId, userId, voidedAt: null },
    orderBy: { id: "desc" },
    take: limit,
  });
}

/**
 * Closes every open timeout on a member, automod's included: both put the same
 * Discord timeout on them, so clearing it ends both.
 */
export async function deactivateOpenTimeouts(guildId: string, userId: string): Promise<void> {
  await prisma.infraction.updateMany({
    where: { guildId, userId, action: { in: ["timeout", "automod-timeout"] }, active: true },
    data: { active: false },
  });
}
