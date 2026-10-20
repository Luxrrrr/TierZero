import { prisma, type LfgMember, type LfgPost } from "@tier0/db";
import { canJoin, canLeave, partyOf } from "./party.js";

/**
 * The looking-for-group posts and who is in them. Every change that depends on
 * how many places are left runs in one transaction with the write first, so
 * two people pressing Join on the last place cannot both get it.
 */

export type PostWithMembers = LfgPost & { members: LfgMember[] };

const WITH_MEMBERS = { members: { orderBy: { id: "asc" as const } } };

export interface NewPost {
  guildId: string;
  channelId: string;
  gameId: string;
  gameName: string;
  authorId: string;
  authorName: string;
  needed: number;
  note: string;
  startsAt: Date | null;
  expiresAt: Date;
}

export async function createPost(post: NewPost): Promise<PostWithMembers> {
  return prisma.lfgPost.create({ data: post, include: WITH_MEMBERS });
}

export function postById(guildId: string, id: number): Promise<PostWithMembers | null> {
  return prisma.lfgPost.findFirst({ where: { id, guildId }, include: WITH_MEMBERS });
}

export function attachMessage(id: number, messageId: string): Promise<LfgPost> {
  return prisma.lfgPost.update({ where: { id }, data: { messageId } });
}

/** Removes a post whose message never went up. */
export async function discardPost(id: number): Promise<void> {
  await prisma.lfgPost.deleteMany({ where: { id } });
}

export function openPostsOf(guildId: string, authorId: string): Promise<number> {
  return prisma.lfgPost.count({ where: { guildId, authorId, status: "open" } });
}

export async function lastPostedAt(guildId: string, authorId: string): Promise<Date | null> {
  const last = await prisma.lfgPost.findFirst({ where: { guildId, authorId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  return last?.createdAt ?? null;
}

export type JoinOutcome =
  | { ok: true; post: PostWithMembers; filled: boolean }
  | { ok: false; code: "gone" | "ended" | "full" | "author" | "already" };

class Rollback extends Error {
  constructor(readonly code: "full") {
    super(code);
  }
}

export async function joinPost(guildId: string, id: number, user: { id: string; name: string }): Promise<JoinOutcome> {
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.lfgPost.findFirst({ where: { id, guildId }, include: WITH_MEMBERS });
      if (!before) return { ok: false, code: "gone" } as const;
      const verdict = canJoin({ ...before, joined: before.members.map((m) => m.userId) }, user.id);
      if (verdict !== "ok") return { ok: false, code: verdict } as const;

      await tx.lfgMember.create({ data: { postId: id, userId: user.id, userName: user.name } });
      // Counted after the write, which holds the database's write lock, so a concurrent join sees this one.
      const members = await tx.lfgMember.findMany({ where: { postId: id }, orderBy: { id: "asc" } });
      const party = partyOf(before.needed, members.length);
      if (members.length + 1 > party.capacity) throw new Rollback("full");

      const filled = party.full;
      const updated = filled ? await tx.lfgPost.update({ where: { id }, data: { status: "full", closedAt: new Date() } }) : before;
      return { ok: true, post: { ...updated, members }, filled } as const;
    });
  } catch (error) {
    if (error instanceof Rollback) return { ok: false, code: "full" };
    if (isUnique(error)) return { ok: false, code: "already" };
    throw error;
  }
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

export type LeaveOutcome = { ok: true; post: PostWithMembers } | { ok: false; code: "gone" | "ended" | "author" | "notIn" };

export async function leavePost(guildId: string, id: number, userId: string): Promise<LeaveOutcome> {
  const post = await postById(guildId, id);
  if (!post) return { ok: false, code: "gone" };
  const verdict = canLeave({ ...post, joined: post.members.map((m) => m.userId) }, userId);
  if (verdict !== "ok") return { ok: false, code: verdict };
  await prisma.lfgMember.deleteMany({ where: { postId: id, userId } });
  const after = await postById(guildId, id);
  return after ? { ok: true, post: after } : { ok: false, code: "gone" };
}

/**
 * Ends a post that is still open. Conditional, so the author closing it at the
 * moment it expires ends it once and only one of them goes on to edit the message.
 */
export async function endPost(id: number, status: "closed" | "expired" | "started", voiceChannelId?: string): Promise<boolean> {
  const ended = await prisma.lfgPost.updateMany({
    where: { id, status: "open" },
    data: { status, closedAt: new Date(), ...(voiceChannelId ? { voiceChannelId } : {}) },
  });
  return ended.count === 1;
}

export function setPartyVoice(id: number, voiceChannelId: string): Promise<LfgPost> {
  return prisma.lfgPost.update({ where: { id }, data: { voiceChannelId } });
}

/** Open posts past their time, for the sweep that covers an expiry whose scheduled task was lost. */
export function overduePosts(guildId: string, now: Date): Promise<PostWithMembers[]> {
  return prisma.lfgPost.findMany({ where: { guildId, status: "open", expiresAt: { lte: now } }, include: WITH_MEMBERS });
}
