/**
 * Durations cross the wire in two shapes. Stored settings come back from the
 * bot as milliseconds, while a schema's `default` and `max` are written the way
 * a person would say them, "10m" or "28d". Both end up in the same control, so
 * everything here accepts either.
 */

export type DurationUnit = "s" | "m" | "h" | "d";

export interface DurationParts {
  amount: number;
  unit: DurationUnit;
}

const UNIT_MS: Record<DurationUnit, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const UNIT_NAMES: Record<DurationUnit, string> = {
  s: "second",
  m: "minute",
  h: "hour",
  d: "day",
};

/** Largest first, so a value is shown in the coarsest unit that divides it. */
const UNITS: DurationUnit[] = ["d", "h", "m", "s"];

const WRITTEN = /^\s*(\d+)\s*(s|m|h|d)\s*$/;

export const DURATION_UNITS: { value: DurationUnit; label: string }[] = [
  { value: "s", label: "seconds" },
  { value: "m", label: "minutes" },
  { value: "h", label: "hours" },
  { value: "d", label: "days" },
];

/** Milliseconds, or `null` when the value is not a duration at all. */
export function toMilliseconds(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  }
  if (typeof value !== "string") return null;
  const match = WRITTEN.exec(value);
  if (!match) return null;
  const [, amount, unit] = match;
  if (amount === undefined || unit === undefined) return null;
  return Number(amount) * UNIT_MS[unit as DurationUnit];
}

/**
 * Splits a duration into the number and unit the control shows. An amount that
 * does not divide evenly falls to the next unit down, so 90 minutes stays 90
 * minutes rather than becoming one and a half hours.
 */
export function formatDuration(value: unknown): DurationParts {
  const ms = toMilliseconds(value);
  if (ms === null || ms <= 0) return { amount: 0, unit: "s" };
  for (const unit of UNITS) {
    const size = UNIT_MS[unit];
    if (ms >= size && ms % size === 0) return { amount: ms / size, unit };
  }
  return { amount: Math.round(ms / 1000), unit: "s" };
}

export function toDurationString(parts: DurationParts): string {
  return `${parts.amount}${parts.unit}`;
}

/** "15m" becomes "15 minutes", for hint text that reads as a sentence. */
export function describeDuration(value: unknown): string {
  const { amount, unit } = formatDuration(value);
  const name = UNIT_NAMES[unit];
  return `${amount} ${name}${amount === 1 ? "" : "s"}`;
}

/** "10m" becomes "10 min", for a header that has room for a few characters only. */
export function shortDuration(value: unknown): string {
  const { amount, unit } = formatDuration(value);
  const name = unit === "s" ? "sec" : unit === "m" ? "min" : unit === "h" ? "hr" : amount === 1 ? "day" : "days";
  return `${amount} ${name}`;
}

/** How many milliseconds one of a unit is, for turning a ceiling into a bound. */
export function unitMilliseconds(unit: DurationUnit): number {
  return UNIT_MS[unit];
}
