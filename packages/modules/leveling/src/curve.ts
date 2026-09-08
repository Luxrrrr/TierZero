/**
 * The level curve and every other piece of arithmetic the module needs. Kept
 * free of discord.js so it can be tested as plain functions, and because the
 * test runner strips types rather than compiling them, so nothing here uses a
 * constructor with parameter properties.
 */

export interface RoleReward {
  level: number;
  role: string;
}

export interface MultiplierRule {
  role: string;
  percent: number;
}

/** Total experience per level step grows by, chosen for a smooth early curve. */
const XP_STEP = 50;

/**
 * Cumulative experience required to reach `level` starting from 0.
 *
 * total(level) = 50 * level * (level + 1)
 *
 * Chosen because the amount needed for the *next* level then grows linearly
 * (100, 200, 300, ...), which reads as a fair, gradually-steepening curve
 * without a table of hand-picked numbers, and it inverts with the quadratic
 * formula rather than a search. Defined at level 0 (total is 0) and strictly
 * increasing for every level after, so it is monotonic everywhere it is used.
 */
export function totalXpForLevel(level: number): number {
  if (level <= 0) return 0;
  return XP_STEP * level * (level + 1);
}

/** Experience needed to go from `level` to `level + 1`. */
export function xpForNextLevel(level: number): number {
  return totalXpForLevel(level + 1) - totalXpForLevel(level);
}

/**
 * The level a total experience value maps to: the greatest level whose
 * cumulative requirement does not exceed `xp`.
 *
 * Solves 50L^2 + 50L - xp = 0 for the positive root to get a starting guess,
 * then walks it to the exact boundary. The walk exists because floating-point
 * sqrt() can land the guess a step off the true root for large xp values, and
 * a level curve that is off by one near a boundary is the classic bug here.
 */
export function levelForXp(xp: number): number {
  if (xp <= 0) return 0;
  const guess = Math.floor(
    (-XP_STEP + Math.sqrt(XP_STEP * XP_STEP + 4 * XP_STEP * xp)) / (2 * XP_STEP),
  );
  let level = Math.max(0, guess);
  while (totalXpForLevel(level + 1) <= xp) level++;
  while (level > 0 && totalXpForLevel(level) > xp) level--;
  return level;
}

export interface Progress {
  level: number;
  /** Experience earned since reaching `level`. */
  into: number;
  /** Experience needed to reach the next level from `level`. */
  need: number;
}

/** Splits a total experience value into the current level and its progress. */
export function progressFor(xp: number): Progress {
  const level = levelForXp(xp);
  return {
    level,
    into: xp - totalXpForLevel(level),
    need: xpForNextLevel(level),
  };
}

/**
 * A text progress bar. Floors rather than rounds so a level only ever shows
 * as complete once `into` actually reaches `need` - rounding up would show a
 * full bar one message before the level actually changes.
 */
export function renderProgressBar(into: number, need: number, size = 10): string {
  const filled = need <= 0 ? size : Math.min(size, Math.max(0, Math.floor((into / need) * size)));
  return "█".repeat(filled) + "░".repeat(size - filled);
}

/**
 * A random amount within the configured range, so experience cannot be
 * gamed by sending identical, minimal messages as fast as the cooldown
 * allows. `rng` is injectable so the choice is testable without mocking
 * Math.random.
 */
export function xpForMessage(min: number, max: number, rng: () => number = Math.random): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return low + Math.floor(rng() * (high - low + 1));
}

/** Applies a role's experience percentage. 100 is normal, 200 is double. */
export function applyMultiplier(xp: number, percent: number): number {
  return Math.max(0, Math.round((xp * percent) / 100));
}

/**
 * The highest multiplier among a member's roles, or 100 (no change) when
 * none of their roles carry one. Highest rather than combined, so an
 * operator granting a second boosted role can never produce a surprising
 * stacked multiplier they did not configure.
 */
export function highestMultiplierPercent(
  memberRoleIds: readonly string[],
  multipliers: readonly MultiplierRule[],
): number {
  let percent = 100;
  for (const rule of multipliers) {
    if (rule.percent > percent && memberRoleIds.includes(rule.role)) {
      percent = rule.percent;
    }
  }
  return percent;
}

/**
 * Whether enough time has passed since a member's last award. Pure and
 * synchronous so the caller can hold a plain in-memory timestamp per member
 * and decide this without a database read on every message.
 */
export function canAward(lastAwardAtMs: number, nowMs: number, cooldownMs: number): boolean {
  return nowMs - lastAwardAtMs >= cooldownMs;
}

/**
 * Which reward roles a member at `level` should hold. With stacking, every
 * reward at or below the level applies; without it, only the single highest
 * one does, so a member's roster shrinks as they climb - the caller is
 * responsible for removing any reward role not in this list.
 */
export function resolveRewardRoles(
  level: number,
  rewards: readonly RoleReward[],
  stack: boolean,
): string[] {
  const eligible = rewards.filter((reward) => reward.level <= level);
  if (eligible.length === 0) return [];
  if (stack) return [...new Set(eligible.map((reward) => reward.role))];
  const highest = eligible.reduce((best, reward) => (reward.level > best.level ? reward : best));
  return [highest.role];
}
