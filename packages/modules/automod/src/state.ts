/**
 * Per-member message history. This is held in memory, not the database.
 *
 * The rate-limit and repeated-text rules only care about the last few
 * seconds or minutes of a member's activity, this runs on every message in
 * every guild so a write per message is not affordable, and losing it on a
 * restart costs nothing worse than one rule briefly forgetting a member's
 * last few messages. None of that is true of an Infraction, which is a
 * permanent record and stays in SQLite.
 *
 * Bounded three ways so a raid cannot grow this without limit: each member
 * keeps a short, aged-out slice of their own messages, each message is only a
 * digest and a time, and each guild caps how many members it tracks at once,
 * evicting whoever has been quiet longest.
 */
import type { RecentMessage } from "./evaluator.js";

export type TrackedMessage = RecentMessage;

interface MemberHistory {
  messages: TrackedMessage[];
}

/**
 * What the settings can ask for, and so the least that has to be kept: the rate
 * limit can be set to 100 messages and the repeat window to an hour. Keeping
 * less would leave a setting that can never trip, or a window that is quietly
 * shorter than the one shown. A member only ever holds what they actually sent,
 * so the ceiling is reached only by someone spamming.
 */
export const MAX_MESSAGES_PER_MEMBER = 100;
export const MAX_MESSAGE_AGE_MS = 60 * 60 * 1000;
const MAX_TRACKED_MEMBERS_PER_GUILD = 5000;
const MAX_HANDLED_MESSAGES = 5000;

export class AutomodState {
  // A Map iterates in insertion order and a member is re-inserted whenever
  // they speak, so the first key is always the one quiet longest.
  private guilds = new Map<string, Map<string, MemberHistory>>();
  private handled = new Map<string, string>();

  /**
   * Records `message` for `userId` and returns everything tracked for them
   * before it, oldest first. The returned array is a copy: nothing the
   * caller does to it can corrupt this class's own state.
   */
  recordAndGetHistory(guildId: string, userId: string, message: TrackedMessage): TrackedMessage[] {
    const guild = this.guildOf(guildId);
    let member = guild.get(userId);
    if (member) {
      guild.delete(userId);
    } else {
      if (guild.size >= MAX_TRACKED_MEMBERS_PER_GUILD) {
        const oldest = guild.keys().next();
        if (!oldest.done) guild.delete(oldest.value);
      }
      member = { messages: [] };
    }
    guild.set(userId, member);

    member.messages = member.messages.filter(
      (tracked) => message.timestamp - tracked.timestamp <= MAX_MESSAGE_AGE_MS,
    );
    const history = member.messages.slice();

    member.messages.push(message);
    if (member.messages.length > MAX_MESSAGES_PER_MEMBER) {
      member.messages.splice(0, member.messages.length - MAX_MESSAGES_PER_MEMBER);
    }

    return history;
  }

  /**
   * True when this exact content of this message was already looked at. Discord
   * sends an update for an embed finishing loading, a pin or a flag change, none
   * of which is a new thing to judge.
   */
  wasHandled(messageId: string, fingerprint: string): boolean {
    return this.handled.get(messageId) === fingerprint;
  }

  markHandled(messageId: string, fingerprint: string): void {
    this.handled.delete(messageId);
    this.handled.set(messageId, fingerprint);
    if (this.handled.size > MAX_HANDLED_MESSAGES) {
      const oldest = this.handled.keys().next();
      if (!oldest.done) this.handled.delete(oldest.value);
    }
  }

  /** Drops everything tracked for a guild, such as when automod is disabled there. */
  forgetGuild(guildId: string): void {
    this.guilds.delete(guildId);
  }

  private guildOf(guildId: string): Map<string, MemberHistory> {
    let guild = this.guilds.get(guildId);
    if (!guild) {
      guild = new Map();
      this.guilds.set(guildId, guild);
    }
    return guild;
  }
}
