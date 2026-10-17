/**
 * The arithmetic behind the moderator stats, kept free of Discord and the
 * database so it can be tested with plain arrays. The handler queries rows,
 * calls this, then resolves user ids to names.
 */

import { isInForce } from "@tier0/core";

export interface StatsInfraction {
  userId: string;
  moderatorId: string;
  action: string;
  createdAt: Date;
  expiresAt: Date | null;
  active: boolean;
  voidedAt: Date | null;
  /** Only automod's is read, to find which rule fired. */
  reason?: string | null;
}

export interface StatsNote {
  authorId: string;
  createdAt: Date;
}

export interface StatsModerator {
  userId: string;
  total: number;
  warn: number;
  timeout: number;
  kick: number;
  ban: number;
  notes: number;
  voided: number;
  lastActionAt: string | null;
}

export interface StatsTotalsResult {
  actions: number;
  warns: number;
  timeouts: number;
  kicks: number;
  bans: number;
  unbans: number;
  voided: number;
  notes: number;
  membersWithRecord: number;
  activeNow: number;
}

export type StatsRangeKind = "days" | "all" | "custom";
export type StatsBucket = "day" | "week" | "month";

/** Which stretch of time the stats cover. Custom dates are whole UTC days, `YYYY-MM-DD`, both included. */
export type StatsRange = { kind: "days"; days: number } | { kind: "all" } | { kind: "custom"; from: string; to: string };

export interface StatsPoint {
  /** First day the point covers. */
  date: string;
  /** Last day the point covers, set only when the point is a week or a month. */
  end?: string;
  warn: number;
  timeout: number;
  kick: number;
  ban: number;
  other: number;
}

export interface StatsResult {
  days: number;
  since: string;
  /** Last day in the range, `YYYY-MM-DD`. */
  until: string;
  range: StatsRangeKind;
  bucket: StatsBucket;
  totals: StatsTotalsResult;
  /** The same totals for the equal-length period just before this one, or null when no history predates the range or the range is all time. */
  previous: StatsTotalsResult | null;
  perDay: StatsPoint[];
  byAction: { action: string; count: number }[];
  moderators: StatsModerator[];
  topMembers: { userId: string; count: number }[];
  byHour: number[];
  repeatRate: number | null;
  automod: AutomodStats;
}

export interface AutomodStats {
  total: number;
  /** Null when `previous` is null: with no history there is nothing honest to compare with. */
  previousTotal: number | null;
  byRule: { rule: string; count: number }[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const AUTOMOD_RULES_SHOWN = 10;
const REPEAT_WINDOW_MS = 30 * DAY_MS;
const REPEAT_MIN_MEMBERS = 5;
const TOP_MEMBERS = 10;

/**
 * Reversals and automod entries say nothing about how often staff had to act
 * on a person, so the repeat rate leaves them out of both who was actioned and
 * who repeated.
 */
const countsTowardRepeats = (action: string): boolean =>
  action !== "unban" && action !== "timeout-clear" && !action.startsWith("automod-");

const utcMidnight = (date: Date): number =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export const DEFAULT_DAYS = 30;
export const MAX_DAYS = 365;
/** Two years. Past that the per-day rows would only be read as months anyway, which All time already gives. */
export const MAX_CUSTOM_DAYS = 731;

/** Midnight UTC of a `YYYY-MM-DD` day, or null for anything that is not a real calendar date. */
export function dayMs(text: string | null | undefined): number | null {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number) as [number, number, number];
  const ms = Date.UTC(year, month - 1, day);
  return isoDay(ms) === text ? ms : null;
}

/**
 * Reads `?range=all`, `?from=&to=` or `?days=`. A custom range that is
 * malformed, reversed, starts in the future or runs past MAX_CUSTOM_DAYS falls
 * back to the days reading rather than failing, because a hand-edited URL
 * should still show a page. An end date past today is pulled back to today.
 */
export function parseStatsRange(query: URLSearchParams, now: Date): StatsRange {
  if (query.get("range") === "all") return { kind: "all" };
  const fromMs = dayMs(query.get("from"));
  const toRaw = dayMs(query.get("to"));
  if (fromMs !== null && toRaw !== null) {
    const toMs = Math.min(toRaw, utcMidnight(now));
    if (fromMs <= toMs && (toMs - fromMs) / DAY_MS + 1 <= MAX_CUSTOM_DAYS) {
      return { kind: "custom", from: isoDay(fromMs), to: isoDay(toMs) };
    }
  }
  const days = Math.min(MAX_DAYS, Math.max(1, Math.trunc(Number(query.get("days"))) || DEFAULT_DAYS));
  return { kind: "days", days };
}

/** Days up to three months stay days; up to two years become weeks; longer becomes months. */
export function bucketFor(days: number): StatsBucket {
  if (days <= 92) return "day";
  if (days <= MAX_CUSTOM_DAYS) return "week";
  return "month";
}

function bucketKey(date: string, bucket: StatsBucket): string {
  if (bucket === "month") return date.slice(0, 7);
  if (bucket === "day") return date;
  const ms = dayMs(date)!;
  const sinceMonday = (new Date(ms).getUTCDay() + 6) % 7;
  return isoDay(ms - sinceMonday * DAY_MS);
}

/**
 * Sums consecutive days into weeks (starting Monday) or calendar months. The
 * first and last points are clipped to the range, so `date` and `end` say
 * which days a point really covers rather than the whole week or month.
 */
export function bucketSeries(perDay: StatsPoint[], bucket: StatsBucket): StatsPoint[] {
  if (bucket === "day") return perDay;
  const points: StatsPoint[] = [];
  let key: string | null = null;
  for (const day of perDay) {
    const next = bucketKey(day.date, bucket);
    if (next !== key || points.length === 0) {
      key = next;
      points.push({ date: day.date, end: day.date, warn: 0, timeout: 0, kick: 0, ban: 0, other: 0 });
    }
    const point = points[points.length - 1]!;
    point.end = day.date;
    point.warn += day.warn;
    point.timeout += day.timeout;
    point.kick += day.kick;
    point.ban += day.ban;
    point.other += day.other;
  }
  return points;
}

/** Counts of each action kind, with everything that is not one of the four main ones lumped together. */
type Kind = "warn" | "timeout" | "kick" | "ban" | "other";

function kindOf(action: string): Kind {
  return action === "warn" || action === "timeout" || action === "kick" || action === "ban" ? action : "other";
}

/**
 * Counts for the half-open window [fromMs, untilMs), by the same rules the
 * current range uses: removed actions are tallied only as `voided`, notes are
 * counted whether or not they were later deleted. The two standing figures
 * are passed in because they are not counts of events in the window.
 */
function totalsForWindow(
  infractions: StatsInfraction[],
  notes: StatsNote[],
  fromMs: number,
  untilMs: number,
  carried: Pick<StatsTotalsResult, "membersWithRecord" | "activeNow">,
): StatsTotalsResult {
  const totals: StatsTotalsResult = {
    actions: 0,
    warns: 0,
    timeouts: 0,
    kicks: 0,
    bans: 0,
    unbans: 0,
    voided: 0,
    notes: 0,
    ...carried,
  };
  const within = (date: Date): boolean => date.getTime() >= fromMs && date.getTime() < untilMs;

  for (const row of infractions) {
    if (!within(row.createdAt)) continue;
    if (row.voidedAt) {
      totals.voided++;
      continue;
    }
    totals.actions++;
    const kind = kindOf(row.action);
    if (kind === "warn") totals.warns++;
    else if (kind === "timeout") totals.timeouts++;
    else if (kind === "kick") totals.kicks++;
    else if (kind === "ban") totals.bans++;
    else if (row.action === "unban") totals.unbans++;
  }
  for (const note of notes) if (within(note.createdAt)) totals.notes++;
  return totals;
}

const isAutomod = (action: string): boolean => action.startsWith("automod-");

/**
 * The rule is the text before the first colon, so a bare rule name and
 * `rule: detail` group together. Case is folded because the reason is free
 * text written by whatever version of automod made the entry.
 */
export function automodRuleOf(reason: string | null | undefined): string {
  const head = (reason ?? "").split(":")[0]!.trim().toLowerCase();
  return head === "" ? "unknown" : head;
}

/** Ranked rules, with everything past the shown ones summed into a final "other". */
function rankRules(counts: Map<string, number>): { rule: string; count: number }[] {
  const ranked = [...counts]
    .map(([rule, count]) => ({ rule, count }))
    .sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule));
  if (ranked.length <= AUTOMOD_RULES_SHOWN) return ranked;
  const rest = ranked.slice(AUTOMOD_RULES_SHOWN).reduce((sum, item) => sum + item.count, 0);
  return [...ranked.slice(0, AUTOMOD_RULES_SHOWN), { rule: "other", count: rest }];
}

/** Members with at least one entry still on the record that was made before `untilMs`. */
function membersWithRecordBefore(infractions: StatsInfraction[], untilMs: number): number {
  const members = new Set<string>();
  for (const row of infractions) {
    if (!row.voidedAt && row.createdAt.getTime() < untilMs) members.add(row.userId);
  }
  return members.size;
}

/**
 * The range is `days` whole UTC days ending with the day that contains `now`,
 * so a 7 day range always has seven rows in perDay and starts at midnight.
 * `infractions` and `notes` must both cover all time: membersWithRecord,
 * activeNow and the repeat rate look back past the range, and the comparison
 * period needs the `days` before it.
 *
 * The comparison period is the same stretch of time shifted back by `days`
 * days: [since - days, now - days). The range ends partway through today, so
 * comparing it with whole days would make every early-in-the-day reading look
 * like a collapse; shifting `now` back as well keeps the two equally long.
 * `previous.membersWithRecord` is counted as of the end of that window from
 * the entries still on the record. `previous.activeNow` is a copy of the
 * current figure: whether a ban or timeout was in force then depends on when
 * it was cleared, which is not stored, so no honest past value exists.
 *
 * `range` overrides `days`. All time starts on the day of the earliest entry
 * or note, removed ones included, and has no comparison period because
 * nothing comes before it. A custom range covers its two dates in full, or up
 * to `now` when it ends today, and compares with the same number of days
 * before it. Long ranges come back as weeks or months (see bucketFor); every
 * other figure is unaffected by that.
 */
export function computeStats(input: {
  infractions: StatsInfraction[];
  notes: StatsNote[];
  now: Date;
  days?: number;
  range?: StatsRange;
}): StatsResult {
  const { now } = input;
  const range: StatsRange = input.range ?? { kind: "days", days: input.days ?? DEFAULT_DAYS };
  const nowMs = now.getTime();
  const todayMs = utcMidnight(now);

  let sinceMs: number;
  let lastDayMs = todayMs;
  if (range.kind === "all") {
    let earliest = todayMs;
    for (const row of input.infractions) earliest = Math.min(earliest, utcMidnight(row.createdAt));
    for (const note of input.notes) earliest = Math.min(earliest, utcMidnight(note.createdAt));
    sinceMs = earliest;
  } else if (range.kind === "custom") {
    const fromMs = dayMs(range.from);
    const toMs = dayMs(range.to);
    lastDayMs = toMs === null ? todayMs : Math.min(toMs, todayMs);
    sinceMs = fromMs === null ? lastDayMs : Math.min(fromMs, lastDayMs);
  } else {
    sinceMs = todayMs - (Math.max(1, Math.trunc(range.days)) - 1) * DAY_MS;
  }
  const days = Math.round((lastDayMs - sinceMs) / DAY_MS) + 1;
  const endsToday = lastDayMs === todayMs;
  // Exclusive end of the range, used to shift the comparison window back.
  const endMs = endsToday ? nowMs : lastDayMs + DAY_MS;
  const inRangeMs = (ms: number): boolean => ms >= sinceMs && (endsToday ? ms <= nowMs : ms < endMs);
  const inRange = (date: Date): boolean => inRangeMs(date.getTime());

  const perDay = Array.from({ length: days }, (_, index) => ({
    date: new Date(sinceMs + index * DAY_MS).toISOString().slice(0, 10),
    warn: 0,
    timeout: 0,
    kick: 0,
    ban: 0,
    other: 0,
  }));
  const dayIndex = new Map(perDay.map((day, index) => [day.date, index]));

  const totals = {
    actions: 0,
    warns: 0,
    timeouts: 0,
    kicks: 0,
    bans: 0,
    unbans: 0,
    voided: 0,
    notes: 0,
    membersWithRecord: 0,
    activeNow: 0,
  };
  const byAction = new Map<string, number>();
  const byMember = new Map<string, number>();
  const byHour = new Array<number>(24).fill(0);
  const moderators = new Map<string, StatsModerator>();
  const moderator = (userId: string): StatsModerator => {
    let entry = moderators.get(userId);
    if (!entry) {
      entry = { userId, total: 0, warn: 0, timeout: 0, kick: 0, ban: 0, notes: 0, voided: 0, lastActionAt: null };
      moderators.set(userId, entry);
    }
    return entry;
  };

  let automodTotal = 0;
  const automodByRule = new Map<string, number>();

  const withRecord = new Set<string>();
  const keptByMember = new Map<string, number[]>();
  const actioned = new Set<string>();

  for (const row of input.infractions) {
    if (row.voidedAt) {
      if (inRange(row.createdAt)) {
        totals.voided++;
        moderator(row.moderatorId).voided++;
      }
      continue;
    }

    withRecord.add(row.userId);
    if (countsTowardRepeats(row.action)) {
      const times = keptByMember.get(row.userId);
      if (times) times.push(row.createdAt.getTime());
      else keptByMember.set(row.userId, [row.createdAt.getTime()]);
      if (inRange(row.createdAt)) actioned.add(row.userId);
    }

    if (isInForce({ action: row.action, active: row.active, expiresAt: row.expiresAt, removed: false }, now)) {
      totals.activeNow++;
    }

    if (!inRange(row.createdAt)) continue;

    const kind = kindOf(row.action);
    totals.actions++;
    if (kind === "warn") totals.warns++;
    else if (kind === "timeout") totals.timeouts++;
    else if (kind === "kick") totals.kicks++;
    else if (kind === "ban") totals.bans++;
    else if (row.action === "unban") totals.unbans++;

    if (isAutomod(row.action)) {
      automodTotal++;
      const rule = automodRuleOf(row.reason);
      automodByRule.set(rule, (automodByRule.get(rule) ?? 0) + 1);
    }

    const day = dayIndex.get(row.createdAt.toISOString().slice(0, 10));
    if (day !== undefined) perDay[day]![kind]++;

    byAction.set(row.action, (byAction.get(row.action) ?? 0) + 1);
    byMember.set(row.userId, (byMember.get(row.userId) ?? 0) + 1);
    byHour[row.createdAt.getUTCHours()]!++;

    const mod = moderator(row.moderatorId);
    mod.total++;
    if (kind !== "other") mod[kind]++;
    const at = row.createdAt.toISOString();
    if (mod.lastActionAt === null || at > mod.lastActionAt) mod.lastActionAt = at;
  }

  for (const note of input.notes) {
    if (!inRange(note.createdAt)) continue;
    totals.notes++;
    moderator(note.authorId).notes++;
  }
  totals.membersWithRecord = withRecord.size;

  // A member counts as repeating when any in-range action had an earlier one
  // for the same member inside the 30 days before it.
  let repeating = 0;
  for (const userId of actioned) {
    const times = keptByMember.get(userId)!.sort((a, b) => a - b);
    const repeated = times.some((time, i) => i > 0 && inRangeMs(time) && time - times[i - 1]! <= REPEAT_WINDOW_MS);
    if (repeated) repeating++;
  }
  const repeatRate = actioned.size < REPEAT_MIN_MEMBERS ? null : repeating / actioned.size;

  // With nothing dated before the range there is no baseline, and a row of
  // zeros would read as "everything is up infinitely".
  const hasHistory =
    range.kind !== "all" &&
    (input.infractions.some((row) => row.createdAt.getTime() < sinceMs) ||
      input.notes.some((note) => note.createdAt.getTime() < sinceMs));
  const previousFromMs = sinceMs - days * DAY_MS;
  const previousUntilMs = endMs - days * DAY_MS;
  const previous = hasHistory
    ? totalsForWindow(input.infractions, input.notes, previousFromMs, previousUntilMs, {
        membersWithRecord: membersWithRecordBefore(input.infractions, previousUntilMs),
        activeNow: totals.activeNow,
      })
    : null;

  const previousAutomod = previous
    ? input.infractions.filter(
        (row) =>
          !row.voidedAt &&
          isAutomod(row.action) &&
          row.createdAt.getTime() >= previousFromMs &&
          row.createdAt.getTime() < previousUntilMs,
      ).length
    : null;

  const byCountThenKey = <T>(count: (item: T) => number, key: (item: T) => string) =>
    (a: T, b: T): number => count(b) - count(a) || key(a).localeCompare(key(b));

  const bucket = bucketFor(days);
  return {
    days,
    since: new Date(sinceMs).toISOString(),
    until: isoDay(lastDayMs),
    range: range.kind,
    bucket,
    totals,
    previous,
    perDay: bucketSeries(perDay, bucket),
    byAction: [...byAction].map(([action, count]) => ({ action, count })).sort(byCountThenKey((x) => x.count, (x) => x.action)),
    moderators: [...moderators.values()].sort(byCountThenKey((x) => x.total, (x) => x.userId)),
    topMembers: [...byMember]
      .map(([userId, count]) => ({ userId, count }))
      .sort(byCountThenKey((x) => x.count, (x) => x.userId))
      .slice(0, TOP_MEMBERS),
    byHour,
    repeatRate,
    automod: { total: automodTotal, previousTotal: previousAutomod, byRule: rankRules(automodByRule) },
  };
}
