/**
 * The rules of a sign-up that do not need Discord or the database: where a new
 * entry lands, who is promoted when a place opens, how a captain's list of
 * teammates is read. Free of discord.js so it can be tested on its own.
 */

export type Placement = "registered" | "waitlist" | "full";

/** A capacity of 0 means no limit. */
export function placementFor(registered: number, capacity: number, waitlist: boolean): Placement {
  if (capacity <= 0 || registered < capacity) return "registered";
  return waitlist ? "waitlist" : "full";
}

/** The waiting entries, in the order they joined, that fill the places now free. */
export function promotions<T>(registered: number, capacity: number, waiting: T[]): T[] {
  if (capacity <= 0) return waiting;
  return waiting.slice(0, Math.max(0, capacity - registered));
}

const MENTION = /<@!?(\d{17,20})>|\b(\d{17,20})\b/g;

/** Every member a captain named, as mentions or bare ids, once each and in the order written. */
export function mentionedIds(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(MENTION)) {
    const id = match[1] ?? match[2];
    if (id) seen.add(id);
  }
  return [...seen];
}

export type TeamResult = { ok: true; members: string[] } | { ok: false; code: "tooMany" | "tooFew" };

/**
 * The captain first, then the teammates they named. Naming the captain again is
 * harmless. With `fullOnly` the team has to be exactly the size the sign-up asks.
 */
export function teamOf(captainId: string, text: string, teamSize: number, fullOnly: boolean): TeamResult {
  const mates = mentionedIds(text).filter((id) => id !== captainId);
  if (mates.length > teamSize - 1) return { ok: false, code: "tooMany" };
  if (fullOnly && mates.length < teamSize - 1) return { ok: false, code: "tooFew" };
  return { ok: true, members: [captainId, ...mates] };
}

/** Whether someone holds any of the roles a sign-up asks for, or nothing is asked. */
export function meetsRoles(memberRoleIds: Iterable<string>, required: string[]): boolean {
  if (required.length === 0) return true;
  const held = new Set(memberRoleIds);
  return required.some((id) => held.has(id));
}

export interface ListedEntry {
  captainId: string;
  teamName: string;
  members: string[];
}

/** One entry as the sign-up message lists it: mentions, with the team's name first when it has one. */
export function entryLine(entry: ListedEntry, teamSize: number): string {
  const people = entry.members.map((id) => `<@${id}>`).join(" ");
  if (teamSize <= 1) return people;
  return entry.teamName === "" ? people : `**${entry.teamName}** ${people}`;
}

/** Lines for a field of a message, cut short with a count when they would not fit. */
export function listLines(lines: string[], limit: number): string {
  if (lines.join("\n").length <= limit) return lines.join("\n");
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    // Room is kept for the marker that says how many were left out.
    if (used + line.length + 1 > limit - 12) break;
    kept.push(line);
    used += line.length + 1;
  }
  return [...kept, `…+${lines.length - kept.length}`].join("\n");
}

/** The plain-text list staff export: numbered entries, then the waitlist, with names and no mentions. */
export function exportText(
  title: string,
  teamSize: number,
  registered: ListedEntry[],
  waiting: ListedEntry[],
  nameOf: (id: string) => string,
  waitlistHeading: string,
): string {
  const line = (entry: ListedEntry, index: number) => {
    const people = entry.members.map((id) => `${nameOf(id)} (${id})`).join(", ");
    const name = teamSize > 1 && entry.teamName !== "" ? `${entry.teamName}: ` : "";
    return `${index + 1}. ${name}${people}`;
  };
  const parts = [title, "", ...registered.map(line)];
  if (waiting.length > 0) parts.push("", waitlistHeading, ...waiting.map(line));
  return parts.join("\n");
}
