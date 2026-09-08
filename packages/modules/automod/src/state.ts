/**
 * Per-member message history, held in memory rather than the database.
 *
 * The rate-limit and repeated-text rules only care about the last few
 * seconds or minutes of a member's activity, this runs on every message in
 * every guild so a write per message is not affordable, and losing it on a
 * restart costs nothing worse than one rule briefly forgetting a member's
 * last few messages. None of that is true of an Infraction, which is a
 * permanent record and stays in SQLite.
 *
 * Bounded two ways so a raid cannot grow this without limit: each member
 * keeps a short, aged-out slice of their own messages, and each guild caps
 * how many members it tracks at once, evicting whoever has been quiet
 * longest.
 */

export interface TrackedMessage {
  content: string;
  timestamp: number;
}

interface MemberHistory {
  messages: TrackedMessage[];
  lastSeen: number;
}

const MAX_MESSAGES_PER_MEMBER = 20;
const MAX_MESSAGE_AGE_MS = 10 * 60 * 1000;
const MAX_TRACKED_MEMBERS_PER_GUILD = 5000;

export class AutomodState {
  private guilds = new Map<string, Map<string, MemberHistory>>();

  /**
   * Records `message` for `userId` and returns everything tracked for them
   * before it, oldest first. The returned array is a copy: nothing the
   * caller does to it can corrupt this class's own state.
   */
  recordAndGetHistory(guildId: string, userId: string, message: TrackedMessage): TrackedMessage[] {
    const guild = this.guildOf(guildId);
    let member = guild.get(userId);
    if (!member) {
      if (guild.size >= MAX_TRACKED_MEMBERS_PER_GUILD) {
        evictOldest(guild);
      }
      member = { messages: [], lastSeen: message.timestamp };
      guild.set(userId, member);
    }

    member.messages = member.messages.filter(
      (tracked) => message.timestamp - tracked.timestamp <= MAX_MESSAGE_AGE_MS,
    );
    const history = member.messages.slice();

    member.messages.push(message);
    if (member.messages.length > MAX_MESSAGES_PER_MEMBER) {
      member.messages.splice(0, member.messages.length - MAX_MESSAGES_PER_MEMBER);
    }
    member.lastSeen = message.timestamp;

    return history;
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

function evictOldest(guild: Map<string, MemberHistory>): void {
  let oldestId: string | undefined;
  let oldestSeen = Infinity;
  for (const [id, history] of guild) {
    if (history.lastSeen < oldestSeen) {
      oldestSeen = history.lastSeen;
      oldestId = id;
    }
  }
  if (oldestId !== undefined) guild.delete(oldestId);
}
