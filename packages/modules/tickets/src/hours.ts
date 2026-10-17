/**
 * Working hours: whether a moment falls inside the hours a server set, in its
 * own time zone, and when they next start. Free of discord.js so it can be
 * tested with plain dates. Time zones come from the runtime's own list, so
 * nothing is downloaded and daylight saving is handled for us.
 */

export const WEEKDAYS = [
  { value: "mon", label: "Monday" },
  { value: "tue", label: "Tuesday" },
  { value: "wed", label: "Wednesday" },
  { value: "thu", label: "Thursday" },
  { value: "fri", label: "Friday" },
  { value: "sat", label: "Saturday" },
  { value: "sun", label: "Sunday" },
] as const;

export type Weekday = (typeof WEEKDAYS)[number]["value"];

const pad = (n: number) => String(n).padStart(2, "0");

/** Every half hour of a day, as the dashboard offers them. `to` can also be the end of the day. */
export const DAY_TIMES = Array.from({ length: 48 }, (_, i) => `${pad(Math.floor(i / 2))}:${i % 2 === 0 ? "00" : "30"}`);
export const END_TIMES = [...DAY_TIMES.slice(1), "24:00"];

export interface HoursRow {
  day: string;
  from: string;
  to: string;
}

export interface WorkingHours {
  enabled: boolean;
  timeZone?: string | undefined;
  days: readonly HoursRow[];
}

/** The zone the hours are read in. A name the runtime does not know reads as UTC rather than failing. */
export function zoneOf(timeZone: string | undefined): string {
  const wanted = timeZone?.trim();
  if (!wanted) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: wanted });
    return wanted;
  } catch {
    return "UTC";
  }
}

export function isKnownZone(timeZone: string | undefined): boolean {
  const wanted = timeZone?.trim();
  return !wanted || zoneOf(wanted) === wanted;
}

const minutesOf = (time: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

const DAY_OF: Record<string, Weekday> = { Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat", Sun: "sun" };

/** The weekday and minute of the day a moment is in that zone. */
export function localTime(at: Date, timeZone: string): { day: Weekday; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: DAY_OF[part("weekday")] ?? "mon", minute: Number(part("hour")) * 60 + Number(part("minute")) };
}

/**
 * Whether the team is meant to be around. Hours that are switched off, or have
 * no rows at all, always count as working hours, so the feature does nothing
 * until it is set up. A row whose end is before its start runs past midnight.
 */
export function withinHours(hours: WorkingHours, at: Date): boolean {
  if (!hours.enabled || hours.days.length === 0) return true;
  const { day, minute } = localTime(at, zoneOf(hours.timeZone));
  const index = WEEKDAYS.findIndex((weekday) => weekday.value === day);
  const yesterday = WEEKDAYS[(index + 6) % 7]!.value;
  return hours.days.some((row) => {
    const from = minutesOf(row.from);
    const to = minutesOf(row.to);
    if (from === null || to === null || from === to) return false;
    if (from < to) return row.day === day && minute >= from && minute < to;
    return (row.day === day && minute >= from) || (row.day === yesterday && minute < to);
  });
}

const STEP_MS = 15 * 60_000;
const SEARCH_MS = 8 * 24 * 60 * 60_000;

/** When working hours next start after `at`, to the quarter hour, or null when they never do. */
export function nextOpening(hours: WorkingHours, at: Date): Date | null {
  if (withinHours(hours, at)) return at;
  const start = Math.ceil(at.getTime() / STEP_MS) * STEP_MS;
  for (let t = start; t <= at.getTime() + SEARCH_MS; t += STEP_MS) {
    if (withinHours(hours, new Date(t))) return new Date(t);
  }
  return null;
}
