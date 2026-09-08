/**
 * Duration parsing and the limits Discord itself imposes, kept free of
 * discord.js so the 28 day timeout ceiling and the 14 day bulk-delete window
 * can be tested without a gateway connection.
 */

const PATTERN = /^(\d+)(s|m|h|d)$/;

const DAY_MS = 86_400_000;

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: DAY_MS,
};

/** Discord rejects a member timeout longer than this outright. */
export const MAX_TIMEOUT_MS = 28 * DAY_MS;

/** Discord refuses to bulk delete anything sent before this window. */
export const BULK_DELETE_WINDOW_MS = 14 * DAY_MS;

/** Parses "30s", "15m", "2h" or "7d" into milliseconds. Null if unrecognised. */
export function parseDuration(text: string): number | null {
  const match = PATTERN.exec(text.trim());
  if (!match) return null;
  const [, amount, unit] = match;
  if (amount === undefined || unit === undefined) return null;
  const factor = UNIT_MS[unit];
  if (factor === undefined) return null;
  const value = Number(amount);
  return value > 0 ? value * factor : null;
}

export type DurationCheck = { ok: true; ms: number } | { ok: false; reason: string };

/** Timeouts specifically: Discord's own API rejects anything past 28 days. */
export function validateTimeoutDuration(ms: number): DurationCheck {
  if (!Number.isFinite(ms) || ms <= 0) {
    return { ok: false, reason: "Duration must be greater than zero." };
  }
  if (ms > MAX_TIMEOUT_MS) {
    return { ok: false, reason: "Timeouts cannot be longer than 28 days - that's Discord's own limit." };
  }
  return { ok: true, ms };
}

/** Bans have no Discord-imposed ceiling, only a sanity check on the input. */
export function validateBanDuration(ms: number): DurationCheck {
  if (!Number.isFinite(ms) || ms <= 0) {
    return { ok: false, reason: "Duration must be greater than zero." };
  }
  return { ok: true, ms };
}

/** Clamps to the 0-7 days the ban endpoint accepts, then converts to seconds. */
export function deleteMessageSeconds(days: number): number {
  const clamped = Math.min(7, Math.max(0, Math.trunc(days)));
  return (clamped * DAY_MS) / 1000;
}
