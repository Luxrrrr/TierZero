/**
 * The arithmetic of a looking-for-group post: how many places it has, who may
 * join or leave, when it lapses. Free of discord.js so it can be tested on its
 * own. The author is the first player, so a post that needs three more has
 * four places.
 */

export type PostStatus = "open" | "full" | "closed" | "expired";

export interface Party {
  capacity: number;
  filled: number;
  open: number;
  full: boolean;
}

export function partyOf(needed: number, joined: number): Party {
  const capacity = needed + 1;
  const filled = Math.min(capacity, joined + 1);
  return { capacity, filled, open: capacity - filled, full: filled >= capacity };
}

export interface PostFacts {
  status: string;
  needed: number;
  authorId: string;
  joined: string[];
}

export type JoinVerdict = "ok" | "ended" | "full" | "author" | "already";

export function canJoin(post: PostFacts, userId: string): JoinVerdict {
  if (post.status !== "open") return post.status === "full" ? "full" : "ended";
  if (userId === post.authorId) return "author";
  if (post.joined.includes(userId)) return "already";
  return partyOf(post.needed, post.joined.length).full ? "full" : "ok";
}

export type LeaveVerdict = "ok" | "ended" | "author" | "notIn";

export function canLeave(post: PostFacts, userId: string): LeaveVerdict {
  if (post.status !== "open") return "ended";
  if (userId === post.authorId) return "author";
  return post.joined.includes(userId) ? "ok" : "notIn";
}

/**
 * When a post lapses. The wait counts from the start time when the post names
 * one, so a post for tonight is not gone by the afternoon, and from the moment
 * of posting otherwise.
 */
export function expiryOf(postedAt: Date, startsAt: Date | null, afterMs: number): Date {
  const from = startsAt && startsAt.getTime() > postedAt.getTime() ? startsAt : postedAt;
  return new Date(from.getTime() + afterMs);
}

/** How long until a member may post again, in milliseconds, or 0 when they may. */
export function cooldownLeft(lastPostedAt: Date | null, cooldownMs: number, now: Date): number {
  if (!lastPostedAt || cooldownMs <= 0) return 0;
  return Math.max(0, lastPostedAt.getTime() + cooldownMs - now.getTime());
}

/** The people in the party as mentions, one a line, the author first. */
export function partyLines(authorId: string, joined: string[]): string {
  return [authorId, ...joined].map((id) => `<@${id}>`).join("\n");
}
