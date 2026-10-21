/**
 * When a repeating workflow runs next, in the server's own time zone. Free of
 * discord.js so it can be tested on its own.
 */

export type Every = "hour" | "day" | "week";

export interface Rule {
  every: Every;
  /** "HH:MM". For every hour only the minutes count. */
  time: string;
  /** 0 for Sunday to 6 for Saturday. Only used for every week. */
  weekday: number;
}

export const TIME = {
  test: /^([01]\d|2[0-3]):[0-5]\d$/,
  message: "Write it as hours and minutes, such as 20:00.",
};

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The zone as Intl knows it, or UTC when the name is not one. */
function zoneOf(timeZone: string): string {
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
    weekday: "short",
  }).formatToParts(new Date(ms));
  const read = (type: string) => formatted.find((part) => part.type === type)?.value ?? "0";
  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    hour: Number(read("hour")) % 24,
    minute: Number(read("minute")),
    weekday: Math.max(0, WEEKDAYS.indexOf(read("weekday"))),
  };
}

/** The moment the wall clock in a zone reads the given date and time, found by correcting a guess for the zone's offset. */
function momentOf(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (at: number) => {
    const seen = partsIn(at, timeZone);
    return Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute) - at;
  };
  const first = guess - offsetAt(guess);
  return guess - offsetAt(first);
}

/** The first moment after `after` that the rule names, or null when the rule makes no sense. */
export function nextRun(after: number, rule: Rule, timeZone: string): number | null {
  if (!TIME.test.test(rule.time)) return null;
  const zone = zoneOf(timeZone);
  const [hour, minute] = rule.time.split(":").map(Number) as [number, number];
  const now = partsIn(after, zone);

  if (rule.every === "hour") {
    for (let step = 0; step < 3; step += 1) {
      const date = new Date(Date.UTC(now.year, now.month - 1, now.day, now.hour + step, minute));
      const at = momentOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), minute, zone);
      if (at > after) return at;
    }
    return null;
  }

  for (let step = 0; step < 9; step += 1) {
    const date = new Date(Date.UTC(now.year, now.month - 1, now.day + step));
    if (rule.every === "week" && date.getUTCDay() !== rule.weekday) continue;
    const at = momentOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, minute, zone);
    if (at > after) return at;
  }
  return null;
}
