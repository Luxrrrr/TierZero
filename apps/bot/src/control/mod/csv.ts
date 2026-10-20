import { caseStateOf, readEvidence, readableReason, warnExpiresAt, type CaseState } from "@tier0/shared-moderation";
import type { InfractionRow } from "./dto.js";
import type { StatsResult } from "./stats-calc.js";

/**
 * CSV for the action log export. Quoting follows RFC 4180 (CRLF between rows,
 * fields quoted when they hold a comma, quote or line break, quotes doubled).
 * Staff type the reasons and members choose their own names, so every text
 * cell is also defused against spreadsheet formulas.
 */

/** Characters that make Excel, Sheets and LibreOffice read a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}

export function buildCsv(
  header: readonly string[],
  rows: readonly (string | number | null | undefined)[][],
): string {
  return `${[csvRow([...header]), ...rows.map(csvRow)].join("\r\n")}\r\n`;
}

export const EXPORT_HEADER = [
  "case number",
  "created at",
  "member id",
  "member name",
  "action",
  "reason",
  "moderator id",
  "moderator name",
  "state",
  "expires at",
  "removed at",
  "removed by",
  "removal reason",
  "evidence links",
] as const;

/**
 * The words Member actions shows (in force, expired, on record, removed), by the same shared rule, so the file
 * never calls an automod warn "expired" while the page says it is on record.
 */
export function caseState(row: InfractionRow, now: Date, warnExpiryMs: number | null = null): CaseState {
  return caseStateOf(
    { action: row.action, active: row.active, expiresAt: row.expiresAt, removed: row.voidedAt !== null, warnExpiresAt: warnExpiresAt(row.action, row.createdAt, warnExpiryMs) },
    now,
  );
}

/** Display names by id; an id with no entry, or a null name, is left blank. */
export type NameLookup = (id: string) => string | null;

export function exportRow(row: InfractionRow, now: Date, name: NameLookup, warnExpiryMs: number | null = null): (string | number | null)[] {
  return [
    row.caseNumber,
    row.createdAt.toISOString(),
    row.userId,
    name(row.userId),
    row.action,
    // An automod case names its rule rather than the key it is stored under.
    readableReason(row.action, row.reason),
    row.moderatorId,
    name(row.moderatorId),
    caseState(row, now, warnExpiryMs),
    row.expiresAt ? row.expiresAt.toISOString() : null,
    row.voidedAt ? row.voidedAt.toISOString() : null,
    // No separate id column for this one, so fall back to the id rather than leave it unattributed.
    row.voidedAt && row.voidedBy ? (name(row.voidedBy) ?? row.voidedBy) : null,
    row.voidedAt ? row.voidReason : null,
    // Links only. The copies of the messages stay in the dashboard, since they can hold anything a member typed.
    readEvidence(row.evidence).map((message) => message.url).join(" ") || null,
  ];
}

export function buildExport(rows: InfractionRow[], now: Date, name: NameLookup, warnExpiryMs: number | null = null): string {
  return buildCsv(
    EXPORT_HEADER,
    rows.map((row) => exportRow(row, now, name, warnExpiryMs)),
  );
}

export const EXPORT_MAX_ROWS = 5000;

/** A file name for the download, dated so repeated exports do not overwrite each other. */
export function exportFilename(guildId: string, now: Date): string {
  return `tier0-actions-${guildId}-${now.toISOString().slice(0, 10)}.csv`;
}

export const STATS_EXPORT_HEADER = [
  "section",
  "from",
  "to",
  "moderator id",
  "moderator name",
  "warn",
  "timeout",
  "kick",
  "ban",
  "other",
  "total",
  "notes",
  "removed",
] as const;

/**
 * The Overview's figures in one file. The `section` column says what a row
 * is: one row per chart point (day, week or month, matching the chart), one
 * `range` row with the totals, then one `moderator` row each. Notes and
 * removed actions are not split by day on the chart, so those cells are blank
 * on the point rows.
 */
export function buildStatsExport(stats: StatsResult, name: NameLookup): string {
  const from = stats.since.slice(0, 10);
  const points = stats.perDay.map((point) => [
    stats.bucket,
    point.date,
    point.end ?? point.date,
    null,
    null,
    point.warn,
    point.timeout,
    point.kick,
    point.ban,
    point.other,
    point.warn + point.timeout + point.kick + point.ban + point.other,
    null,
    null,
  ]);
  const { totals } = stats;
  const named = totals.warns + totals.timeouts + totals.kicks + totals.bans;
  const range = [
    "range",
    from,
    stats.until,
    null,
    null,
    totals.warns,
    totals.timeouts,
    totals.kicks,
    totals.bans,
    totals.actions - named,
    totals.actions,
    totals.notes,
    totals.voided,
  ];
  const moderators = stats.moderators.map((mod) => [
    "moderator",
    from,
    stats.until,
    mod.userId,
    name(mod.userId),
    mod.warn,
    mod.timeout,
    mod.kick,
    mod.ban,
    Math.max(0, mod.total - mod.warn - mod.timeout - mod.kick - mod.ban),
    mod.total,
    mod.notes,
    mod.voided,
  ]);
  return buildCsv(STATS_EXPORT_HEADER, [...points, range, ...moderators]);
}

export function statsExportFilename(guildId: string, stats: Pick<StatsResult, "since" | "until">): string {
  return `tier0-mod-stats-${guildId}-${stats.since.slice(0, 10)}-to-${stats.until}.csv`;
}
