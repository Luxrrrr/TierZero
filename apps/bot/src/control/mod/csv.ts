import { readEvidence } from "@tier0/core";
import type { InfractionRow } from "./dto.js";

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

export type CaseState = "active" | "expired" | "removed";

/**
 * Removed beats everything else. A case that has ended, either because its
 * expiry has passed or because it was lifted early, is expired. A warn or kick
 * has no end, so it stays active for as long as it is on the record.
 */
export function caseState(row: InfractionRow, now: Date): CaseState {
  if (row.voidedAt) return "removed";
  if (!row.active) return "expired";
  if (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

/** Display names by id; an id with no entry, or a null name, is left blank. */
export type NameLookup = (id: string) => string | null;

export function exportRow(row: InfractionRow, now: Date, name: NameLookup): (string | number | null)[] {
  return [
    row.caseNumber,
    row.createdAt.toISOString(),
    row.userId,
    name(row.userId),
    row.action,
    row.reason,
    row.moderatorId,
    name(row.moderatorId),
    caseState(row, now),
    row.expiresAt ? row.expiresAt.toISOString() : null,
    row.voidedAt ? row.voidedAt.toISOString() : null,
    // No separate id column for this one, so fall back to the id rather than leave it unattributed.
    row.voidedAt && row.voidedBy ? (name(row.voidedBy) ?? row.voidedBy) : null,
    row.voidedAt ? row.voidReason : null,
    // Links only. The copies of the messages stay in the dashboard, since they can hold anything a member typed.
    readEvidence(row.evidence).map((message) => message.url).join(" ") || null,
  ];
}

export function buildExport(rows: InfractionRow[], now: Date, name: NameLookup): string {
  return buildCsv(
    EXPORT_HEADER,
    rows.map((row) => exportRow(row, now, name)),
  );
}

export const EXPORT_MAX_ROWS = 5000;

/** A file name for the download, dated so repeated exports do not overwrite each other. */
export function exportFilename(guildId: string, now: Date): string {
  return `tier0-actions-${guildId}-${now.toISOString().slice(0, 10)}.csv`;
}
