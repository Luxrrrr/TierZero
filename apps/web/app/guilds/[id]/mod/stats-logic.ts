/**
 * Arithmetic behind the mod overview charts. No React here so it can be tested
 * on its own and the chart components stay a thin layer of markup.
 */

export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];
export const DEFAULT_RANGE: Range = 30;

/** Anything other than 7, 30 or 90 falls back to the default, so a hand-edited URL never reaches the bot. */
export function parseRange(raw: string | string[] | undefined): Range {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const days = Number(value);
  return (RANGES as readonly number[]).includes(days) ? (days as Range) : DEFAULT_RANGE;
}

/** The range the Overview shows: one of the preset lengths ending today, everything on record, or two UTC dates. */
export type RangeSpec = { kind: "days"; days: Range } | { kind: "all" } | { kind: "custom"; from: string; to: string };

export const DEFAULT_SPEC: RangeSpec = { kind: "days", days: DEFAULT_RANGE };

/** Two years, the same cap the bot applies. All time covers anything longer. */
export const MAX_CUSTOM_DAYS = 731;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC of a `YYYY-MM-DD` day, or null for anything that is not a real calendar date. */
export function dayMs(text: string | null | undefined): number | null {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number) as [number, number, number];
  const ms = Date.UTC(year, month - 1, day);
  return new Date(ms).toISOString().slice(0, 10) === text ? ms : null;
}

type SearchValue = string | string[] | undefined;
const first = (value: SearchValue): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * Reads `?range=all`, `?from=&to=` or `?days=` from the page URL. A custom
 * range that is malformed, reversed, starts after `today` or runs longer than
 * MAX_CUSTOM_DAYS falls back to the days reading, so a hand-edited URL still
 * shows a page. An end after today is pulled back to today.
 */
export function parseRangeSpec(
  params: { days?: SearchValue; range?: SearchValue; from?: SearchValue; to?: SearchValue },
  today: string,
): RangeSpec {
  if (first(params.range) === "all") return { kind: "all" };
  const fromMs = dayMs(first(params.from));
  const toRaw = dayMs(first(params.to));
  const todayMs = dayMs(today);
  if (fromMs !== null && toRaw !== null && todayMs !== null) {
    const toMs = Math.min(toRaw, todayMs);
    if (fromMs <= toMs && (toMs - fromMs) / DAY_MS + 1 <= MAX_CUSTOM_DAYS) {
      return { kind: "custom", from: first(params.from)!, to: new Date(toMs).toISOString().slice(0, 10) };
    }
  }
  return { kind: "days", days: parseRange(params.days) };
}

/** Whether the address asked for a date range that was not used, so the page can say it fell back instead of doing so silently. */
export function rangeWasRejected(params: { range?: SearchValue; from?: SearchValue; to?: SearchValue }, spec: RangeSpec): boolean {
  if (first(params.range) === "all" || spec.kind === "custom") return false;
  return first(params.from) !== undefined || first(params.to) !== undefined;
}

/** The query the bot and the page both read for a range. */
export function rangeParams(spec: RangeSpec): { days?: number; range?: "all"; from?: string; to?: string } {
  if (spec.kind === "all") return { range: "all" };
  if (spec.kind === "custom") return { from: spec.from, to: spec.to };
  return { days: spec.days };
}

export function rangeQuery(spec: RangeSpec): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(rangeParams(spec))) search.set(key, String(value));
  return search.toString();
}

export function rangeHref(guildId: string, spec: RangeSpec): string {
  return `/guilds/${guildId}/mod?${rangeQuery(spec)}`;
}

/** The Overview's CSV, through the dashboard proxy, for the same range the page shows. */
export function statsExportHref(guildId: string, spec: RangeSpec): string {
  return `/api/guilds/${guildId}/mod/stats/export?${rangeQuery(spec)}`;
}

export type Bucket = "day" | "week" | "month";

export function bucketOf(value: unknown): Bucket {
  return value === "week" || value === "month" ? value : "day";
}

export const SERIES = ["warn", "timeout", "kick", "ban", "other"] as const;
export type Series = (typeof SERIES)[number];

export interface DayCounts {
  date: string;
  /** Last day covered, when the point is a week or a month. */
  end?: string;
  warn: number;
  timeout: number;
  kick: number;
  ban: number;
  other: number;
}

export function dayTotal(day: DayCounts): number {
  return day.warn + day.timeout + day.kick + day.ban + day.other;
}

/**
 * Top of the chart's value axis: the smallest of 1, 2, 5, 10, 20, 50... that
 * holds the tallest day, with a floor so a quiet week does not stretch one
 * warn to the full height.
 */
export function niceMax(peak: number, floor = 4): number {
  const target = Math.max(peak, floor);
  const magnitude = 10 ** Math.floor(Math.log10(target));
  for (const step of [1, 2, 5, 10]) {
    if (step * magnitude >= target) return step * magnitude;
  }
  return 10 * magnitude;
}

export interface Segment {
  series: Series;
  count: number;
  /** Height as a percentage of the full column. */
  percent: number;
}

/** Stacked segments for one day, bottom to top in SERIES order. Empty and switched-off series are left out. */
export function segmentsFor(day: DayCounts, axisMax: number, hidden: readonly Series[] = []): Segment[] {
  return SERIES.filter((series) => day[series] > 0 && !hidden.includes(series)).map((series) => ({
    series,
    count: day[series],
    percent: axisMax > 0 ? (day[series] / axisMax) * 100 : 0,
  }));
}

/** Evenly spaced gridline values from zero to the axis maximum, in steps that stay whole numbers for the maxima niceMax produces. */
export function gridValues(axisMax: number): number[] {
  const lines = axisMax % 4 === 0 ? 4 : 5;
  const values: number[] = [];
  for (let i = 0; i <= lines; i++) values.push(Math.round((axisMax / lines) * i * 100) / 100);
  return values;
}

/** Indexes worth labelling along the date axis: both ends and a few between, never crowded. */
export function labelIndexes(length: number, wanted = 5): number[] {
  if (length <= 0) return [];
  if (length <= wanted) return Array.from({ length }, (_, i) => i);
  const result = new Set<number>();
  for (let i = 0; i < wanted; i++) result.add(Math.round((i * (length - 1)) / (wanted - 1)));
  return [...result];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-08" as "8 Sep", read from the string so the viewer's timezone cannot shift the day. */
export function shortDate(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  if (!month || !day) return date;
  return `${day} ${MONTHS[month - 1] ?? ""}`.trim();
}

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count.toLocaleString("en")} ${count === 1 ? word : many}`;
}

/** "Mar 2025", for a month point. */
export function monthLabel(date: string): string {
  const [year, month] = date.split("-").map(Number);
  if (!year || !month) return date;
  return `${MONTHS[month - 1] ?? ""} ${year}`.trim();
}

/** "8 Sep 2026". */
export function longDate(date: string): string {
  const year = date.split("-")[0];
  return year ? `${shortDate(date)} ${year}` : date;
}

/** What a point is called under the chart: its first day, or its month. */
export function pointLabel(point: DayCounts, bucket: Bucket = "day"): string {
  return bucket === "month" ? monthLabel(point.date) : shortDate(point.date);
}

/**
 * The days a point covers, for tooltips and summaries. A week reads as its
 * first and last day, which the bot clips to the range, so the first and last
 * weeks can be shorter than seven days.
 */
export function pointTitle(point: DayCounts, bucket: Bucket = "day"): string {
  if (bucket === "month") return monthLabel(point.date);
  if (bucket === "week") {
    const end = point.end ?? point.date;
    return end === point.date ? shortDate(point.date) : `${shortDate(point.date)} to ${shortDate(end)}`;
  }
  return shortDate(point.date);
}

export interface ChartSummaryInput {
  perDay: DayCounts[];
  bucket?: Bucket;
}

/** One sentence for the chart's accessible name. */
export function chartSummary({ perDay, bucket = "day" }: ChartSummaryInput): string {
  if (perDay.length === 0) return "No days in this range.";
  const total = perDay.reduce((sum, day) => sum + dayTotal(day), 0);
  if (total === 0) return `No actions across ${plural(perDay.length, bucket)}.`;
  let busiest = perDay[0]!;
  for (const day of perDay) if (dayTotal(day) > dayTotal(busiest)) busiest = day;
  return `${plural(total, "action")} across ${plural(perDay.length, bucket)}. The busiest ${bucket} was ${pointTitle(busiest, bucket)} with ${dayTotal(busiest)}.`;
}

export function dayTooltip(day: DayCounts): string {
  const total = dayTotal(day);
  if (total === 0) return `${shortDate(day.date)}: no actions`;
  const parts = SERIES.filter((series) => day[series] > 0).map((series) => `${day[series]} ${series}`);
  return `${shortDate(day.date)}: ${plural(total, "action")} (${parts.join(", ")})`;
}

export interface ActionBar {
  action: string;
  count: number;
  /** Width as a percentage of the largest bar, so the top row always fills the track. */
  percent: number;
  /** Share of every action in the list, for the label. */
  share: number;
}

export function actionBars(byAction: { action: string; count: number }[]): ActionBar[] {
  const rows = byAction.filter((row) => row.count > 0).sort((a, b) => b.count - a.count);
  const largest = rows[0]?.count ?? 0;
  const sum = rows.reduce((total, row) => total + row.count, 0);
  return rows.map((row) => ({
    action: row.action,
    count: row.count,
    percent: largest > 0 ? (row.count / largest) * 100 : 0,
    share: sum > 0 ? row.count / sum : 0,
  }));
}

/** A moderator's part of everything done in the range, as a 0 to 100 figure. */
export function sharePercent(part: number, whole: number): number {
  if (whole <= 0 || part <= 0) return 0;
  return Math.min(100, (part / whole) * 100);
}

export function formatPercent(value: number): string {
  if (value > 0 && value < 1) return "<1%";
  return `${Math.round(value)}%`;
}

export interface HourCell {
  hour: number;
  count: number;
  /** 0 for none, then 1 to 4 in rising strength. */
  level: 0 | 1 | 2 | 3 | 4;
}

/** Buckets each hour against the busiest one, so a quiet server still shows where its peak is. */
export function hourCells(byHour: number[]): HourCell[] {
  const counts = Array.from({ length: 24 }, (_, hour) => Math.max(0, byHour[hour] ?? 0));
  const peak = Math.max(...counts);
  return counts.map((count, hour) => {
    let level: HourCell["level"] = 0;
    if (count > 0 && peak > 0) {
      const ratio = count / peak;
      level = ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
    }
    return { hour, count, level };
  });
}

export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** The busiest hour as a range, or null when nothing happened. Ties go to the earlier hour. */
export function peakHourText(byHour: number[]): string | null {
  const cells = hourCells(byHour);
  let best = cells[0]!;
  for (const cell of cells) if (cell.count > best.count) best = cell;
  if (best.count === 0) return null;
  return `${hourLabel(best.hour)} to ${hourLabel((best.hour + 1) % 24)} UTC`;
}

/**
 * The repeat rate in plain words. The figure is the share (0 to 1) of members
 * actioned in the range who were actioned again within 30 days of an earlier
 * action, so it reads as a percentage of people.
 */
export function repeatRateText(share: number | null): { headline: string; detail: string } {
  if (share === null || !Number.isFinite(share) || share < 0 || share > 1) {
    return {
      headline: "Not enough members actioned to say yet",
      detail: "Once at least five members have been actioned in this range, the share who repeat appears here.",
    };
  }
  const percent = Math.round(share * 100);
  return {
    headline: `${percent}% of actioned members were actioned again within 30 days`,
    detail:
      percent === 0
        ? "Nobody actioned in this range was actioned again soon after, so the actions are not coming back."
        : "A high share suggests warnings are not changing behaviour, or that the same few members keep returning.",
  };
}

/** Whether the whole range holds nothing worth charting. */
export function isQuiet(totals: { actions: number; notes: number }): boolean {
  return totals.actions === 0 && totals.notes === 0;
}

/* Period, comparison and sparklines --------------------------------------- */

export interface StatsTotalsLike {
  actions: number;
  warns: number;
  timeouts: number;
  kicks: number;
  bans: number;
  voided: number;
  notes: number;
}

export type MetricKey = "actions" | "warns" | "timeouts" | "kicksBans" | "voided" | "notes";

/** Which direction counts as an improvement. More notes or removals say nothing about how a server is doing. */
export type Polarity = "lower" | "neutral";

export const METRIC_POLARITY: Record<MetricKey, Polarity> = {
  actions: "lower",
  warns: "lower",
  timeouts: "lower",
  kicksBans: "lower",
  voided: "neutral",
  notes: "neutral",
};

export function metricValue(totals: StatsTotalsLike, key: MetricKey): number {
  if (key === "kicksBans") return totals.kicks + totals.bans;
  return totals[key];
}

export interface Change {
  trend: "up" | "down" | "flat";
  verdict: "good" | "bad" | "neutral";
  /** Signed relative change, or null when the earlier period had nothing to compare against. */
  percent: number | null;
  delta: number;
  /** Short unsigned text for the indicator; the arrow carries the direction. */
  label: string;
}

/** Null when there is no earlier period to compare with. */
export function changeBetween(current: number, previous: number | null | undefined, polarity: Polarity): Change | null {
  if (previous === null || previous === undefined || !Number.isFinite(previous) || previous < 0) return null;
  const delta = current - previous;
  const trend: Change["trend"] = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const verdict: Change["verdict"] =
    trend === "flat" || polarity === "neutral" ? "neutral" : trend === "down" ? "good" : "bad";

  if (previous === 0) {
    return { trend, verdict, percent: null, delta, label: trend === "flat" ? "No change" : "New" };
  }
  const percent = (delta / previous) * 100;
  const size = Math.abs(percent);
  const label = trend === "flat" ? "No change" : size < 1 ? "<1%" : size > 999 ? ">999%" : `${Math.round(size)}%`;
  return { trend, verdict, percent, delta, label };
}

/** The sentence a screen reader gets in place of the arrow and percentage. */
export function changeSentence(change: Change, previousValue: number, days: number): string {
  const earlier = `the previous ${plural(days, "day")}`;
  const before = previousValue.toLocaleString("en");
  if (change.trend === "flat") return `Unchanged from ${before} in ${earlier}.`;
  const direction = change.trend === "up" ? "Up" : "Down";
  const size = change.percent === null ? "" : ` ${change.label}`;
  const verdict = change.verdict === "good" ? " (better)" : change.verdict === "bad" ? " (worse)" : "";
  return `${direction}${size} from ${before} in ${earlier}${verdict}.`;
}

/** Per-day values behind a tile sparkline, or null for figures the daily series does not carry. */
export function sparkValues(perDay: DayCounts[], key: MetricKey): number[] | null {
  switch (key) {
    case "actions":
      return perDay.map(dayTotal);
    case "warns":
      return perDay.map((day) => day.warn);
    case "timeouts":
      return perDay.map((day) => day.timeout);
    case "kicksBans":
      return perDay.map((day) => day.kick + day.ban);
    default:
      return null;
  }
}

/**
 * Path data for a sparkline in a width by height box. A flat run sits on the
 * bottom edge rather than the middle so "nothing happened" does not look like
 * "steady".
 */
export function sparkPaths(
  values: number[],
  width: number,
  height: number,
  pad = 2,
): { line: string; area: string } | null {
  if (values.length < 2) return null;
  const peak = Math.max(...values, 1);
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const points = values.map((value, index) => {
    const x = pad + (index / (values.length - 1)) * innerW;
    const y = pad + innerH - (Math.max(0, value) / peak) * innerH;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as const;
  });
  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
  const base = height - pad;
  const area = `${line} L${points[points.length - 1]![0]} ${base} L${points[0]![0]} ${base} Z`;
  return { line, area };
}

/** "12 Sep to 10 Oct 2026", from the first and last day the bot reported. */
export function periodText(perDay: DayCounts[]): string | null {
  const start = perDay[0]?.date;
  const lastPoint = perDay[perDay.length - 1];
  const last = lastPoint?.end ?? lastPoint?.date;
  if (!start || !last) return null;
  return spanText(start, last);
}

/** "12 Sep to 10 Oct 2026", with both years when the span crosses one. */
export function spanText(start: string, last: string): string {
  if (start === last) return longDate(last);
  const sameYear = start.slice(0, 4) === last.slice(0, 4);
  return `${sameYear ? shortDate(start) : longDate(start)} to ${longDate(last)}`;
}

export interface RangeWordsInput {
  days: number;
  since: string;
  until?: string;
  range?: string;
}

/**
 * The range as words that finish a sentence: "in the last 30 days", "since
 * 14 Mar 2025" or "from 1 Sep to 3 Oct 2026". Read from the stats reply, so
 * it describes what the bot actually counted.
 */
export function rangePhrase(stats: RangeWordsInput): string {
  const start = stats.since.slice(0, 10);
  if (stats.range === "all") return `since ${longDate(start)}`;
  if (stats.range === "custom" && stats.until) {
    return start === stats.until ? `on ${longDate(start)}` : `from ${spanText(start, stats.until)}`;
  }
  return `in the last ${plural(stats.days, "day")}`;
}

/** The next longer range, offered when the current one is empty. */
export function longerRange(days: number): Range | null {
  const index = (RANGES as readonly number[]).indexOf(days);
  return index >= 0 && index < RANGES.length - 1 ? RANGES[index + 1]! : null;
}

/* Per-day chart state ------------------------------------------------------- */

export const SERIES_LABEL: Record<Series, string> = {
  warn: "Warns",
  timeout: "Timeouts",
  kick: "Kicks",
  ban: "Bans",
  other: "Other",
};

export function seriesOf(action: string): Series {
  return (SERIES as readonly string[]).includes(action) ? (action as Series) : "other";
}

export function seriesTotals(perDay: DayCounts[]): Record<Series, number> {
  const totals: Record<Series, number> = { warn: 0, timeout: 0, kick: 0, ban: 0, other: 0 };
  for (const day of perDay) for (const series of SERIES) totals[series] += day[series];
  return totals;
}

/** A day's total counting only the series that are switched on. */
export function visibleTotal(day: DayCounts, hidden: readonly Series[]): number {
  return SERIES.reduce((sum, series) => (hidden.includes(series) ? sum : sum + day[series]), 0);
}

/** Series that actually occur, so the legend does not offer a toggle for something that is always zero. */
export function presentSeries(perDay: DayCounts[]): Series[] {
  const totals = seriesTotals(perDay);
  return SERIES.filter((series) => totals[series] > 0);
}

export function toggled(hidden: readonly Series[], series: Series): Series[] {
  return hidden.includes(series) ? hidden.filter((item) => item !== series) : [...hidden, series];
}

export interface TooltipContent {
  title: string;
  total: number;
  lines: { series: Series; count: number }[];
}

export function tooltipFor(day: DayCounts, hidden: readonly Series[], bucket: Bucket = "day"): TooltipContent {
  const lines = SERIES.filter((series) => day[series] > 0 && !hidden.includes(series)).map((series) => ({
    series,
    count: day[series],
  }));
  return { title: pointTitle(day, bucket), total: visibleTotal(day, hidden), lines };
}

export function tooltipSentence(day: DayCounts, hidden: readonly Series[], bucket: Bucket = "day"): string {
  const tip = tooltipFor(day, hidden, bucket);
  if (tip.total === 0) return `${tip.title}: no actions`;
  const parts = tip.lines.map((line) => `${line.count} ${SERIES_LABEL[line.series].toLowerCase()}`);
  return `${tip.title}: ${plural(tip.total, "action")} (${parts.join(", ")})`;
}

/** Which of `length` equal columns a pointer at `x` pixels across `width` is over. */
export function indexFromPosition(x: number, width: number, length: number): number | null {
  if (length <= 0 || width <= 0) return null;
  return Math.min(length - 1, Math.max(0, Math.floor((x / width) * length)));
}

/** Where the arrow keys take a roving cursor. Starting from nothing, left begins at the end and right at the start. */
export function stepIndex(current: number | null, key: string, length: number): number | null {
  if (length <= 0) return null;
  const last = length - 1;
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return last;
    case "ArrowRight":
      return current === null ? 0 : Math.min(last, current + 1);
    case "ArrowLeft":
      return current === null ? last : Math.max(0, current - 1);
    default:
      return current;
  }
}

/* Moderator leaderboard ----------------------------------------------------- */

export interface ModeratorCounts {
  total: number;
  warn: number;
  timeout: number;
  kick: number;
  ban: number;
}

export interface MixSegment {
  series: Series;
  count: number;
  /** Width as a percentage of the moderator bar. */
  percent: number;
}

/** Split of one moderator's actions by type; whatever the named types do not account for becomes "other". */
export function moderatorMix(moderator: ModeratorCounts): MixSegment[] {
  const known = moderator.warn + moderator.timeout + moderator.kick + moderator.ban;
  const counts: Record<Series, number> = {
    warn: moderator.warn,
    timeout: moderator.timeout,
    kick: moderator.kick,
    ban: moderator.ban,
    other: Math.max(0, moderator.total - known),
  };
  const whole = SERIES.reduce((sum, series) => sum + counts[series], 0);
  return SERIES.filter((series) => counts[series] > 0).map((series) => ({
    series,
    count: counts[series],
    percent: whole > 0 ? (counts[series] / whole) * 100 : 0,
  }));
}

const SERIES_SINGULAR: Record<Series, string> = {
  warn: "warn",
  timeout: "timeout",
  kick: "kick",
  ban: "ban",
  other: "other",
};

/**
 * "9 warns, 3 timeouts, 1 ban", for the line under a moderator name. Automod
 * does not warn, time out or ban the way a person's counts do, so its line
 * counts what its rules did instead of calling all of it "other".
 */
export function mixSummary(moderator: ModeratorCounts, automod = false): string {
  if (automod) return moderator.total > 0 ? plural(moderator.total, "rule action") : "";
  return moderatorMix(moderator)
    .map((segment) =>
      segment.series === "other" ? `${segment.count} other` : plural(segment.count, SERIES_SINGULAR[segment.series]),
    )
    .join(", ");
}

export function moderatorLogHref(guildId: string, moderatorId: string): string {
  return `/guilds/${guildId}/mod/actions?moderatorId=${encodeURIComponent(moderatorId)}`;
}

/* Automod ------------------------------------------------------------------- */

export interface AutomodInput {
  total?: number;
  previousTotal?: number | null;
  byRule?: { rule: string; count: number }[];
}

export interface RuleBar {
  rule: string;
  label: string;
  count: number;
  /** Width as a percentage of the largest bar. */
  percent: number;
  /** Share of every hit, for the label. */
  share: number;
}

export interface AutomodView {
  total: number;
  previous: number | null;
  change: Change | null;
  bars: RuleBar[];
  /** One sentence for the text alternative to the bars. */
  summary: string;
}

const finiteCount = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;

/**
 * The automod card's figures, or null when the bot did not send any (an older
 * bot, or a reply from before the field existed), so the page leaves the card
 * out rather than claiming automod did nothing. Fewer hits counts as better,
 * the same as every other count of actions.
 */
export function automodView(
  automod: AutomodInput | null | undefined,
  label: (rule: string) => string,
  /** A day count for "in the last N days", or words from rangePhrase for any other range. */
  when: number | string,
): AutomodView | null {
  if (!automod || typeof automod !== "object") return null;
  const total = finiteCount(automod.total);
  const previous =
    automod.previousTotal === null || automod.previousTotal === undefined ? null : finiteCount(automod.previousTotal);
  const rows = (Array.isArray(automod.byRule) ? automod.byRule : [])
    .filter((row) => row && typeof row.rule === "string" && finiteCount(row.count) > 0)
    .map((row) => ({ rule: row.rule, count: finiteCount(row.count) }));
  const largest = rows.reduce((best, row) => Math.max(best, row.count), 0);
  const sum = rows.reduce((acc, row) => acc + row.count, 0);
  const bars = rows.map((row) => ({
    rule: row.rule,
    label: label(row.rule),
    count: row.count,
    percent: largest > 0 ? (row.count / largest) * 100 : 0,
    share: sum > 0 ? row.count / sum : 0,
  }));

  const span = typeof when === "number" ? `in the last ${plural(when, "day")}` : when;
  let summary = `Automod acted ${plural(total, "time")} ${span}.`;
  if (bars.length > 0) {
    const top = bars[0]!;
    summary += ` The rule that fired most was ${top.label.toLowerCase()} with ${top.count.toLocaleString("en")}.`;
  }
  return { total, previous, change: changeBetween(total, previous, "lower"), bars, summary };
}

export function automodLogHref(guildId: string): string {
  return `/guilds/${guildId}/mod/actions?source=automod`;
}

/* Small wording helpers ----------------------------------------------------- */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Fri 10 Oct", for the chart tooltip. Computed in UTC to match the bucketing on the bot. */
export function fullDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "";
  return `${weekday} ${shortDate(date)}`.trim();
}

/** "14:00 to 15:00 UTC" for a bucket of the hour strip. */
export function hourRange(hour: number): string {
  return `${hourLabel(hour)} to ${hourLabel((hour + 1) % 24)} UTC`;
}

const ACTION_VERB: Record<string, string> = {
  warn: "warned",
  timeout: "timed out",
  "timeout-clear": "cleared the timeout of",
  kick: "kicked",
  ban: "banned",
  unban: "unbanned",
  "automod-warn": "warned",
  "automod-timeout": "timed out",
  "automod-delete": "deleted a message from",
};

/** The verb in "Automod timed out lootpanda". An action this version does not know reads as a plain "acted on", never its code name. */
export function actionVerb(action: string): string {
  return ACTION_VERB[action] ?? "acted on";
}

/** The repeat rate as a whole percentage, or null when the backend had too few members to say. */
export function repeatPercent(share: number | null): number | null {
  if (share === null || !Number.isFinite(share) || share < 0 || share > 1) return null;
  return Math.round(share * 100);
}
