import { isCounting, isInForce, isWarning } from "@tier0/core";
import type { AuditDto, InfractionDto, MemberProfile, NoteDto, UserRef } from "@tier0/core";

/**
 * Pure helpers for the member profile: merging the three record types into one
 * timeline, grouping it by day, reading the audit snapshots, and the
 * optimistic patches the page shows while a change is in flight. No React in
 * here so the rules can be tested on their own.
 */

export type TimelineFilter = "all" | "actions" | "notes" | "staff";

export type TimelineItem =
  | { kind: "infraction"; key: string; at: string; infraction: InfractionDto }
  | { kind: "note"; key: string; at: string; note: NoteDto }
  | { kind: "audit"; key: string; at: string; audit: AuditDto };

/**
 * Adding a note is already visible as the note itself, so it is left out of
 * staff activity rather than appearing twice.
 */
export function isStaffActivity(entry: AuditDto): boolean {
  return entry.kind !== "note.add";
}

const KIND_RANK: Record<TimelineItem["kind"], number> = { infraction: 0, note: 1, audit: 2 };

/**
 * Whether a staff activity entry belongs to a case or note already on the
 * timeline. Those are folded into that card's history rather than listed a
 * second time beside it ("Timed out ToxicTuna (case #198)" right under the case).
 */
export function foldsIntoCard(entry: AuditDto, infractionIds: ReadonlySet<number>, noteIds: ReadonlySet<number>): boolean {
  if (entry.infractionId !== null && infractionIds.has(entry.infractionId)) return true;
  return entry.noteId !== null && noteIds.has(entry.noteId);
}

export function buildTimeline(
  profile: Pick<MemberProfile, "infractions" | "notes" | "audit">,
  includeAudit: boolean,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const infraction of profile.infractions) {
    items.push({ kind: "infraction", key: `i${infraction.id}`, at: infraction.createdAt, infraction });
  }
  for (const note of profile.notes) {
    items.push({ kind: "note", key: `n${note.id}`, at: note.createdAt, note });
  }
  if (includeAudit) {
    const infractionIds = new Set(profile.infractions.map((entry) => entry.id));
    const noteIds = new Set(profile.notes.map((entry) => entry.id));
    for (const audit of profile.audit) {
      if (isStaffActivity(audit) && !foldsIntoCard(audit, infractionIds, noteIds)) {
        items.push({ kind: "audit", key: `a${audit.id}`, at: audit.at, audit });
      }
    }
  }
  // Equal timestamps happen when one action writes several rows; ordering them
  // by kind and key keeps the list from reshuffling on every refresh.
  return items.sort((a, b) => {
    const byTime = Date.parse(b.at) - Date.parse(a.at);
    if (byTime !== 0 && !Number.isNaN(byTime)) return byTime;
    if (a.kind !== b.kind) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
    return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
  });
}

/** How many entries the timeline shows at first, and adds with each "Show older". A long record stays quick to open. */
export const TIMELINE_PAGE = 30;

/** How many entries to show so that the one at `index` is on screen, in whole steps of the page size. */
export function limitToShow(index: number, current: number, step: number = TIMELINE_PAGE): number {
  if (index < current) return current;
  return Math.ceil((index + 1) / step) * step;
}

export function filterTimeline(items: TimelineItem[], filter: TimelineFilter): TimelineItem[] {
  if (filter === "all") return items;
  const wanted = filter === "actions" ? "infraction" : filter === "notes" ? "note" : "audit";
  return items.filter((item) => item.kind === wanted);
}

export function countByFilter(items: TimelineItem[]): Record<TimelineFilter, number> {
  return {
    all: items.length,
    actions: filterTimeline(items, "actions").length,
    notes: filterTimeline(items, "notes").length,
    staff: filterTimeline(items, "staff").length,
  };
}

/* Day groups ---------------------------------------------------------------- */

export interface DayGroup {
  /** `YYYY-MM-DD` in the viewer's time zone. */
  key: string;
  label: string;
  items: TimelineItem[];
}

const keyFormatters = new Map<string, Intl.DateTimeFormat>();

/** The calendar day an instant falls on in `timeZone`, as `YYYY-MM-DD`. */
export function dayKey(iso: string, timeZone: string): string {
  let format = keyFormatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    keyFormatters.set(timeZone, format);
  }
  return format.format(new Date(iso));
}

function shiftKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const SHORT_DAY = new Intl.DateTimeFormat("en", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const LONG_DAY = new Intl.DateTimeFormat("en", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

/**
 * "Today", "Yesterday", "Fri, Oct 3" within the current year, and "Oct 3, 2025"
 * beyond it. Works from day keys so the label never drifts with the clock.
 */
export function dayLabel(key: string, todayKey: string): string {
  if (key === todayKey) return "Today";
  if (key === shiftKey(todayKey, -1)) return "Yesterday";
  const date = new Date(`${key}T12:00:00Z`);
  return key.slice(0, 4) === todayKey.slice(0, 4) ? SHORT_DAY.format(date) : LONG_DAY.format(date);
}

/** Splits a newest-first timeline into one group per calendar day, keeping the order. */
export function groupByDay(items: TimelineItem[], now: Date, timeZone: string): DayGroup[] {
  const today = dayKey(now.toISOString(), timeZone);
  const groups: DayGroup[] = [];
  for (const item of items) {
    const key = dayKey(item.at, timeZone);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(key, today), items: [item] });
  }
  return groups;
}

/* Standing ------------------------------------------------------------------ */

export type Standing =
  | { kind: "restricted"; action: string; caseNumber: number | null; until: string | null; inDiscordOnly?: boolean }
  | { kind: "recent"; at: string }
  | { kind: "clear" };

/**
 * The standing, corrected by what Discord holds. A ban or timeout made in
 * Discord itself leaves no case on the record, and the profile should not call
 * such a member clear. Discord can only add a restriction here, never take one
 * the record has away: the record's own state already follows lifts the bot made.
 */
export function standingWithDiscord(
  record: Standing,
  discord: { banned: boolean | null; timedOutUntil: string | null } | null,
  now: Date,
): Standing {
  if (!discord) return record;
  const restricted = record.kind === "restricted";
  if (discord.banned === true && !(restricted && record.action === "ban")) {
    return { kind: "restricted", action: "ban", caseNumber: null, until: null, inDiscordOnly: true };
  }
  if (!restricted && discord.timedOutUntil && Date.parse(discord.timedOutUntil) > now.getTime()) {
    return { kind: "restricted", action: "timeout", caseNumber: null, until: discord.timedOutUntil, inDiscordOnly: true };
  }
  return record;
}

/** How far back an action still counts as recent. */
export const RECENT_DAYS = 30;

/** Whether a row restricts the member right now, by the rule the whole dashboard shares. */
export function inForce(infraction: InfractionDto, now: Date): boolean {
  return isInForce(
    {
      action: infraction.action,
      active: infraction.active,
      expiresAt: infraction.expiresAt,
      removed: infraction.voided !== null,
    },
    now,
  );
}

/**
 * One word for where the member stands right now. A ban outranks a timeout
 * because it is the harder restriction. The stored `active` flag is not read
 * on its own: the bot sets it on warns and leaves it on timeouts that have run
 * out, so only `inForce` decides.
 */
export function standingOf(profile: Pick<MemberProfile, "infractions">, now: Date): Standing {
  const live = profile.infractions.filter((entry) => inForce(entry, now));
  const pick = live.find((entry) => entry.action === "ban") ?? live[0];
  if (pick) return { kind: "restricted", action: pick.action, caseNumber: pick.caseNumber, until: pick.expiresAt };

  const latest = profile.infractions.find((entry) => !entry.voided);
  if (latest && now.getTime() - Date.parse(latest.createdAt) <= RECENT_DAYS * 86_400_000) {
    return { kind: "recent", at: latest.createdAt };
  }
  return { kind: "clear" };
}

/* Activity trend ------------------------------------------------------------ */

export const TREND_DAYS = 14;

/**
 * The 14-day action counts for the trend line. Uses the bot's figures when it
 * sends them, and otherwise counts the record itself by UTC day, so an older
 * bot still draws a sensible line.
 */
export function activitySeries(
  profile: { summary: { activity?: unknown }; infractions: InfractionDto[] },
  now: Date,
): number[] {
  const given = profile.summary.activity;
  if (Array.isArray(given) && given.length > 0) {
    const clean = given.map((value) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0));
    return clean.length >= TREND_DAYS
      ? clean.slice(-TREND_DAYS)
      : [...new Array<number>(TREND_DAYS - clean.length).fill(0), ...clean];
  }

  const series = new Array<number>(TREND_DAYS).fill(0);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const entry of profile.infractions) {
    if (entry.voided) continue;
    const at = new Date(entry.createdAt);
    const day = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
    const index = TREND_DAYS - 1 - Math.round((today - day) / 86_400_000);
    if (index >= 0 && index < TREND_DAYS) series[index]! += 1;
  }
  return series;
}

/** Points for a polyline across a `width` by `height` box, with a little room so the stroke is not clipped. */
export function sparkPoints(series: number[], width: number, height: number, pad = 2): string {
  if (series.length === 0) return "";
  const max = Math.max(1, ...series);
  const step = series.length > 1 ? (width - pad * 2) / (series.length - 1) : 0;
  return series
    .map((value, index) => {
      const x = pad + index * step;
      const y = height - pad - (value / max) * (height - pad * 2);
      return `${round(x)},${round(y)}`;
    })
    .join(" ");
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/* Record counts ------------------------------------------------------------- */

export interface RecordCounts {
  warn: number;
  timeout: number;
  kick: number;
  ban: number;
  other: number;
  notes: number;
  removed: number;
  /** Warnings past the server's warn expiry: on the record, but no longer counted as warns. */
  expired: number;
}

/**
 * Live entries by type, with removed and deleted entries counted once, apart.
 * An expired warning is counted apart too, so "Warns" matches the Members list.
 */
export function recordCounts(profile: Pick<MemberProfile, "infractions" | "notes">, now: Date = new Date()): RecordCounts {
  const counts: RecordCounts = { warn: 0, timeout: 0, kick: 0, ban: 0, other: 0, notes: 0, removed: 0, expired: 0 };
  for (const entry of profile.infractions) {
    if (entry.voided) {
      counts.removed += 1;
      continue;
    }
    if (warnExpiry(entry, now)?.state === "expired") {
      counts.expired += 1;
      continue;
    }
    if (entry.action === "warn" || entry.action === "timeout" || entry.action === "kick" || entry.action === "ban") {
      counts[entry.action] += 1;
    } else {
      counts.other += 1;
    }
  }
  for (const note of profile.notes) {
    if (note.deleted) counts.removed += 1;
    else counts.notes += 1;
  }
  return counts;
}

export interface QuickFacts {
  /** The oldest action or note, or null for an empty record. */
  firstEntryAt: string | null;
  /** Distinct staff who issued an action, wrote a note, or changed either. */
  staffInvolved: number;
  /** Who issued the most actions here, with how many. */
  topModerator: { user: UserRef; count: number } | null;
  /** Edits, removals and restores across the record. */
  changes: number;
}

export function quickFacts(profile: Pick<MemberProfile, "infractions" | "notes" | "audit">): QuickFacts {
  const times: string[] = [];
  const staff = new Set<string>();
  const issued = new Map<string, { user: UserRef; count: number }>();

  for (const entry of profile.infractions) {
    times.push(entry.createdAt);
    staff.add(entry.moderator.userId);
    const current = issued.get(entry.moderator.userId);
    if (entry.voided) continue;
    if (current) current.count += 1;
    else issued.set(entry.moderator.userId, { user: entry.moderator, count: 1 });
  }
  for (const note of profile.notes) {
    times.push(note.createdAt);
    staff.add(note.author.userId);
  }
  let changes = 0;
  for (const entry of profile.audit) {
    staff.add(entry.actor.userId);
    if (isStaffActivity(entry)) changes += 1;
  }

  let topModerator: QuickFacts["topModerator"] = null;
  for (const candidate of issued.values()) {
    if (!topModerator || candidate.count > topModerator.count) topModerator = candidate;
  }
  const firstEntryAt = times.reduce<string | null>(
    (oldest, at) => (oldest === null || Date.parse(at) < Date.parse(oldest) ? at : oldest),
    null,
  );
  return { firstEntryAt, staffInvolved: staff.size, topModerator, changes };
}

/* History ------------------------------------------------------------------- */

/** The audit entries that explain one infraction or note: edits, removals, restores. */
export function historyFor(
  audit: AuditDto[],
  target: { infractionId: number } | { noteId: number },
): AuditDto[] {
  const matches = audit.filter((entry) =>
    "infractionId" in target ? entry.infractionId === target.infractionId : entry.noteId === target.noteId,
  );
  return matches.filter(isStaffActivity);
}

/**
 * A readable form of an audit snapshot. Notes are stored as their text; other
 * snapshots are objects, shown as `field: value` lines with empty fields
 * dropped. Returns null when there is nothing worth showing.
 */
export function snapshotText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  if (typeof record.content === "string") return record.content;

  const lines: string[] = [];
  for (const [key, entry] of Object.entries(record)) {
    if (entry === null || entry === undefined || entry === "") continue;
    if (typeof entry === "object") continue;
    lines.push(`${key}: ${String(entry)}`);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

export interface DiffRow {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
  changed: boolean;
  /** Values are ISO timestamps, which the view formats for the reader. */
  time: boolean;
}

export type SnapshotDiff =
  | { kind: "none" }
  | { kind: "text"; before: string | null; after: string | null }
  | { kind: "fields"; rows: DiffRow[] };

const FIELD_LABEL: Record<string, string> = {
  content: "Text",
  caseNumber: "Case",
  action: "Type",
  reason: "Reason",
  expiresAt: "Expires",
  active: "In force",
  voided: "Removed",
  voidedAt: "Removed at",
  voidedBy: "Removed by",
  voidReason: "Removal reason",
  createdAt: "Issued",
  role: "Role",
};

/**
 * Identity fields never change and repeat what the row already says, so a
 * history entry that listed them would bury the one line that matters.
 */
const HIDDEN_FIELDS = new Set(["userId", "moderatorId", "guildId", "id"]);

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function fieldValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" || typeof value === "string") return String(value);
  return null;
}

function humanise(field: string): string {
  const spaced = field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function textOf(value: unknown): string | null | undefined {
  if (typeof value === "string") return value.trim() === "" ? null : value;
  const record = asRecord(value);
  if (record && typeof record.content === "string" && Object.keys(record).length === 1) return record.content;
  return undefined;
}

/**
 * Before and after, lined up field by field. Note text is compared as a whole
 * block. For records, a change shows only the fields that moved; a snapshot
 * with only one side (an add or a removal) lists what it held.
 */
export function diffSnapshots(before: unknown, after: unknown): SnapshotDiff {
  const beforeText = textOf(before);
  const afterText = textOf(after);
  const textual =
    (beforeText !== undefined || before === null || before === undefined) &&
    (afterText !== undefined || after === null || after === undefined) &&
    (beforeText !== undefined || afterText !== undefined);
  if (textual) {
    const b = beforeText ?? null;
    const a = afterText ?? null;
    return b === null && a === null ? { kind: "none" } : { kind: "text", before: b, after: a };
  }

  const left = asRecord(before) ?? {};
  const right = asRecord(after) ?? {};
  const both = asRecord(before) !== null && asRecord(after) !== null;
  // Some changes record only the fields they touched on the after side, so a
  // field missing there was left alone, not cleared.
  const fields: string[] = [];
  for (const key of [...Object.keys(left), ...Object.keys(right)]) {
    if (fields.includes(key) || HIDDEN_FIELDS.has(key)) continue;
    if (both && !(key in left && key in right)) continue;
    fields.push(key);
  }

  const rows: DiffRow[] = [];
  for (const field of fields) {
    const b = fieldValue(left[field]);
    const a = fieldValue(right[field]);
    if (b === null && a === null) continue;
    const changed = b !== a;
    if (both && !changed) continue;
    const time = [b, a].some((value) => value !== null && ISO_TIME.test(value));
    rows.push({ field, label: FIELD_LABEL[field] ?? humanise(field), before: b, after: a, changed, time });
  }
  return rows.length > 0 ? { kind: "fields", rows } : { kind: "none" };
}

/* Infraction state ------------------------------------------------------------ */

const RESTRICTION_ACTIONS = new Set(["timeout", "automod-timeout", "ban"]);

export type ExpiryState =
  | { state: "none" }
  | { state: "active"; until: string | null }
  | { state: "ended"; at: string | null };

/**
 * What the row's status pill says. Warns, kicks and reversals are records, not
 * restrictions, so they never show as in force whatever their stored flag. A
 * timeout past its end shows as ended even though the bot left it active; a
 * ban that was lifted ends with no date of its own.
 */
export function expiryState(infraction: InfractionDto, now: Date): ExpiryState {
  if (infraction.voided || !RESTRICTION_ACTIONS.has(infraction.action)) return { state: "none" };
  if (inForce(infraction, now)) return { state: "active", until: infraction.expiresAt };
  if (infraction.expiresAt && Date.parse(infraction.expiresAt) <= now.getTime()) {
    return { state: "ended", at: infraction.expiresAt };
  }
  return infraction.active ? { state: "none" } : { state: "ended", at: null };
}

export type WarnExpiry = { state: "counting"; until: string } | { state: "expired"; at: string } | null;

/**
 * Where a warning stands under the server's warn expiry. Null for anything
 * that is not a warning, a removed one, and a warning on a server where
 * warnings never expire. Read through `isCounting` so the card agrees with
 * the Members list and the escalation rules.
 */
export function warnExpiry(infraction: InfractionDto, now: Date): WarnExpiry {
  if (infraction.voided || !isWarning(infraction.action) || !infraction.warnExpiresAt) return null;
  const counting = isCounting(
    { action: infraction.action, active: infraction.active, expiresAt: infraction.expiresAt, removed: false, warnExpiresAt: infraction.warnExpiresAt },
    now,
  );
  return counting ? { state: "counting", until: infraction.warnExpiresAt } : { state: "expired", at: infraction.warnExpiresAt };
}

/** The profile link to the warning an automatic case was counted from. */
export function automaticFromHref(guildId: string, userId: string, fromCase: number): string {
  return `/guilds/${guildId}/mod/members/${encodeURIComponent(userId)}?case=${fromCase}`;
}

/**
 * What removing this case also undoes in Discord, so the dialog can say so:
 * a ban or timeout still in force is lifted, the same rule the bot applies.
 */
export function removalLifts(infraction: InfractionDto, now: Date): "ban" | "timeout" | null {
  if (infraction.voided || !inForce(infraction, now)) return null;
  if (infraction.action === "ban") return "ban";
  return infraction.action === "timeout" || infraction.action === "automod-timeout" ? "timeout" : null;
}

/* Dates --------------------------------------------------------------------- */

const dateFormats = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string, withTime: boolean): Intl.DateTimeFormat {
  const key = `${timeZone}|${withTime}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat("en", {
      timeZone,
      year: "numeric",
      month: "short",
      day: "numeric",
      // A time names its zone, because Mod logs and Staff activity print UTC and the same moment must not look like two.
      ...(withTime ? { hour: "2-digit", minute: "2-digit", ...(timeZone === "UTC" ? {} : { timeZoneName: "short" }) } : {}),
    });
    dateFormats.set(key, format);
  }
  return format;
}

/**
 * Dates in a zone named by the caller rather than the machine's, so the server
 * and the browser print the same text until the browser switches to the
 * reader's zone. A time shown in UTC says so.
 */
export function formatDate(iso: string, timeZone: string): string {
  return formatter(timeZone, false).format(new Date(iso));
}

export function formatDateTime(iso: string, timeZone: string): string {
  const text = formatter(timeZone, true).format(new Date(iso));
  return timeZone === "UTC" ? `${text} UTC` : text;
}

/* Typed confirmation ---------------------------------------------------------- */

export const PURGE_WORD = "purge";

/** Purging cannot be undone, so the dialog waits for the word to be typed, in any case. */
export function purgeConfirmed(input: string): boolean {
  return input.trim().toLowerCase() === PURGE_WORD;
}

/* Character counter ------------------------------------------------------------ */

export type CounterTone = "quiet" | "near" | "full";

/** The counter stays out of the way until the writer is close to the limit. */
export function counterTone(length: number, limit: number): CounterTone {
  if (length >= limit) return "full";
  if (length >= limit * 0.9) return "near";
  return "quiet";
}

/**
 * What a screen reader hears about the counter. The visible count is hidden
 * from it, and announcing every keystroke would drown out the typing, so it
 * speaks only when the counter changes tone: near the limit, then at it.
 */
export function counterAnnouncement(length: number, limit: number): string {
  const tone = counterTone(length, limit);
  if (tone === "full") return "Limit reached";
  if (tone === "near") {
    const left = limit - length;
    return `${left} ${left === 1 ? "character" : "characters"} left`;
  }
  return "";
}

/**
 * Why a confirmation dialog cannot continue yet, or null when it can. Shown
 * when someone presses the confirm button early, so the press is never
 * silently ignored.
 */
export function confirmationProblem(needsReason: boolean, reason: string, needsWord: boolean, word: string): string | null {
  if (needsReason && reason.trim() === "") return "Write a reason before continuing.";
  if (needsWord && !purgeConfirmed(word)) return `Type ${PURGE_WORD} in the box to confirm.`;
  return null;
}

/* Optimistic patches ------------------------------------------------------------ */

export type PendingOp =
  | { type: "note.add"; tempId: number; content: string; author: UserRef; at: string }
  | { type: "note.edit"; id: number; content: string; at: string }
  | { type: "note.delete"; id: number; by: UserRef; at: string }
  | { type: "note.restore"; id: number }
  | { type: "note.purge"; id: number }
  | { type: "infraction.void"; id: number; by: UserRef; reason: string; at: string }
  | { type: "infraction.restore"; id: number }
  | { type: "infraction.purge"; id: number };

/** Timeline keys for the entries an operation touches, so the view can mark them as saving. */
export function pendingKey(op: PendingOp): string {
  if (op.type === "note.add") return `n${op.tempId}`;
  return op.type.startsWith("note.") ? `n${op.id}` : `i${op.id}`;
}

/**
 * The profile as it will look once the operations land. The server's answer
 * replaces this on refresh, so it only has to be right enough to avoid a flash
 * of the old state; summary counts are left for the server to work out.
 * Temporary notes take negative ids so they never collide with real ones.
 */
export function applyPending(profile: MemberProfile, ops: PendingOp[]): MemberProfile {
  if (ops.length === 0) return profile;
  let notes = profile.notes;
  let infractions = profile.infractions;

  for (const op of ops) {
    switch (op.type) {
      case "note.add":
        notes = [
          {
            id: op.tempId,
            user: profile.user,
            author: op.author,
            content: op.content,
            createdAt: op.at,
            updatedAt: op.at,
            edited: false,
            deleted: null,
          },
          ...notes,
        ];
        break;
      case "note.edit":
        notes = notes.map((note) =>
          note.id === op.id ? { ...note, content: op.content, edited: true, updatedAt: op.at } : note,
        );
        break;
      case "note.delete":
        notes = notes.map((note) => (note.id === op.id ? { ...note, deleted: { at: op.at, by: op.by } } : note));
        break;
      case "note.restore":
        notes = notes.map((note) => (note.id === op.id ? { ...note, deleted: null } : note));
        break;
      case "note.purge":
        notes = notes.filter((note) => note.id !== op.id);
        break;
      case "infraction.void":
        infractions = infractions.map((entry) =>
          entry.id === op.id ? { ...entry, active: false, voided: { at: op.at, by: op.by, reason: op.reason } } : entry,
        );
        break;
      case "infraction.restore":
        infractions = infractions.map((entry) => (entry.id === op.id ? { ...entry, voided: null } : entry));
        break;
      case "infraction.purge":
        infractions = infractions.filter((entry) => entry.id !== op.id);
        break;
    }
  }
  return { ...profile, notes, infractions };
}

/* Case links ------------------------------------------------------------------ */

/** The DOM id of a case row, so `#case-196` lands on it. */
export function caseDomId(caseNumber: number): string {
  return `case-${caseNumber}`;
}

/** A case number from `?case=`: digits only, so `12abc`, `-3`, `1e3` and `0` are all ignored. */
export function parseCaseParam(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || !/^\d{1,9}$/.test(value)) return null;
  const parsed = Number(value);
  return parsed > 0 ? parsed : null;
}

/** The raw value of a `?case=` or `?note=` that was given but is not a number, clipped for display, or null. */
export function badFocusParam(raw: string | string[] | undefined, parsed: number | null): string | null {
  if (parsed !== null) return null;
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!value) return null;
  return value.length > 24 ? `${value.slice(0, 23)}…` : value;
}

/** A case number from a `#case-196` fragment. */
export function parseCaseHash(hash: string): number | null {
  const match = /^#case-(\d{1,9})$/.exec(hash);
  return match ? parseCaseParam(match[1]) : null;
}

/** The DOM id of a note row, so `#note-7` lands on it. */
export function noteDomId(noteId: number): string {
  return `note-${noteId}`;
}

/** A note id from `?note=`, read as strictly as a case number. */
export function parseNoteParam(raw: string | string[] | undefined): number | null {
  return parseCaseParam(raw);
}

/** A note id from a `#note-7` fragment. */
export function parseNoteHash(hash: string): number | null {
  const match = /^#note-(\d{1,9})$/.exec(hash);
  return match ? parseNoteParam(match[1]) : null;
}

/**
 * The row a note link points at, or null when the viewer's timeline has no
 * such note. A note staff deleted is still a row, shown as deleted, so it
 * opens. One the viewer may not see is absent, and the page says so.
 */
export function findNoteItem(items: TimelineItem[], noteId: number | null): TimelineItem | null {
  if (noteId === null) return null;
  return items.find((item) => item.kind === "note" && item.note.id === noteId) ?? null;
}

/** The one entry a link asks the page to open. */
export type FocusRequest = { kind: "case" | "note"; number: number };

/** A case wins over a note when a link names both. */
export function focusRequest(caseNumber: number | null, noteId: number | null): FocusRequest | null {
  if (caseNumber !== null) return { kind: "case", number: caseNumber };
  if (noteId !== null) return { kind: "note", number: noteId };
  return null;
}

export function findFocusItem(items: TimelineItem[], request: FocusRequest | null): TimelineItem | null {
  if (!request) return null;
  return request.kind === "case" ? findCaseItem(items, request.number) : findNoteItem(items, request.number);
}

export function focusDomId(request: FocusRequest): string {
  return request.kind === "case" ? caseDomId(request.number) : noteDomId(request.number);
}

/** How the page names the entry to a reader, such as "Case 196" or "Note 7". */
export function focusLabel(request: FocusRequest): string {
  return `${request.kind === "case" ? "Case" : "Note"} ${request.kind === "case" ? "#" : ""}${request.number}`;
}

/** What the page says when a linked case or note is not on the record this viewer can see. */
export function missingText(request: FocusRequest): string {
  return request.kind === "case"
    ? `${focusLabel(request)} is not on this member's record. It may have been purged, or the link is for another member.`
    : `${focusLabel(request)} is not on this member's record, or you can't see it.`;
}

/**
 * The row a case link points at, or null when the viewer's timeline has no
 * such case. The timeline is already limited to what this viewer may see, and
 * it is never paged, so a case that is not in it is not on the record they
 * can read. Audit rows and notes never match.
 */
export function findCaseItem(items: TimelineItem[], caseNumber: number | null): TimelineItem | null {
  if (caseNumber === null) return null;
  return items.find((item) => item.kind === "infraction" && item.infraction.caseNumber === caseNumber) ?? null;
}

/**
 * The filter to use so a linked case is on screen: the current one if it
 * already shows the case, otherwise All.
 */
export function filterShowing(items: TimelineItem[], filter: TimelineFilter, target: TimelineItem): TimelineFilter {
  return filterTimeline(items, filter).some((item) => item.key === target.key) ? filter : "all";
}
