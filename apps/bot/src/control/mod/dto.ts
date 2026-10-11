import { isInForce as restrictionInForce, type InfractionDto, type MemberSummary, type NoteDto, type UserRef } from "@tier0/core";

/**
 * Mappers and rules for the mod dashboard that need neither Discord nor a
 * database, so they can be tested directly. The handlers fetch rows and
 * resolve names, then hand both to these.
 */

export interface InfractionRow {
  id: number;
  caseNumber: number;
  guildId: string;
  userId: string;
  moderatorId: string;
  action: string;
  reason: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  active: boolean;
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
}

export interface NoteRow {
  id: number;
  guildId: string;
  userId: string;
  authorId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
}

export type RefLookup = (id: string) => UserRef;

export const NOTE_MAX = 2000;
export const REASON_MAX = 500;

export const isSnowflake = (value: string): boolean => /^\d{17,20}$/.test(value);

export type Checked = { ok: true; value: string } | { ok: false; error: string };

function checkText(value: unknown, label: string, max: number): Checked {
  if (typeof value !== "string") return { ok: false, error: `${label} must be text.` };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, error: `${label} cannot be empty.` };
  if (trimmed.length > max) return { ok: false, error: `${label} can be at most ${max} characters.` };
  return { ok: true, value: trimmed };
}

export const checkNoteContent = (value: unknown): Checked => checkText(value, "A note", NOTE_MAX);
export const checkVoidReason = (value: unknown): Checked => checkText(value, "A reason", REASON_MAX);

export function infractionDto(row: InfractionRow, ref: RefLookup): InfractionDto {
  return {
    id: row.id,
    caseNumber: row.caseNumber,
    user: ref(row.userId),
    moderator: ref(row.moderatorId),
    action: row.action,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    active: row.active,
    voided: row.voidedAt
      ? { at: row.voidedAt.toISOString(), by: ref(row.voidedBy ?? ""), reason: row.voidReason }
      : null,
  };
}

/**
 * A note counts as edited once its content has changed. Deleting or restoring
 * one leaves `updatedAt` alone (the handlers pass it through), so comparing
 * the two timestamps is enough, with a little slack for the write itself.
 */
export function noteDto(row: NoteRow, ref: RefLookup): NoteDto {
  return {
    id: row.id,
    user: ref(row.userId),
    author: ref(row.authorId),
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    edited: row.updatedAt.getTime() - row.createdAt.getTime() > 1000,
    deleted: row.deletedAt ? { at: row.deletedAt.toISOString(), by: ref(row.deletedBy ?? "") } : null,
  };
}

/** Plain JSON for the audit trail's before/after columns. */
export function infractionSnapshot(row: InfractionRow): Record<string, unknown> {
  return {
    caseNumber: row.caseNumber,
    userId: row.userId,
    moderatorId: row.moderatorId,
    action: row.action,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    active: row.active,
    voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
    voidedBy: row.voidedBy,
    voidReason: row.voidReason,
  };
}

export function noteSnapshot(row: NoteRow): Record<string, unknown> {
  return {
    userId: row.userId,
    authorId: row.authorId,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    deletedBy: row.deletedBy,
  };
}

const SUMMARY_TEXT_MAX = 120;

export function clip(text: string, max: number = SUMMARY_TEXT_MAX): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}...` : text;
}

export const labelOf = (ref: UserRef): string => ref.name ?? ref.userId;

/** "warn #12 for NAME: REASON" with the reason left off when there is none. */
export function describeCase(row: InfractionRow, target: UserRef): string {
  const reason = row.reason ? `: ${clip(row.reason)}` : "";
  return `${row.action} #${row.caseNumber} for ${labelOf(target)}${reason}`;
}

/** Whether the row is restricting the member now, by the one rule in the shared contract. */
export function isInForce(row: InfractionRow, now: Date): boolean {
  return restrictionInForce(
    { action: row.action, active: row.active, expiresAt: row.expiresAt, removed: row.voidedAt !== null },
    now,
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const ACTIVITY_DAYS = 14;

const utcMidnight = (ms: number): number => {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

/**
 * Actions per UTC day for the last `days` days ending with the day that
 * contains `now`, oldest first, zeros included. Removed entries are skipped,
 * as everywhere else on a record. Rows dated after today (a clock that ran
 * ahead) fall outside the window rather than being folded into today.
 */
export function activityByDay(rows: InfractionRow[], now: Date, days: number = ACTIVITY_DAYS): number[] {
  const counts = new Array<number>(days).fill(0);
  const start = utcMidnight(now.getTime()) - (days - 1) * DAY_MS;
  for (const row of rows) {
    if (row.voidedAt) continue;
    const index = Math.floor((utcMidnight(row.createdAt.getTime()) - start) / DAY_MS);
    if (index >= 0 && index < days) counts[index]!++;
  }
  return counts;
}

export interface MemberEntry {
  summary: MemberSummary;
  /** Latest thing on their record, notes included, for ordering by recency. */
  touchedAt: number;
}

/** Builds one member's summary from every row about them. Removed entries are ignored. */
export function summarizeMember(
  user: UserRef,
  infractions: InfractionRow[],
  notes: NoteRow[],
  now: Date,
): MemberEntry {
  const live = infractions.filter((row) => !row.voidedAt);
  const liveNotes = notes.filter((row) => !row.deletedAt);
  const count = (action: string) => live.filter((row) => row.action === action).length;
  const lastAction = live.reduce<number | null>(
    (latest, row) => (latest === null || row.createdAt.getTime() > latest ? row.createdAt.getTime() : latest),
    null,
  );
  const lastNote = liveNotes.reduce<number>((latest, row) => Math.max(latest, row.createdAt.getTime()), 0);
  return {
    summary: {
      user,
      infractionCount: live.length,
      warnCount: count("warn"),
      timeoutCount: count("timeout"),
      banCount: count("ban"),
      kickCount: count("kick"),
      noteCount: liveNotes.length,
      lastActionAt: lastAction === null ? null : new Date(lastAction).toISOString(),
      hasActive: live.some((row) => isInForce(row, now)),
      activity: activityByDay(live, now),
    },
    touchedAt: Math.max(lastAction ?? 0, lastNote),
  };
}

/** The same entry with a different user reference, once names have been resolved. */
export const withUser = (entry: MemberEntry, user: UserRef): MemberEntry => ({
  ...entry,
  summary: { ...entry.summary, user },
});

export type MemberSort = "recent" | "most" | "name" | "notes";

export function parseMemberSort(value: string | null): MemberSort {
  return value === "most" || value === "name" || value === "notes" ? value : "recent";
}

export type MemberFilter = "all" | "active" | "notes" | "recent";

/** An unknown or missing filter means no filter, so a stale link still shows the list. */
export function parseMemberFilter(value: string | null): MemberFilter {
  return value === "active" || value === "notes" || value === "recent" ? value : "all";
}

export const RECENT_DAYS = 7;

/**
 * `active` keeps members with a restriction in force, `notes` those with at
 * least one live note, and `recent` those actioned in the last seven days
 * (a note alone does not count as an action).
 */
export function filterMembers(entries: MemberEntry[], filter: MemberFilter, now: Date): MemberEntry[] {
  if (filter === "all") return entries;
  if (filter === "active") return entries.filter((entry) => entry.summary.hasActive);
  if (filter === "notes") return entries.filter((entry) => entry.summary.noteCount > 0);
  const cutoff = now.getTime() - RECENT_DAYS * DAY_MS;
  return entries.filter((entry) => {
    const last = entry.summary.lastActionAt;
    return last !== null && new Date(last).getTime() >= cutoff;
  });
}

export function sortMembers(entries: MemberEntry[], sort: MemberSort): MemberEntry[] {
  const byName = (a: MemberEntry, b: MemberEntry): number => {
    const an = a.summary.user.name;
    const bn = b.summary.user.name;
    if (an === null && bn !== null) return 1;
    if (an !== null && bn === null) return -1;
    const compared = (an ?? "").localeCompare(bn ?? "", undefined, { sensitivity: "base" });
    return compared !== 0 ? compared : a.summary.user.userId.localeCompare(b.summary.user.userId);
  };
  const recent = (a: MemberEntry, b: MemberEntry): number => b.touchedAt - a.touchedAt;
  const sorted = [...entries];
  if (sort === "name") return sorted.sort(byName);
  if (sort === "most") {
    return sorted.sort(
      (a, b) => b.summary.infractionCount - a.summary.infractionCount || recent(a, b) || byName(a, b),
    );
  }
  if (sort === "notes") {
    return sorted.sort((a, b) => b.summary.noteCount - a.summary.noteCount || recent(a, b) || byName(a, b));
  }
  return sorted.sort((a, b) => recent(a, b) || byName(a, b));
}

/** A search term matches a member by id or by any part of their name. */
export function matchesMember(user: UserRef, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return user.userId.includes(needle) || (user.name?.toLowerCase().includes(needle) ?? false);
}

export function slicePage<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
