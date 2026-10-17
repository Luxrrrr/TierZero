import { MASS_ACTION_LIMIT, type LockableChannelDto, type MassActionKind, type MassActionRequest, type MassJobDto, type MassPreviewDto, type RaidStatusDto } from "@tier0/core";

/**
 * The rules behind the Raid tools tab: reading pasted ids, the lockdown and
 * mass action requests, and reading the bot's replies. No React here, so each
 * rule is tested on its own. The bot checks every request again.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const LOCK_LENGTHS: { value: string; label: string; ms: number | null }[] = [
  { value: "none", label: "Until unlocked", ms: null },
  { value: "15m", label: "15 minutes", ms: 15 * MINUTE },
  { value: "1h", label: "1 hour", ms: HOUR },
  { value: "6h", label: "6 hours", ms: 6 * HOUR },
  { value: "24h", label: "24 hours", ms: 24 * HOUR },
];

export function lockLengthMs(value: string): number | null {
  return LOCK_LENGTHS.find((entry) => entry.value === value)?.ms ?? null;
}

/* Lockdown --------------------------------------------------------------------- */

/** The channels "Lock all channels" would lock: everything not exempt and not already locked. */
export function lockAllTargets(channels: LockableChannelDto[]): LockableChannelDto[] {
  return channels.filter((channel) => !channel.exempt && !channel.locked);
}

export interface LockBody {
  channels: "all" | string[];
  reason: string | null;
  durationMs: number | null;
}

export function lockBody(channels: "all" | string[], reason: string, length: string): LockBody {
  const text = reason.trim();
  return { channels, reason: text === "" ? null : text, durationMs: lockLengthMs(length) };
}

/** The sentence in the lock dialog, so the count and the consequence are read before confirming. */
export function lockConfirmText(count: number, length: string): string {
  const where = `${count} ${count === 1 ? "channel" : "channels"}`;
  const ms = lockLengthMs(length);
  const until = ms === null ? "until someone unlocks them" : `for ${LOCK_LENGTHS.find((entry) => entry.value === length)!.label}, then they unlock on their own`;
  return `Members will not be able to send messages in ${where} ${until}. Staff who can manage the channels are not affected.`;
}

/** Channels grouped under their category, in the order the bot sent them, for the picker. */
export function groupChannels(channels: LockableChannelDto[]): { parent: string | null; channels: LockableChannelDto[] }[] {
  const groups: { parent: string | null; channels: LockableChannelDto[] }[] = [];
  for (const channel of channels) {
    const group = groups.find((entry) => entry.parent === channel.parent);
    if (group) group.channels.push(channel);
    else groups.push({ parent: channel.parent, channels: [channel] });
  }
  return groups;
}

export interface LockResult {
  changed: number;
  failed: string[];
  status: RaidStatusDto | null;
}

/** Reads the reply to a lock or unlock. `key` is the count's name, which differs between the two. */
export function readLockResult(raw: unknown, key: "locked" | "unlocked"): LockResult {
  if (raw === null || typeof raw !== "object") return { changed: 0, failed: [], status: null };
  const value = raw as Record<string, unknown>;
  const changed = typeof value[key] === "number" && Number.isFinite(value[key]) ? (value[key] as number) : 0;
  const failed = Array.isArray(value.failed) ? value.failed.filter((line): line is string => typeof line === "string" && line.trim() !== "") : [];
  const status = isRaidStatus(value.status) ? value.status : null;
  return { changed, failed, status };
}

export function isRaidStatus(raw: unknown): raw is RaidStatusDto {
  if (raw === null || typeof raw !== "object") return false;
  const value = raw as Record<string, unknown>;
  return typeof value.moduleEnabled === "boolean" && Array.isArray(value.locked) && Array.isArray(value.channels);
}

/* Pasted ids ---------------------------------------------------------------------- */

const SNOWFLAKE = /^[0-9]{17,20}$/;
const MENTION = /^<@!?([0-9]{17,20})>$/;

export interface ParsedIds {
  ids: string[];
  /** Pieces that are neither an id nor a mention, as typed. */
  invalid: string[];
  /** Ids given more than once, counted once. */
  duplicates: number;
}

/**
 * Reads user ids out of pasted text: separated by spaces, commas or new
 * lines, and `<@id>` mentions as Discord copies them. Each id is kept once,
 * in the order first seen.
 */
export function parseIds(text: string): ParsedIds {
  const ids: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;
  for (const piece of text.split(/[\s,;]+/)) {
    if (piece === "") continue;
    const id = SNOWFLAKE.test(piece) ? piece : (MENTION.exec(piece)?.[1] ?? null);
    if (!id) {
      invalid.push(piece);
      continue;
    }
    if (ids.includes(id)) duplicates += 1;
    else ids.push(id);
  }
  return { ids, invalid, duplicates };
}

/** What the reader is told under the box. */
export function idsSummary(parsed: ParsedIds): string {
  const read = `${parsed.ids.length} ${parsed.ids.length === 1 ? "user ID" : "user IDs"} read`;
  const extra: string[] = [];
  if (parsed.duplicates > 0) extra.push(`${parsed.duplicates} repeated`);
  if (parsed.invalid.length > 0) extra.push(`${parsed.invalid.length} not recognised`);
  return extra.length > 0 ? `${read}, ${extra.join(", ")}.` : `${read}.`;
}

/* Join window ---------------------------------------------------------------------- */

const pad = (value: number) => String(value).padStart(2, "0");

/** A date as a `datetime-local` value, in the zone the browser runs in. */
export function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A `datetime-local` value as an ISO time, or null when it is empty or not a time. */
export function fromLocalInput(value: string): string | null {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?$/.test(value.trim())) return null;
  // Without a zone the string is read as local time, which is what the input shows.
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export const QUICK_WINDOWS: { label: string; ms: number }[] = [
  { label: "Last 10 minutes", ms: 10 * MINUTE },
  { label: "Last hour", ms: HOUR },
];

export function quickWindow(ms: number, now: Date): { after: string; before: string } {
  return { after: toLocalInput(new Date(now.getTime() - ms)), before: toLocalInput(now) };
}

/* Mass action request ---------------------------------------------------------------- */

export type MassTarget = "ids" | "joined";

export interface MassDraft {
  action: MassActionKind;
  target: MassTarget;
  idsText: string;
  /** `datetime-local` values. */
  joinedAfter: string;
  joinedBefore: string;
  reason: string;
  deleteDays: number;
}

export type MassCheck = { ok: true; request: MassActionRequest } | { ok: false; error: string; field: "ids" | "after" | "before" | "reason" };

export const MASS_REASON_LIMIT = 500;

/** Checks the draft and builds exactly what the bot expects. Nothing is sent without this passing. */
export function buildMassRequest(draft: MassDraft, now: Date = new Date()): MassCheck {
  const reason = draft.reason.trim();
  if (reason.length > MASS_REASON_LIMIT) return { ok: false, error: `Keep the reason to ${MASS_REASON_LIMIT} characters.`, field: "reason" };
  const base = {
    action: draft.action,
    reason: reason === "" ? null : reason,
    ...(draft.action === "ban" ? { deleteDays: Math.min(7, Math.max(0, Math.trunc(draft.deleteDays) || 0)) } : {}),
  };

  if (draft.target === "ids") {
    const parsed = parseIds(draft.idsText);
    if (parsed.ids.length === 0) return { ok: false, error: "Paste at least one user ID.", field: "ids" };
    if (parsed.ids.length > MASS_ACTION_LIMIT) {
      return { ok: false, error: `That is ${parsed.ids.length} user IDs. One mass action can take up to ${MASS_ACTION_LIMIT}.`, field: "ids" };
    }
    return { ok: true, request: { ...base, ids: parsed.ids } };
  }

  const after = fromLocalInput(draft.joinedAfter);
  if (!after) return { ok: false, error: "Choose when the window starts.", field: "after" };
  if (Date.parse(after) > now.getTime()) return { ok: false, error: "The start is in the future. Choose a time that has passed.", field: "after" };
  const before = draft.joinedBefore.trim() === "" ? null : fromLocalInput(draft.joinedBefore);
  if (draft.joinedBefore.trim() !== "" && !before) return { ok: false, error: "The end is not a valid time.", field: "before" };
  if (before && Date.parse(before) <= Date.parse(after)) return { ok: false, error: "The end has to be after the start.", field: "before" };
  return { ok: true, request: { ...base, joinedAfter: after, ...(before ? { joinedBefore: before } : {}) } };
}

/** A fingerprint of a request, so a preview is known to match what would be sent. */
export function requestKey(request: MassActionRequest): string {
  return JSON.stringify([
    request.action,
    request.ids ?? null,
    request.joinedAfter ?? null,
    request.joinedBefore ?? null,
    request.reason,
    request.deleteDays ?? null,
  ]);
}

const VERB: Record<MassActionKind, { future: string; past: string }> = {
  ban: { future: "will be banned", past: "banned" },
  kick: { future: "will be kicked", past: "kicked" },
};

/** "12 will be banned, 3 left alone". */
export function previewSummary(preview: Pick<MassPreviewDto, "action" | "count" | "skipped">): string {
  const lead = `${preview.count.toLocaleString("en")} ${VERB[preview.action].future}`;
  return preview.skipped > 0 ? `${lead}, ${preview.skipped.toLocaleString("en")} left alone` : lead;
}

/** The hold button's label for a previewed action. */
export function massConfirmLabel(action: MassActionKind, count: number): string {
  return `Hold to ${action} ${count.toLocaleString("en")} ${count === 1 ? "member" : "members"}`;
}

/** "Banned 40 of 52, 2 failed" while running, or the final count. */
export function jobProgressText(job: Pick<MassJobDto, "action" | "status" | "total" | "done" | "failed">): string {
  const verb = VERB[job.action].past;
  const failed = job.failed > 0 ? `, ${job.failed.toLocaleString("en")} failed` : "";
  if (job.status === "done") {
    const succeeded = Math.max(0, job.done - job.failed);
    return `Finished: ${succeeded.toLocaleString("en")} ${verb}${failed}.`;
  }
  return `${job.done.toLocaleString("en")} of ${job.total.toLocaleString("en")} done${failed}.`;
}

export function readPreview(raw: unknown): MassPreviewDto | null {
  if (raw === null || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if ((value.action !== "ban" && value.action !== "kick") || !Array.isArray(value.targets) || typeof value.count !== "number") return null;
  return {
    action: value.action,
    targets: value.targets as MassPreviewDto["targets"],
    count: value.count,
    skipped: typeof value.skipped === "number" ? value.skipped : 0,
    token: typeof value.token === "string" ? value.token : "",
  };
}

export function readJob(raw: unknown): MassJobDto | null {
  if (raw === null || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || (value.status !== "running" && value.status !== "done")) return null;
  const num = (field: unknown) => (typeof field === "number" && Number.isFinite(field) ? field : 0);
  return {
    id: value.id,
    action: value.action === "kick" ? "kick" : "ban",
    status: value.status,
    total: num(value.total),
    done: num(value.done),
    failed: num(value.failed),
    failures: Array.isArray(value.failures) ? value.failures.filter((line): line is string => typeof line === "string") : [],
  };
}

export const MASS_POLL_MS = 1500;
