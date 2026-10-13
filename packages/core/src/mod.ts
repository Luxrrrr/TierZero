/**
 * What the mod dashboard shares between the bot (which owns the data) and the
 * dashboard (which draws it): who may do what, and the shape of every reply.
 * Nothing here imports discord.js or touches a database, so both sides can
 * use it and it can be tested on its own.
 */

import type { DeletionSource } from "./deletion-notes.js";

export type StaffRole = "owner" | "admin" | "mod";

export const STAFF_ROLES: StaffRole[] = ["owner", "admin", "mod"];

/** Staff who can be listed and edited. The owner is implied and never stored. */
export type ListedRole = Exclude<StaffRole, "owner">;

export function isStaffRole(value: unknown): value is StaffRole {
  return value === "owner" || value === "admin" || value === "mod";
}

export type ModPermission =
  | "view"
  | "stats.view"
  | "audit.view"
  | "messages.view"
  | "messages.purge"
  | "note.add"
  | "note.edit.any"
  | "note.delete.any"
  | "note.restore"
  | "infraction.void"
  | "infraction.edit"
  | "infraction.void.any-action"
  | "infraction.restore"
  | "action.warn"
  | "action.timeout"
  | "action.kick"
  | "action.ban"
  | "action.unban"
  | "purge"
  | "staff.manage";

const GRANTS: Record<StaffRole, ModPermission[]> = {
  mod: ["view", "stats.view", "messages.view", "note.add", "infraction.void", "infraction.edit", "action.warn", "action.timeout"],
  admin: [
    "view",
    "stats.view",
    "audit.view",
    "messages.view",
    "messages.purge",
    "note.add",
    "note.edit.any",
    "note.delete.any",
    "note.restore",
    "infraction.void",
    "infraction.edit",
    "infraction.restore",
    "action.warn",
    "action.timeout",
    "action.kick",
    "action.ban",
    "action.unban",
  ],
  owner: [
    "view",
    "stats.view",
    "audit.view",
    "messages.view",
    "messages.purge",
    "note.add",
    "note.edit.any",
    "note.delete.any",
    "note.restore",
    "infraction.void",
    "infraction.edit",
    "infraction.void.any-action",
    "infraction.restore",
    "action.warn",
    "action.timeout",
    "action.kick",
    "action.ban",
    "action.unban",
    "purge",
    "staff.manage",
  ],
};

export function can(role: StaffRole, permission: ModPermission): boolean {
  return GRANTS[role].includes(permission);
}

/**
 * Warns and timeouts, including the ones automod records, are the entries staff may take off a member's record.
 * Kicks, bans and the rest are part of the permanent record, and removing one
 * is the owner's call.
 */
const VOIDABLE_BY_STAFF = new Set(["warn", "timeout", "automod-warn", "automod-timeout", "automod-delete"]);

/**
 * Whether this role may change the reason on a case. A moderator can correct their own, and an admin or the
 * owner any, automod's included.
 */
export function canEditInfraction(role: StaffRole, madeByViewer: boolean): boolean {
  if (!can(role, "infraction.edit")) return false;
  return role === "mod" ? madeByViewer : true;
}

export function canVoidAction(role: StaffRole, action: string): boolean {
  if (!can(role, "infraction.void")) return false;
  if (can(role, "infraction.void.any-action")) return true;
  return VOIDABLE_BY_STAFF.has(action);
}

/** Entries that restrict a member while they last. Warns and kicks are history, not restrictions. */
const RESTRICTIONS = new Set(["timeout", "automod-timeout", "ban"]);

export interface RestrictionState {
  action: string;
  /** The stored flag, which the bot sets on every new entry and clears only when an unban or a removal says so. */
  active: boolean;
  /** When the restriction ends, if it does; a date or an ISO string. */
  expiresAt: Date | string | null;
  /** Taken off the record by staff. */
  removed: boolean;
}

/**
 * Whether an entry is restricting the member at this moment. The stored
 * `active` flag alone cannot say: the bot sets it on warns too and never
 * clears it when a timeout simply runs out, so the action and the end time
 * have to be read as well. The member list's "restricted" marker, the action
 * log's "in force" state and the profile's standing all use this one rule.
 */
export function isInForce(entry: RestrictionState, now: Date = new Date()): boolean {
  if (entry.removed || !entry.active || !RESTRICTIONS.has(entry.action)) return false;
  if (entry.expiresAt === null) return true;
  return new Date(entry.expiresAt).getTime() > now.getTime();
}

/** Anyone may change their own note; changing someone else's takes more. */
export function canEditNote(role: StaffRole, isAuthor: boolean): boolean {
  return isAuthor || can(role, "note.edit.any");
}

export function canDeleteNote(role: StaffRole, isAuthor: boolean): boolean {
  return isAuthor || can(role, "note.delete.any");
}

export const ROLE_LABEL: Record<StaffRole, string> = {
  owner: "Owner",
  admin: "Admin",
  mod: "Moderator",
};

/**
 * Who an audit entry is shown as. Automod is the bot acting on its own and is
 * deliberately not a StaffRole: that type decides what a person may do, and
 * the bot has no seat in it.
 */
export type AuditActorRole = StaffRole | "automod";

/** The name stored on audit entries that automod writes. */
export const AUTOMOD_ACTOR_NAME = "Automod";

export const isAutomodRole = (role: AuditActorRole): role is "automod" => role === "automod";

/** Narrows a stored role to what an entry can display, treating anything unknown as a moderator. */
export function auditActorRole(stored: string): AuditActorRole {
  return stored === "automod" || isStaffRole(stored) ? stored : "mod";
}

/** The word after an actor's name ("moderator"), or an empty string for automod, which is its own name. */
export function actorRoleWord(role: AuditActorRole): string {
  return isAutomodRole(role) ? "" : ROLE_LABEL[role].toLowerCase();
}

/** Who is doing something. The dashboard fills this in from the session, never from the browser. */
export interface Actor {
  userId: string;
  name: string;
  role: StaffRole;
}

export type AuditKind =
  | "note.add"
  | "note.edit"
  | "note.delete"
  | "note.restore"
  | "infraction.void"
  | "infraction.restore"
  | "infraction.edit"
  | "action.take"
  | "channel.purge"
  | "messagelog.purge"
  | "logs.purge"
  | "staff.add"
  | "staff.update"
  | "staff.remove";

export const AUDIT_KIND_LABEL: Record<AuditKind, string> = {
  "note.add": "Added a note",
  "note.edit": "Edited a note",
  "note.delete": "Deleted a note",
  "note.restore": "Restored a note",
  "infraction.void": "Removed an action from a record",
  "infraction.edit": "Edited an action on a record",
  "infraction.restore": "Restored an action to a record",
  "action.take": "Took an action on a member",
  "channel.purge": "Deleted messages in a channel",
  "messagelog.purge": "Deleted the server logs",
  "logs.purge": "Deleted a whole log",
  "staff.add": "Added staff",
  "staff.update": "Changed a staff role",
  "staff.remove": "Removed staff",
};

/** What the dashboard shows for a Discord user, wherever one appears. */
export interface UserRef {
  userId: string;
  /** Display name, or null when Discord no longer knows the user. */
  name: string | null;
  avatarUrl: string | null;
  /** Whether they are in the server right now. */
  inServer: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const EVIDENCE_LIMITS = { messages: 10, content: 1500, attachments: 5, name: 200, versions: 51 } as const;

export interface EvidenceAttachment {
  name: string;
  url: string;
  contentType: string | null;
}

/**
 * A message kept with an action, as it read when the action was taken. It is a
 * copy, so it stays readable after the member edits or deletes the message.
 */
export interface EvidenceMessage {
  id: string;
  channelId: string;
  channelName: string;
  content: string;
  attachments: EvidenceAttachment[];
  createdAt: string;
  /** A link to the message in Discord, which only works while the message exists. */
  url: string;
  /** The message was already deleted when it was saved. */
  deleted: boolean;
  /** When it was deleted, if the bot saw that happen. */
  deletedAt?: string | null;
  /** Who deleted it, when the server log could tell at the time. */
  deletedBy?: DeletionSource;
  deletedByName?: string | null;
  /** Every version of the text, oldest first, the last being the current one. Present only when it was edited. */
  versions?: MessageVersion[];
  /** Which of `versions` the moderator picked as the one that broke the rules. Left out when it is the latest. */
  flagged?: number;
}

/** One version of a message's text, and when that text was posted or edited in. */
export interface MessageVersion {
  content: string;
  at: string;
}

/** A message in the server's message log, with its whole edit history. */
export interface LoggedMessageDto {
  id: string;
  channelId: string;
  channelName: string;
  author: UserRef;
  content: string;
  attachments: EvidenceAttachment[];
  createdAt: string;
  /** Null unless the bot saw the message being deleted. */
  deletedAt: string | null;
  /** Who deleted it, as the log saw it. Null when it could not tell, and for messages deleted before this was recorded. */
  deletedBy: DeletionSource | null;
  /** The deleter's name when they did it. */
  deletedByName: string | null;
  /** What the message carried besides text and files, such as "1 sticker". Empty when nothing. */
  extras: string;
  /** Oldest first, the last being what the message says now. One entry when it was never edited. */
  versions: MessageVersion[];
  url: string;
}

/** What the log asks for, in the words of the query string the dashboard sends. */
export const MESSAGE_LOG_STATES = ["all", "deleted", "edited"] as const;
export type MessageLogState = (typeof MESSAGE_LOG_STATES)[number];

/** A message a moderator picked, by where it is. The bot reads its contents itself. */
export interface EvidenceRef {
  channelId: string;
  messageId: string;
  /** For an edited message, which version is the problem, counting from the oldest at 0. Left out for the latest. */
  version?: number;
}

const SNOWFLAKE = /^\d{17,20}$/;

/** Reads the messages a request asks to attach, refusing anything that is not a message id pair. */
export function parseEvidenceRefs(input: unknown): { ok: true; refs: EvidenceRef[] } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, refs: [] };
  if (!Array.isArray(input)) return { ok: false, error: "The messages to attach must be a list." };
  const refs: EvidenceRef[] = [];
  const seen = new Set<string>();
  for (const entry of input) {
    const source = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    const channelId = typeof source.channelId === "string" ? source.channelId : "";
    const messageId = typeof source.messageId === "string" ? source.messageId : "";
    if (!SNOWFLAKE.test(channelId) || !SNOWFLAKE.test(messageId)) {
      return { ok: false, error: "One of the messages to attach is not a valid Discord message." };
    }
    if (seen.has(messageId)) continue;
    seen.add(messageId);
    const version = source.version;
    if (version !== undefined && version !== null && (!Number.isInteger(version) || (version as number) < 0 || (version as number) >= EVIDENCE_LIMITS.versions)) {
      return { ok: false, error: "One of the messages to attach names a version that does not exist." };
    }
    refs.push(typeof version === "number" ? { channelId, messageId, version } : { channelId, messageId });
  }
  if (refs.length > EVIDENCE_LIMITS.messages) {
    return { ok: false, error: `You can attach at most ${EVIDENCE_LIMITS.messages} messages to one action.` };
  }
  return { ok: true, refs };
}

/** A pasted Discord message link as the pair it names, or null when it is not one. */
export function evidenceRefFromLink(link: string): EvidenceRef | null {
  const match = /^https?:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/(?:\d+|@me)\/(\d{17,20})\/(\d{17,20})\/?$/.exec(link.trim());
  return match?.[1] && match[2] ? { channelId: match[1], messageId: match[2] } : null;
}

/** Reads stored evidence back. A damaged value reads as none rather than failing a whole list. */
export function readEvidence(stored: string | null | undefined): EvidenceMessage[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is EvidenceMessage => typeof entry === "object" && entry !== null && typeof (entry as { id?: unknown }).id === "string");
  } catch {
    return [];
  }
}

export interface InfractionDto {
  id: number;
  caseNumber: number;
  user: UserRef;
  moderator: UserRef;
  action: string;
  reason: string | null;
  createdAt: string;
  expiresAt: string | null;
  /** Still in force, such as a timeout that has not run out. */
  active: boolean;
  voided: null | { at: string; by: UserRef; reason: string | null };
  /** Set when the reason was changed after the action was taken. */
  edited: null | { at: string; by: UserRef };
  /** Messages a moderator attached, as they read when the action was taken. */
  evidence: EvidenceMessage[];
}

export interface NoteDto {
  id: number;
  user: UserRef;
  author: UserRef;
  content: string;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  deleted: null | { at: string; by: UserRef };
}

export interface AuditDto {
  id: number;
  at: string;
  actor: { userId: string; name: string; role: AuditActorRole };
  kind: AuditKind;
  label: string;
  summary: string;
  targetUser: UserRef | null;
  infractionId: number | null;
  noteId: number | null;
  /** Parsed snapshots, present for edits and removals. */
  before: unknown;
  after: unknown;
}

export interface MemberSummary {
  user: UserRef;
  /** Entries on their record, not counting removed ones. */
  infractionCount: number;
  warnCount: number;
  timeoutCount: number;
  banCount: number;
  kickCount: number;
  noteCount: number;
  lastActionAt: string | null;
  /** A timeout or ban that is still in force. */
  hasActive: boolean;
  /** Actions per day over the last 14 days (UTC), oldest first, for a small trend line. */
  activity: number[];
}

export interface MemberProfile {
  user: UserRef;
  /** When they joined the server, if they are in it. */
  joinedAt: string | null;
  accountCreatedAt: string | null;
  roles: { id: string; name: string }[];
  summary: MemberSummary;
  /** Newest first, removed entries included and marked. */
  infractions: InfractionDto[];
  /** Newest first, deleted notes included and marked. */
  notes: NoteDto[];
  /** Everything staff did that concerns this member, newest first. */
  audit: AuditDto[];
}

export interface StatsTotals {
  actions: number;
  warns: number;
  timeouts: number;
  kicks: number;
  bans: number;
  unbans: number;
  voided: number;
  notes: number;
  /** All time, not limited to the range. */
  membersWithRecord: number;
  /** In force right now, not limited to the range. */
  activeNow: number;
}

export interface StatsDto {
  days: number;
  since: string;
  totals: StatsTotals;
  /** The same counts for the period of equal length just before this one, for comparison. Null when it cannot be worked out. */
  previous: StatsTotals | null;
  /** One entry per day across the range, oldest first, zeros included. */
  perDay: { date: string; warn: number; timeout: number; kick: number; ban: number; other: number }[];
  byAction: { action: string; count: number }[];
  /** Busiest first. */
  moderators: {
    user: UserRef;
    total: number;
    warn: number;
    timeout: number;
    kick: number;
    ban: number;
    notes: number;
    voided: number;
    lastActionAt: string | null;
  }[];
  /** Members with the most actions in the range. */
  topMembers: { user: UserRef; count: number }[];
  /** Busiest hours of the day (0 to 23, in UTC) across the range. */
  byHour: number[];
  /** Share (0 to 1) of members actioned in the range who were actioned again within 30 days, or null with fewer than five members. */
  repeatRate: number | null;
  /** What automod did in the range: every entry whose action starts with `automod-`, grouped by the rule that fired. */
  automod: { total: number; previousTotal: number | null; byRule: { rule: string; count: number }[] };
}

export interface StaffDto {
  user: UserRef;
  role: ListedRole;
  addedBy: UserRef;
  addedAt: string;
}

export interface MemberSearchHit {
  user: UserRef;
}

/** The common shape of a refusal, so the dashboard can tell a missing permission from a missing record. */
export interface ModError {
  error: string;
}

/** What a moderator can do to a member from the dashboard. Each is the same thing the slash command of that name does. */
export type ModActionKind = "warn" | "timeout" | "timeout-clear" | "kick" | "ban" | "unban";

export const MOD_ACTION_KINDS: ModActionKind[] = ["warn", "timeout", "timeout-clear", "kick", "ban", "unban"];

export function isModActionKind(value: unknown): value is ModActionKind {
  return typeof value === "string" && (MOD_ACTION_KINDS as string[]).includes(value);
}

/** Clearing a timeout takes the same level as setting one. */
export function permissionForAction(kind: ModActionKind): ModPermission {
  if (kind === "timeout-clear") return "action.timeout";
  return `action.${kind}` as ModPermission;
}

export function canTakeAction(role: StaffRole, kind: ModActionKind): boolean {
  return can(role, permissionForAction(kind));
}

/**
 * What the dashboard sends to take an action. `durationMs` applies to a
 * timeout (required) and to a ban (optional: absent means permanent);
 * `deleteDays` applies to a ban only. A field that does not apply is ignored.
 */
export interface ActionRequest {
  action: ModActionKind;
  reason: string | null;
  durationMs: number | null;
  deleteDays: number | null;
  /** Messages from the member to keep with the action. */
  evidence?: EvidenceRef[];
}

export interface ActionResult {
  caseNumber: number;
  infraction: InfractionDto;
  /** Plain-language side notes for the person who acted, such as a direct message that could not be delivered. */
  notes: string[];
}

/** The settings and limits the action form needs before it opens. */
export interface ActionContextDto {
  /** The Moderation feature must be on for the bot to act. */
  moduleEnabled: boolean;
  requireReason: boolean;
  dmOnAction: boolean;
  /** Prefilled timeout length. */
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  /** The configured number of days of a banned member's messages to delete. */
  deleteMessageDays: number;
  maxBanDays: number;
  /** Actions whose slash command is switched off on the Commands page; the bot refuses them from here too. */
  disabledActions: ModActionKind[];
}
