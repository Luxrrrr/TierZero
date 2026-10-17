import { AUDIT_KIND_LABEL, type AuditDto, type AuditKind } from "@tier0/core";

/**
 * Query handling and grouping rules for the audit trail. Kept free of React
 * so the rules can be tested on their own.
 */

const AUDIT_PAGE_SIZE = 30;

export interface AuditQuery {
  kind: string;
  actorId: string;
  targetUserId: string;
  /** Only entries about this case, or 0 for all. */
  infractionId: number;
  /** Calendar days as YYYY-MM-DD, or empty. */
  since: string;
  until: string;
  q: string;
  page: number;
}

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const SNOWFLAKE = /^\d{1,25}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const AUDIT_KINDS = Object.keys(AUDIT_KIND_LABEL) as AuditKind[];

/** Chip text: the full labels are sentences, which do not fit on a chip. */
export const AUDIT_KIND_SHORT: Record<AuditKind, string> = {
  "note.add": "Note added",
  "note.edit": "Note edited",
  "note.delete": "Note deleted",
  "note.restore": "Note restored",
  "infraction.void": "Action removed",
  "infraction.restore": "Action restored",
  "infraction.edit": "Action edited",
  "action.take": "Action taken",
  "channel.purge": "Messages deleted",
  "messagelog.purge": "Server logs deleted",
  "logs.purge": "Log deleted",
  "staff.add": "Staff added",
  "staff.update": "Role changed",
  "staff.remove": "Staff removed",
  "appeal.accept": "Appeal accepted",
  "appeal.deny": "Appeal denied",
  "raid.lockdown": "Lockdown",
  "raid.unlock": "Unlock",
  "raid.mass": "Mass action",
};

function validDay(value: string): string {
  if (!DAY.test(value)) return "";
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? "" : value;
}

/** Anything unrecognised falls back to the defaults, so a hand-edited URL never errors. */
export function parseAuditQuery(raw: RawParams): AuditQuery {
  const kind = first(raw.kind);
  const actorId = first(raw.actorId).trim();
  const targetUserId = first(raw.targetUserId).trim();
  const pageNumber = Number.parseInt(first(raw.page), 10);
  let since = validDay(first(raw.since).trim());
  let until = validDay(first(raw.until).trim());
  // A range typed backwards means the same thing the other way round.
  if (since && until && since > until) [since, until] = [until, since];
  return {
    kind: AUDIT_KINDS.includes(kind as AuditKind) ? kind : "",
    actorId: SNOWFLAKE.test(actorId) || actorId === "automod" ? actorId : "",
    targetUserId: SNOWFLAKE.test(targetUserId) ? targetUserId : "",
    infractionId: /^\d{1,9}$/.test(first(raw.infractionId).trim()) ? Number(first(raw.infractionId).trim()) : 0,
    since,
    until,
    q: first(raw.q).trim().slice(0, 100),
    page: Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1,
  };
}

/** The start of `since` and the last millisecond of `until`, so choosing one day shows that whole day. */
export function auditApiParams(query: AuditQuery) {
  return {
    kind: query.kind || undefined,
    actorId: query.actorId || undefined,
    targetUserId: query.targetUserId || undefined,
    infractionId: query.infractionId || undefined,
    since: query.since ? `${query.since}T00:00:00.000Z` : undefined,
    until: query.until ? `${query.until}T23:59:59.999Z` : undefined,
    q: query.q || undefined,
    page: query.page,
    pageSize: AUDIT_PAGE_SIZE,
  };
}

export function auditHref(guildId: string, query: Partial<AuditQuery>): string {
  const search = new URLSearchParams();
  if (query.kind) search.set("kind", query.kind);
  if (query.actorId) search.set("actorId", query.actorId);
  if (query.targetUserId) search.set("targetUserId", query.targetUserId);
  if (query.infractionId) search.set("infractionId", String(query.infractionId));
  if (query.since) search.set("since", query.since);
  if (query.until) search.set("until", query.until);
  if (query.q) search.set("q", query.q);
  if (query.page && query.page > 1) search.set("page", String(query.page));
  const text = search.toString();
  return `/guilds/${guildId}/mod/audit${text ? `?${text}` : ""}`;
}

export function hasAuditFilters(query: AuditQuery): boolean {
  return Boolean(
    query.kind || query.actorId || query.targetUserId || query.infractionId || query.since || query.until || query.q,
  );
}

/**
 * Applies the date range and text filters to rows already fetched. The bot
 * does this itself on a current version; an older one ignores the
 * parameters, and without this the page would claim a filter it did not apply.
 */
export function narrowAudit(items: AuditDto[], query: AuditQuery): AuditDto[] {
  const since = query.since ? Date.parse(`${query.since}T00:00:00.000Z`) : null;
  const until = query.until ? Date.parse(`${query.until}T23:59:59.999Z`) : null;
  const needle = query.q.toLowerCase();
  return items.filter((entry) => {
    const at = Date.parse(entry.at);
    if (since !== null && at < since) return false;
    if (until !== null && at > until) return false;
    if (needle && !`${entry.summary} ${entry.label}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

interface DayGroup<T = AuditDto> {
  /** YYYY-MM-DD in the grouping time zone. */
  key: string;
  label: string;
  items: T[];
}

/**
 * Entries arrive newest first and stay that way; a new group starts whenever
 * the calendar day changes. Days are UTC unless told otherwise, because the
 * server's zone is not the reader's and the page says which one it means.
 */
export function groupByDay<T extends { at: string }>(items: T[], timeZone = "UTC", now: Date = new Date()): DayGroup<T>[] {
  const keyOf = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone });
  const labelOf = new Intl.DateTimeFormat("en", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  });
  const today = keyOf.format(now);
  const yesterday = keyOf.format(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  const groups: DayGroup<T>[] = [];
  for (const entry of items) {
    const date = new Date(entry.at);
    const key = keyOf.format(date);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(entry);
      continue;
    }
    const prefix = key === today ? "Today, " : key === yesterday ? "Yesterday, " : "";
    groups.push({ key, label: `${prefix}${labelOf.format(date)}`, items: [entry] });
  }
  return groups;
}

/**
 * A member's record, opened at one entry when `focus` names it. A case wins
 * over a note when both are given, since a case is what the record is about.
 */
export function memberRecordHref(
  guildId: string,
  userId: string,
  focus: { caseNumber?: number | null; noteId?: number | null } = {},
): string {
  const base = `/guilds/${guildId}/mod/members/${encodeURIComponent(userId)}`;
  if (focus.caseNumber) return `${base}?case=${focus.caseNumber}`;
  if (focus.noteId) return `${base}?note=${focus.noteId}`;
  return base;
}

export interface AuditLink {
  href: string;
  /** The accessible name, such as "Open case #4 for LuxTester". */
  label: string;
}

const noteKind = (kind: string): boolean => kind.startsWith("note.");

/**
 * Where an entry opens on the member's record: the case for an action or a
 * change to one, the note for a change to a note, or the record itself when
 * the entry names a member but no longer a case or note it can point at.
 * Entries that are not about a member, such as staff changes and purges, have
 * no link. A removed case still has one: the timeline keeps showing it.
 */
export function auditEntryLink(guildId: string, entry: AuditDto): AuditLink | null {
  const user = entry.targetUser;
  if (!user) return null;
  const who = user.name ?? `User ${user.userId.slice(-4)}`;
  if (noteKind(entry.kind) && entry.noteId) {
    return { href: memberRecordHref(guildId, user.userId, { noteId: entry.noteId }), label: `Open a note for ${who}` };
  }
  if (!noteKind(entry.kind) && entry.caseNumber) {
    return {
      href: memberRecordHref(guildId, user.userId, { caseNumber: entry.caseNumber }),
      label: `Open case #${entry.caseNumber} for ${who}`,
    };
  }
  return { href: memberRecordHref(guildId, user.userId), label: `Open ${who}'s record` };
}

export type AuditIcon = "note" | "pencil" | "trash" | "undo" | "user";

interface AuditVisual {
  icon: AuditIcon;
  /** Matches `data-action` on the shared round icon. */
  tone: string;
}

/** Notes take the note colour; removals take the colour of the action they removed; staff changes stay neutral. */
export function auditVisual(kind: string, before: unknown, after: unknown): AuditVisual {
  const actionOf = (snapshot: unknown): string | null => {
    if (typeof snapshot !== "object" || snapshot === null) return null;
    const value = (snapshot as Record<string, unknown>).action;
    return typeof value === "string" ? value : null;
  };
  // Automod cases are filed as automod-warn and so on; they take the colour of the plain action.
  const tone = (actionOf(before) ?? actionOf(after) ?? "").replace(/^automod-/, "");
  switch (kind) {
    case "note.add":
      return { icon: "note", tone: "note" };
    case "note.edit":
      return { icon: "pencil", tone: "note" };
    case "note.delete":
      return { icon: "trash", tone: "note" };
    case "note.restore":
      return { icon: "undo", tone: "note" };
    case "infraction.void":
      return { icon: "trash", tone };
    case "infraction.restore":
      return { icon: "undo", tone };
    case "infraction.edit":
      return { icon: "pencil", tone };
    case "action.take":
      return { icon: "user", tone };
    default:
      return { icon: "user", tone: "" };
  }
}

const STAMP = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/** "Oct 10, 04:54 UTC": enough to tell two similar entries apart in an accessible name. */
export function utcStamp(iso: string): string {
  return `${STAMP.format(new Date(iso))} UTC`;
}
