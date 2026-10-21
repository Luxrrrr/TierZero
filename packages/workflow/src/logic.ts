import type { MessageBody } from "@tier0/core";

/**
 * The rules of a workflow that need no Discord: which messages match, who may
 * run it and where, how often, and how a made-up command or option has to be
 * named. Free of discord.js so they can be tested on their own.
 */

/** Discord accepts more, but this is what stays readable and safe to type. */
export const COMMAND_NAME = {
  test: /^[a-z0-9_-]{1,32}$/,
  message: "Use lowercase letters, numbers, - and _, up to 32 of them.",
};

/** An option's name is also the {name} used in messages, which can only hold letters, numbers and _. */
export const OPTION_NAME = {
  test: /^[a-z0-9_]{1,32}$/,
  message: "Use lowercase letters, numbers and _, up to 32 of them.",
};

// -- messages that match ------------------------------------------------------------------------------------

export type MatchMode = "contains" | "word" | "exact" | "start";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether a message says one of the phrases. Capitals are ignored. The phrases are matched as plain text, never as patterns, so nothing
 * a server owner types can make the check slow.
 */
export function matchesMessage(text: string, phrases: readonly string[], mode: MatchMode): boolean {
  const said = text.trim().toLowerCase();
  if (said === "") return false;
  return phrases.some((raw) => {
    const phrase = raw.trim().toLowerCase();
    if (phrase === "") return false;
    switch (mode) {
      case "exact":
        return said === phrase;
      case "start":
        return said.startsWith(phrase);
      case "word":
        return new RegExp(`(?<![\\p{L}\\p{N}_])${escape(phrase)}(?![\\p{L}\\p{N}_])`, "u").test(said);
      default:
        return said.includes(phrase);
    }
  });
}

// -- who and where ------------------------------------------------------------------------------------------

export interface Conditions {
  onlyChannels: readonly string[];
  onlyRoles: readonly string[];
  exceptRoles: readonly string[];
  /** 1 to 100. */
  chance: number;
}

export interface Subject {
  /** The channel it happened in, then the places above it, so a rule on a category reaches a thread in it. */
  channelIds: readonly string[];
  roleIds: readonly string[];
}

export type Verdict = { ok: true } | { ok: false; reason: "channel" | "role" | "except" | "chance" };

/** `roll` is a number from 0 up to but not including 100, so a chance of 100 always passes and 1 passes about one time in a hundred. */
export function check(conditions: Conditions, subject: Subject, roll: number): Verdict {
  if (conditions.onlyChannels.length > 0 && !subject.channelIds.some((id) => conditions.onlyChannels.includes(id))) return { ok: false, reason: "channel" };
  if (conditions.onlyRoles.length > 0 && !subject.roleIds.some((id) => conditions.onlyRoles.includes(id))) return { ok: false, reason: "role" };
  if (subject.roleIds.some((id) => conditions.exceptRoles.includes(id))) return { ok: false, reason: "except" };
  if (roll >= conditions.chance) return { ok: false, reason: "chance" };
  return { ok: true };
}

// -- how often ----------------------------------------------------------------------------------------------

/** Remembers when each member last ran each workflow, for the wait between runs. Kept in memory, so a restart lets everyone go again. */
export class Cooldowns {
  private readonly last = new Map<string, number>();

  /** How long until the member may run it again, in milliseconds. Zero when they may now. */
  left(key: string, waitMs: number, now: number): number {
    if (waitMs <= 0) return 0;
    const at = this.last.get(key);
    return at === undefined ? 0 : Math.max(0, at + waitMs - now);
  }

  mark(key: string, now: number): void {
    this.last.set(key, now);
    if (this.last.size > 5000) for (const [stale, at] of this.last) if (now - at > 86_400_000) this.last.delete(stale);
  }
}

/** A ceiling on runs per window, so a flood of triggers cannot turn into a flood of actions. */
export class RateLimit {
  private readonly runs = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** True, and counts it, while the key is under the limit for the window. */
  allow(key: string, now: number): boolean {
    const recent = (this.runs.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.runs.set(key, recent);
      return false;
    }
    recent.push(now);
    this.runs.set(key, recent);
    return true;
  }
}

// -- text a member wrote ------------------------------------------------------------------------------------

/** Puts a break into anything that would ping, so text a member typed cannot mention everyone or a role through the bot. */
export function defuse(text: string): string {
  const gap = String.fromCharCode(0x200b);
  return text.replace(/@(everyone|here)/gi, `@${gap}$1`).replace(/<@([!&]?\d)/g, `<@${gap}$1`);
}

/** The roles an owner's own message mentions, which are the only ones a workflow may ping. */
export function rolesIn(body: MessageBody): string[] {
  return [...new Set([...JSON.stringify(body).matchAll(/<@&(\d{5,25})>/g)].map((match) => match[1]!))];
}

// -- emoji --------------------------------------------------------------------------------------------------

/** Whether a reaction is the emoji a workflow was set up with, which is a plain emoji or `<:name:id>`. */
export function sameEmoji(stored: string, emoji: { id: string | null; name: string | null }): boolean {
  const wanted = stored.trim();
  const custom = /^<a?:\w+:(\d+)>$/.exec(wanted);
  if (custom) return emoji.id === custom[1];
  return emoji.id === null && emoji.name === wanted;
}

// -- numbers ------------------------------------------------------------------------------------------------

export type Compare = "equals" | "notEquals" | "greater" | "less" | "atLeast" | "atMost";

export function compare(value: number, how: Compare, amount: number): boolean {
  switch (how) {
    case "notEquals":
      return value !== amount;
    case "greater":
      return value > amount;
    case "less":
      return value < amount;
    case "atLeast":
      return value >= amount;
    case "atMost":
      return value <= amount;
    default:
      return value === amount;
  }
}

// -- names a counter may not take ---------------------------------------------------------------------------

/** What a message already fills in, so a counter of the same name would be hidden behind it. */
export const BUILT_IN_VALUES = [
  "user", "userName", "username", "userId", "channel", "channelName", "message", "messageLink", "emoji", "role", "roleMention",
  "server", "members", "date", "time", "now", "sender", "bot", "authorName", "author", "voiceChannel", "thread",
];

/** A counter's name is also its {name} in messages, so it can hold only what a placeholder can and cannot be one a message already uses. */
export const VARIABLE_NAME = {
  test: new RegExp(`^(?!(?:${BUILT_IN_VALUES.join("|")})$)[a-z][a-z0-9_]{0,31}$`),
  message: "Start with a letter, then lowercase letters, numbers and _, up to 32. It can't be a name a message already uses, such as user or channel.",
};
