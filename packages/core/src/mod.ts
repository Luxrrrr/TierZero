/**
 * What the mod dashboard shares between the bot (which owns the data) and the
 * dashboard (which draws it): who may do what, and the shape of every reply.
 * Nothing here imports discord.js or touches a database, so both sides can
 * use it and it can be tested on its own.
 */

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
  | "note.add"
  | "note.edit.any"
  | "note.delete.any"
  | "note.restore"
  | "infraction.void"
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
  mod: ["view", "stats.view", "note.add", "infraction.void", "action.warn", "action.timeout"],
  admin: [
    "view",
    "stats.view",
    "audit.view",
    "note.add",
    "note.edit.any",
    "note.delete.any",
    "note.restore",
    "infraction.void",
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
    "note.add",
    "note.edit.any",
    "note.delete.any",
    "note.restore",
    "infraction.void",
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
  | "staff.add"
  | "staff.update"
  | "staff.remove";

export const AUDIT_KIND_LABEL: Record<AuditKind, string> = {
  "note.add": "Added a note",
  "note.edit": "Edited a note",
  "note.delete": "Deleted a note",
  "note.restore": "Restored a note",
  "infraction.void": "Removed an action from a record",
  "infraction.restore": "Restored an action to a record",
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
  actor: { userId: string; name: string; role: StaffRole };
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
