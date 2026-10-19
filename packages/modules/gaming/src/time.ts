/**
 * Reading a start time somebody typed into a command. Free of discord.js so
 * it can be tested on its own.
 *
 * Accepted: a Discord timestamp (`<t:1790000000:F>`), Unix seconds, a wait
 * (`in 90m`, `in 2h30m`, `in 1d`), a clock time today or tomorrow
 * (`20:00`, `tomorrow 8:30pm`) and a date with a time (`2026-11-02 19:30`).
 * Clock times and dates are read in the server's own time zone unless they
 * end in `utc`.
 */

export type WhenResult = { ok: true; at: Date } | { ok: false; code: "format" | "past" | "far" };

/** A start further off than this is almost certainly a typo in the year. */
const MAX_AHEAD_MS = 366 * 86_400_000;

const UNIT_MS: Record<string, number> = { d: 86_400_000, h: 3_600_000, m: 60_000 };

export const WHEN_EXAMPLES = "in 90m, 20:00, tomorrow 8pm, 2026-11-02 19:30 or <t:1790000000>";

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** The zone as Intl knows it, or UTC when the name is not one. */
function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

function partsIn(ms: number, timeZone: string): Parts {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(formatted.find((part) => part.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** How far ahead of UTC the zone's wall clock is at that moment. */
function offsetAt(ms: number, timeZone: string): number {
  const p = partsIn(ms, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ms / 60_000) * 60_000;
}

/** The moment a wall-clock time happens in a zone, or null when the date does not exist. */
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date | null {
  if (month < 1 || month > 12 || day < 1 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(guess).getUTCDate() !== day) return null;
  const zone = safeZone(timeZone);
  const first = guess - offsetAt(guess, zone);
  // The offset at the first answer can differ from the one at the guess across a clock change.
  return new Date(guess - offsetAt(first, zone));
}

function clock(hourText: string, minuteText: string, meridiem: string | undefined): { hour: number; minute: number } | null {
  let hour = Number(hourText);
  const minute = Number(minuteText);
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  }
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

function wait(text: string): number | null {
  const unit = /\s*(\d+)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m)(?![a-z])\s*(?:,|and)?/y;
  let total = 0;
  let at = 0;
  while (at < text.length) {
    unit.lastIndex = at;
    const found = unit.exec(text);
    if (!found) return null;
    total += Number(found[1]) * (UNIT_MS[(found[2] ?? "")[0] ?? ""] ?? 0);
    at = unit.lastIndex;
  }
  return at > 0 ? total : null;
}

function judged(at: Date, now: Date): WhenResult {
  if (at.getTime() <= now.getTime()) return { ok: false, code: "past" };
  if (at.getTime() - now.getTime() > MAX_AHEAD_MS) return { ok: false, code: "far" };
  return { ok: true, at };
}

export function parseWhen(input: string, now: Date, timeZone: string): WhenResult {
  const text = input.trim().toLowerCase();
  const stamp = /^<t:(\d{9,11})(?::[tdfr])?>$/.exec(text) ?? /^(\d{10})$/.exec(text);
  if (stamp) return judged(new Date(Number(stamp[1]) * 1000), now);

  const waiting = /^in\s+(.+)$/.exec(text);
  if (waiting) {
    const ms = wait(waiting[1] ?? "");
    return ms === null || ms === 0 ? { ok: false, code: "format" } : judged(new Date(now.getTime() + ms), now);
  }

  const utc = /\s*\b(utc|z)$/.exec(text);
  const zone = utc ? "UTC" : safeZone(timeZone);
  const body = utc ? text.slice(0, utc.index) : text;

  const dated = /^(\d{4})-(\d{1,2})-(\d{1,2})[ t]+(\d{1,2}):(\d{2})\s*(am|pm)?$/.exec(body);
  if (dated) {
    const time = clock(dated[4] ?? "", dated[5] ?? "", dated[6]);
    const at = time && zonedTime(Number(dated[1]), Number(dated[2]), Number(dated[3]), time.hour, time.minute, zone);
    return at ? judged(at, now) : { ok: false, code: "format" };
  }

  const timed = /^(today|tomorrow)?\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(body);
  // A bare number is not a time: "8" is more likely a mistake than eight o'clock.
  if (timed && (timed[3] !== undefined || timed[4] !== undefined)) {
    const time = clock(timed[2] ?? "", timed[3] ?? "00", timed[4]);
    if (!time) return { ok: false, code: "format" };
    const today = partsIn(now.getTime(), zone);
    const build = (daysAhead: number) => {
      const base = new Date(Date.UTC(today.year, today.month - 1, today.day + daysAhead));
      return zonedTime(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), time.hour, time.minute, zone);
    };
    if (timed[1] === "today") return judged(build(0) ?? now, now);
    if (timed[1] === "tomorrow") return judged(build(1) ?? now, now);
    const first = build(0);
    const at = first && first.getTime() > now.getTime() ? first : build(1);
    return at ? judged(at, now) : { ok: false, code: "format" };
  }

  return { ok: false, code: "format" };
}

/** A Discord timestamp that each reader sees in their own time zone. */
export function discordTime(at: Date, style: "f" | "F" | "R" | "t" = "F"): string {
  return `<t:${Math.floor(at.getTime() / 1000)}:${style}>`;
}

/** A length of time as people say it: "2 hours 30 minutes". */
export function spokenWait(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const part = (count: number, noun: string) => (count > 0 ? [`${count} ${noun}${count === 1 ? "" : "s"}`] : []);
  return [...part(days, "day"), ...part(hours, "hour"), ...part(rest, "minute")].join(" ");
}
