import type { RoundType } from "./rounds.js";

/**
 * How likely a new member is to be part of a raid, from what is known the
 * moment they join. It only decides how hard the check is, and removes a
 * member in the one case that is plain from the signs below. Kept free of
 * discord.js so it can be tested on its own.
 */

export type Tier = "low" | "medium" | "high";

/** What is known about the account that joined. */
export interface Who {
  /** When the account was made. */
  created: number;
  name: string;
  /** No picture of their own. */
  defaultAvatar: boolean;
}

/** Someone who joined a little earlier. */
export interface Recent {
  at: number;
  created: number;
  name: string;
}

export interface Assessment {
  score: number;
  tier: Tier;
  /** Several accounts made around the same time joined together, which ordinary members almost never do. */
  clustered: boolean;
  /** What counted against them, in words a moderator can read. */
  reasons: string[];
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Joins this close together are looked at side by side. */
export const WINDOW = MINUTE;
export const MEDIUM_AT = 25;
export const HIGH_AT = 60;
/** The score at which a member is removed, where the setting says to remove the clearest cases. */
export const REMOVE_AT = 90;
/** Added while raid protection is on, since then a raid has already been seen. */
export const RAID_BONUS = 30;

export function tierOf(score: number): Tier {
  if (score >= HIGH_AT) return "high";
  return score >= MEDIUM_AT ? "medium" : "low";
}

function ageText(age: number): string {
  if (age < HOUR) return "less than an hour old";
  if (age < DAY) return `${Math.floor(age / HOUR)} hours old`;
  const days = Math.floor(age / DAY);
  return `${days} ${days === 1 ? "day" : "days"} old`;
}

/** The letters of a name, which is what a batch of generated names shares. */
function stem(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

function related(a: string, b: string): boolean {
  if (a.length < 4 || b.length < 4) return false;
  if (a === b) return true;
  return a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5);
}

/** Names that are mostly numbers, as a script that makes accounts in bulk tends to give them. */
function numbered(name: string): boolean {
  const digits = (name.match(/\d/g) ?? []).length;
  return /\d{4,}$/.test(name) || (name.length >= 6 && digits / name.length >= 0.5);
}

/** `others` are the joins in the minute before this one, not counting it. */
export function assess(who: Who, now: number, others: readonly Recent[]): Assessment {
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string): void => {
    score += points;
    reasons.push(reason);
  };

  const age = now - who.created;
  if (age < DAY) add(35, `account is ${ageText(age)}`);
  else if (age < 3 * DAY) add(25, `account is ${ageText(age)}`);
  else if (age < 7 * DAY) add(15, `account is ${ageText(age)}`);
  else if (age < 30 * DAY) add(8, `account is ${ageText(age)}`);

  if (who.defaultAvatar) add(12, "no profile picture");
  if (numbered(who.name)) add(8, "name is mostly numbers");

  const together = others.filter((other) => Math.abs(other.created - who.created) <= HOUR).length;
  const clustered = together >= 2;
  if (together >= 5) add(40, `${together} other accounts made within an hour of it joined in the last minute`);
  else if (clustered) add(25, `${together} other accounts made within an hour of it joined in the last minute`);

  const mine = stem(who.name);
  const alike = others.filter((other) => related(mine, stem(other.name))).length;
  if (alike >= 2) add(20, `name is like ${alike} others that just joined`);

  if (others.length >= 7) add(10, `${others.length + 1} people joined in a minute`);

  score = Math.min(100, score);
  return { score, tier: tierOf(score), clustered, reasons };
}

/** The same assessment with raid protection counted in, which it cannot know at the moment someone joins. */
export function withRaid(assessment: Assessment, raid: boolean): Assessment {
  if (!raid) return assessment;
  const score = Math.min(100, assessment.score + RAID_BONUS);
  return { ...assessment, score, tier: tierOf(score), reasons: [...assessment.reasons, "raid protection is on"] };
}

/** Whether a member is plainly part of a raid: made with others and joined with them, and scoring very high. */
export function clearlyRaid(assessment: Assessment): boolean {
  return assessment.clustered && assessment.score >= REMOVE_AT;
}

/** For a log message: nothing for an ordinary member, and the reasons for anyone who looked unusual. */
export function riskNote(assessment: Assessment): string {
  if (assessment.tier === "low") return "";
  const reasons = assessment.reasons.join(", ");
  return `\nRisk: **${assessment.tier}**${reasons ? `: ${reasons}` : ""}.`;
}

/** The kinds of round for each tier, from easiest to hardest. */
const POOLS: Record<Tier, readonly RoundType[]> = {
  low: ["text", "block"],
  medium: ["text", "colour", "tiles"],
  high: ["colour", "motion", "tiles"],
};

/** What a member of this tier has to do, given the number of rounds set as the usual. */
export function challengeFor(tier: Tier, usual: number): { types: readonly RoundType[]; rounds: number } {
  const rounds = tier === "low" ? usual - 1 : tier === "high" ? usual + 1 : usual;
  return { types: POOLS[tier], rounds: Math.min(5, Math.max(1, rounds)) };
}

/** Who joined lately in each server, so a join can be set beside the ones around it. */
export class RecentJoins {
  private readonly joins = new Map<string, Recent[]>();

  /** Notes a join, and gives the ones in the minute before it. */
  record(guild: string, joiner: Recent): Recent[] {
    const before = (this.joins.get(guild) ?? []).filter((other) => joiner.at - other.at < WINDOW);
    this.joins.set(guild, [...before, joiner]);
    return before;
  }
}
