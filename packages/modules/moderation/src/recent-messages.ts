import type { EvidenceAttachment } from "@tier0/core";

/**
 * What the bot remembers of each member's latest messages, so a moderator can
 * pick one to keep with an action. Discord has no way to ask for a member's
 * messages across channels, and a deleted message cannot be asked for at all,
 * so the only way to offer them is to have kept them.
 *
 * It lives in memory only. Nothing here is written to the database, a restart
 * clears it, and an entry is dropped after three days. Only a message a
 * moderator attaches is saved, and then as a copy with the action.
 */

export interface RecentMessage {
  id: string;
  channelId: string;
  channelName: string;
  authorId: string;
  content: string;
  attachments: EvidenceAttachment[];
  /** Milliseconds since the epoch. */
  createdAt: number;
  /** Deleted after it was posted. Kept, marked, because a deleted message is often the one worth showing. */
  deleted: boolean;
}

export const RECENT_LIMITS = {
  perMember: 30,
  /** Members remembered at once, across every server, the least recently active dropped first. */
  members: 5000,
  /** Three days. */
  ttlMs: 72 * 60 * 60 * 1000,
  content: 4000,
} as const;

const key = (guildId: string, userId: string) => `${guildId}:${userId}`;

export class RecentMessages {
  private readonly byMember = new Map<string, RecentMessage[]>();
  /** Which member's list a message id is in, so a deletion that does not name its author can still find it. */
  private readonly owner = new Map<string, string>();

  constructor(private readonly now: () => number = Date.now) {}

  record(guildId: string, message: RecentMessage): void {
    const k = key(guildId, message.authorId);
    const list = this.byMember.get(k) ?? [];
    list.push({ ...message, content: message.content.slice(0, RECENT_LIMITS.content) });
    while (list.length > RECENT_LIMITS.perMember) {
      const dropped = list.shift();
      if (dropped) this.owner.delete(dropped.id);
    }
    // Re-inserting moves the member to the end, so the front of the map is the longest idle.
    this.byMember.delete(k);
    this.byMember.set(k, list);
    this.owner.set(message.id, k);
    this.trimMembers();
  }

  edit(messageId: string, content: string): void {
    const found = this.find(messageId);
    if (found) found.content = content.slice(0, RECENT_LIMITS.content);
  }

  markDeleted(messageId: string): void {
    const found = this.find(messageId);
    if (found) found.deleted = true;
  }

  /** A member's messages in this server, newest first, without anything older than the time limit. */
  forMember(guildId: string, userId: string): RecentMessage[] {
    const list = this.byMember.get(key(guildId, userId));
    if (!list) return [];
    const cutoff = this.now() - RECENT_LIMITS.ttlMs;
    const live = list.filter((message) => message.createdAt >= cutoff);
    if (live.length !== list.length) {
      for (const gone of list.filter((message) => message.createdAt < cutoff)) this.owner.delete(gone.id);
      if (live.length === 0) this.byMember.delete(key(guildId, userId));
      else this.byMember.set(key(guildId, userId), live);
    }
    return [...live].reverse();
  }

  find(messageId: string): RecentMessage | undefined {
    const k = this.owner.get(messageId);
    return k ? this.byMember.get(k)?.find((message) => message.id === messageId) : undefined;
  }

  /** Drops everything past the time limit, for the periodic sweep. */
  prune(): void {
    const cutoff = this.now() - RECENT_LIMITS.ttlMs;
    for (const [k, list] of this.byMember) {
      const live = list.filter((message) => message.createdAt >= cutoff);
      for (const gone of list.filter((message) => message.createdAt < cutoff)) this.owner.delete(gone.id);
      if (live.length === 0) this.byMember.delete(k);
      else if (live.length !== list.length) this.byMember.set(k, live);
    }
  }

  get size(): number {
    return this.byMember.size;
  }

  private trimMembers(): void {
    while (this.byMember.size > RECENT_LIMITS.members) {
      const oldest = this.byMember.keys().next().value;
      if (oldest === undefined) return;
      for (const gone of this.byMember.get(oldest) ?? []) this.owner.delete(gone.id);
      this.byMember.delete(oldest);
    }
  }
}

/** The one the bot uses. A test makes its own with a clock it controls. */
export const recentMessages = new RecentMessages();

const SWEEP_MS = 10 * 60 * 1000;
setInterval(() => recentMessages.prune(), SWEEP_MS).unref();
