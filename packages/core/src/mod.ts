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
  | "staff.manage"
  | "appeals.manage"
  | "raid.lockdown"
  | "raid.mass";

// Deleting the server logs is the owner's alone, like the Danger zone that offers it, so admins do not hold messages.purge.
// Appeals, lockdowns and mass actions undo or widen bans and change the whole server, so they start at admin: a
// moderator cannot ban, and lifting a ban through an appeal or banning a crowd at once would go past that.
const GRANTS: Record<StaffRole, ModPermission[]> = {
  mod: ["view", "stats.view", "messages.view", "note.add", "infraction.void", "infraction.edit", "action.warn", "action.timeout"],
  admin: [
    "view",
    "stats.view",
    "audit.view",
    "messages.view",
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
    "appeals.manage",
    "raid.lockdown",
    "raid.mass",
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
    "appeals.manage",
    "raid.lockdown",
    "raid.mass",
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
  /**
   * For a warning, when it stops counting under the server's warn expiry, from
   * `warnExpiresAt`. Null or absent when warnings never expire there.
   */
  warnExpiresAt?: Date | string | null;
}

/** Warnings, a moderator's and automod's. These are what warn expiry and escalation count. */
const WARNINGS = new Set(["warn", "automod-warn"]);

export const isWarning = (action: string): boolean => WARNINGS.has(action);

/**
 * When a warning stops counting, given the server's warn expiry in milliseconds
 * (null for never). Every other kind of case gives null: it never expires this way.
 */
export function warnExpiresAt(action: string, createdAt: Date | string, expiryMs: number | null | undefined): Date | null {
  if (!isWarning(action) || !expiryMs || expiryMs <= 0) return null;
  return new Date(new Date(createdAt).getTime() + expiryMs);
}

/** Whether a warning's expiry, from `warnExpiresAt`, has passed. */
function warningExpired(entry: RestrictionState, now: Date): boolean {
  if (!isWarning(entry.action) || !entry.warnExpiresAt) return false;
  return new Date(entry.warnExpiresAt).getTime() <= now.getTime();
}

/**
 * Whether a case still counts toward a member's totals: the warn count on the
 * Members list and the profile, and the warnings an escalation rule counts. A
 * removed case never does, an expired warning no longer does, and everything
 * else always does. It stays on the record either way. This and `isInForce`
 * are the two rules every count and state is read through.
 */
export function isCounting(entry: RestrictionState, now: Date = new Date()): boolean {
  if (entry.removed) return false;
  return !warningExpired(entry, now);
}

/**
 * Whether an entry is restricting the member at this moment. The stored
 * `active` flag alone cannot say: the bot sets it on warns too and never
 * clears it when a timeout simply runs out, so the action and the end time
 * have to be read as well. The member list's "restricted" marker, the action
 * log's "in force" state and the profile's standing all use this one rule.
 * A warning never restricts, so it is never in force; whether it still counts
 * is `isCounting`.
 */
export function isInForce(entry: RestrictionState, now: Date = new Date()): boolean {
  if (entry.removed || !entry.active || !RESTRICTIONS.has(entry.action)) return false;
  if (entry.expiresAt === null) return true;
  return new Date(entry.expiresAt).getTime() > now.getTime();
}

/** Where a case stands, in the words Member actions and its CSV export both use. */
export type CaseState = "removed" | "in force" | "expired" | "on record";

/** Entries that have an end time of their own and can run out. */
const EXPIRING = new Set(["timeout", "automod-timeout"]);

/**
 * Removal wins over everything else. After that `isInForce` decides whether a
 * restriction is biting now. A timeout whose end has passed is expired, and so
 * is a warning past the server's warn expiry. Everything else, including warns
 * that still count, kicks, lifted bans and reversals, is simply on the record:
 * the stored `active` flag says nothing about those.
 */
export function caseStateOf(entry: RestrictionState, now: Date = new Date()): CaseState {
  if (entry.removed) return "removed";
  if (isInForce(entry, now)) return "in force";
  if (EXPIRING.has(entry.action) && entry.expiresAt !== null && new Date(entry.expiresAt).getTime() <= now.getTime()) return "expired";
  if (warningExpired(entry, now)) return "expired";
  return "on record";
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

/**
 * The one name automod is shown under, wherever an actor, moderator or author
 * of an action is displayed. The bot's own Discord username is never shown for it.
 */
export const AUTOMOD_ACTOR_NAME = "Automod";
export const AUTOMOD_NAME = AUTOMOD_ACTOR_NAME;

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
  | "staff.remove"
  | "appeal.accept"
  | "appeal.deny"
  | "raid.lockdown"
  | "raid.unlock"
  | "raid.mass";

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
  "appeal.accept": "Accepted a ban appeal",
  "appeal.deny": "Denied a ban appeal",
  "raid.lockdown": "Locked channels",
  "raid.unlock": "Unlocked channels",
  "raid.mass": "Took a mass action",
};

/** What the dashboard shows for a Discord user, wherever one appears. */
export interface UserRef {
  userId: string;
  /** Display name, or null when Discord no longer knows the user. */
  name: string | null;
  avatarUrl: string | null;
  /** Whether they are in the server right now. */
  inServer: boolean;
  /** Set on the bot's own account: it is shown as Automod, with an icon in place of an avatar. */
  automod?: boolean;
}

/** Whether an id, or an audit actor's role, means the bot acting on its own through automod. */
export function isAutomodActor(actor: { userId: string; role?: string | null }, botUserId?: string | null): boolean {
  return actor.role === "automod" || (!!botUserId && actor.userId === botUserId);
}

/** How the bot's own account appears in every place a person would: named Automod, with no Discord avatar. */
export function automodRef(botUserId: string): UserRef {
  return { userId: botUserId, name: AUTOMOD_NAME, avatarUrl: null, inServer: true, automod: true };
}

/*
 * Automod's cases store their reason as `<rule key>: <wording>`, such as
 * `rateLimit: Sent 8 messages...`. The key is what the code knows a rule by and
 * must never be shown to a person, so everything that displays a reason reads
 * it through these. Stored rows are left as they are and mapped when read.
 */

/** Keyed by the lower-cased rule key. The same names the automod settings give each rule. */
const AUTOMOD_RULE_LABEL: Record<string, string> = {
  invites: "Invite links",
  links: "Links",
  capitals: "Excessive capitals",
  repeatedtext: "Repeated text",
  mentions: "Mass mentions",
  bannedwords: "Banned words",
  ratelimit: "Rate limit",
  unknown: "Unknown rule",
  other: "Other rules",
};

/** A readable name for an automod rule key, including one this version has never heard of. */
export function automodRuleLabel(rule: string): string {
  const key = rule.trim().toLowerCase();
  const known = AUTOMOD_RULE_LABEL[key];
  if (known) return known;
  const words = rule
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .toLowerCase();
  return words === "" ? AUTOMOD_RULE_LABEL.unknown! : words.charAt(0).toUpperCase() + words.slice(1);
}

export interface AutomodReason {
  /** Lower-cased rule key, or null when the reason does not start with something that looks like one. */
  rule: string | null;
  /** The text after the rule, or the whole reason when no rule was found. Null when there is nothing left. */
  detail: string | null;
}

/** Longest text before a colon that is still taken to be a rule key rather than a sentence. */
const RULE_KEY_MAX = 32;

export function parseAutomodReason(reason: string | null | undefined): AutomodReason {
  const text = (reason ?? "").trim();
  if (text === "") return { rule: null, detail: null };

  const colon = text.indexOf(":");
  const head = (colon === -1 ? text : text.slice(0, colon)).trim();
  const key = head.toLowerCase();
  const looksLikeRule = head !== "" && head.length <= RULE_KEY_MAX && /^[A-Za-z][A-Za-z0-9_-]*$/.test(head);

  if (!looksLikeRule && !(key in AUTOMOD_RULE_LABEL)) return { rule: null, detail: text };
  const detail = colon === -1 ? "" : text.slice(colon + 1).trim();
  return { rule: key, detail: detail === "" ? null : detail };
}

/** The wording after the rule, without the code marks Discord needs and a web page does not. */
export function automodDetailText(detail: string | null): string | null {
  if (detail === null) return null;
  const plain = detail.replace(/`/g, "").trim();
  return plain === "" ? null : plain;
}

/**
 * A case's reason as one line a person can read: an automod case's rule key
 * becomes the rule's name ("Rate limit: Sent 8 messages..."), and any other
 * case's reason is returned as it is.
 */
export function readableReason(action: string, reason: string | null): string | null {
  if (reason === null || !action.startsWith("automod-")) return reason;
  const parsed = parseAutomodReason(reason);
  if (!parsed.rule) return automodDetailText(parsed.detail);
  const detail = automodDetailText(parsed.detail);
  const label = automodRuleLabel(parsed.rule);
  return detail ? `${label}: ${detail}` : label;
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
  /** Set when the bot took this case by itself because an escalation rule fired. Absent from an older bot. */
  automatic?: AutomaticCase | null;
  /** For a warning, when it stops counting under the server's warn expiry. Null when it never does. Absent from an older bot. */
  warnExpiresAt?: string | null;
}

/** What happened in Discord when a removed case was still in force: taken off, left on, could not be, or there was nothing to take off. */
export type LiftResult = "lifted" | "kept" | "failed" | "nothing";

/** The reply to removing a case. `lift` is absent when the case held nothing in Discord. */
export interface VoidReply extends InfractionDto {
  lift?: { kind: "ban" | "timeout"; result: LiftResult } | null;
}

/** Why the bot took a case by itself: which escalation rule fired, on how many warnings. */
export interface AutomaticCase {
  ruleId: string;
  /** The rule's name as it was when it fired. */
  rule: string;
  /** How many warnings were counted. */
  warns: number;
  /** The window they were counted over, or null for all time. */
  windowMs: number | null;
  /** The warning that made the count, by case number. */
  fromCase: number | null;
}

/** Reads the stored `automatic` column back. A damaged value reads as none. */
export function readAutomatic(stored: string | null | undefined): AutomaticCase | null {
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as Partial<AutomaticCase> | null;
    if (!value || typeof value !== "object" || typeof value.rule !== "string") return null;
    return {
      ruleId: typeof value.ruleId === "string" ? value.ruleId : "",
      rule: value.rule,
      warns: typeof value.warns === "number" ? value.warns : 0,
      windowMs: typeof value.windowMs === "number" ? value.windowMs : null,
      fromCase: typeof value.fromCase === "number" ? value.fromCase : null,
    };
  } catch {
    return null;
  }
}

/** "3 warnings in 30 days", for the line that says why an automatic case was taken. */
export function describeAutomatic(automatic: AutomaticCase): string {
  const warns = `${automatic.warns} ${automatic.warns === 1 ? "warning" : "warnings"}`;
  if (automatic.windowMs === null) return warns;
  const days = automatic.windowMs / 86_400_000;
  if (Number.isInteger(days)) return `${warns} in ${days} ${days === 1 ? "day" : "days"}`;
  const hours = Math.max(1, Math.round(automatic.windowMs / 3_600_000));
  return `${warns} in ${hours} ${hours === 1 ? "hour" : "hours"}`;
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
  /** The case's number on the member's record, for linking to it. Absent from an older bot, and null when the entry is not about a case. */
  caseNumber?: number | null;
  noteId: number | null;
  /** Parsed snapshots, present for edits and removals. */
  before: unknown;
  after: unknown;
}

export interface MemberSummary {
  user: UserRef;
  /** Entries on their record, not counting removed ones. */
  infractionCount: number;
  /** Warnings that still count: removed ones and ones past the server's warn expiry are left out. */
  warnCount: number;
  /** Warnings on the record that have stopped counting under the warn expiry. Absent from an older bot. */
  expiredWarnCount?: number;
  timeoutCount: number;
  banCount: number;
  kickCount: number;
  /** Entries automod recorded, of any kind. Absent from an older bot. */
  automodCount?: number;
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
  /** Whole UTC days the range covers. */
  days: number;
  since: string;
  /** Last day in the range, `YYYY-MM-DD`. Missing from an older bot, where the range always ends today. */
  until?: string;
  /** How the range was chosen: the last `days` days, all time, or two dates. Missing means "days". */
  range?: "days" | "all" | "custom";
  /** What one entry of `perDay` covers. Missing means "day". */
  bucket?: "day" | "week" | "month";
  totals: StatsTotals;
  /** The same counts for the period of equal length just before this one, for comparison. Null when it cannot be worked out, and always for all time. */
  previous: StatsTotals | null;
  /**
   * One entry per day across the range, oldest first, zeros included; one per
   * week or month instead when `bucket` says so. `end` is the last day an entry
   * covers, set only for weeks and months.
   */
  perDay: { date: string; end?: string; warn: number; timeout: number; kick: number; ban: number; other: number }[];
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
  /** The server's reason presets, in the order the owner listed them. Absent from an older bot. */
  reasonPresets?: ReasonPresetDto[];
}

/** A common reason a server keeps ready, picked in the action form, the right-click forms and the slash commands. */
export interface ReasonPresetDto {
  name: string;
  reason: string;
  /** A length a timeout or temporary ban starts at when this is picked, or null. */
  durationMs: number | null;
}

/**
 * The preset a typed reason names, matched on its name ignoring case and the
 * spaces around it, or null. The slash commands' autocomplete fills the name in,
 * and the right-click forms take it typed, so both arrive here as the name.
 */
export function presetNamed<T extends { name: string }>(typed: string | null | undefined, presets: readonly T[]): T | null {
  const key = (typed ?? "").trim().toLowerCase();
  if (key === "") return null;
  return presets.find((preset) => preset.name.trim().toLowerCase() === key) ?? null;
}

/* Appeals ------------------------------------------------------------------------ */

export const APPEAL_STATUSES = ["pending", "accepted", "denied"] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

export const isAppealStatus = (value: unknown): value is AppealStatus =>
  typeof value === "string" && (APPEAL_STATUSES as readonly string[]).includes(value);

/** The longest appeal a member can send, and the longest answer staff can send back. Discord's modal limit is 4000. */
export const APPEAL_LIMITS = { text: 2000, response: 1000 } as const;

export interface AppealDto {
  id: number;
  user: UserRef;
  caseNumber: number;
  infractionId: number;
  status: AppealStatus;
  /** What the member wrote. */
  text: string;
  createdAt: string;
  decided: null | { at: string; by: UserRef; response: string | null };
  /** The ban the appeal is about, as the record has it now. */
  ban: {
    reason: string | null;
    createdAt: string;
    expiresAt: string | null;
    moderator: UserRef;
    /** The case was removed from the record since. */
    removed: boolean;
  };
}

export interface AppealListDto extends Page<AppealDto> {
  /** Pending appeals, whatever the filter, for the count on the tab. */
  pending: number;
}

/** One appeal with what staff need to decide it: the member's whole record and their notes. */
export interface AppealDetailDto {
  appeal: AppealDto;
  /** Whether Discord has the member banned now, or null when it could not be asked. */
  stillBanned: boolean | null;
  infractions: InfractionDto[];
  notes: NoteDto[];
  /** The member's other appeals here, newest first. */
  others: AppealDto[];
}

/* Raid tools ----------------------------------------------------------------------- */

export interface LockedChannelDto {
  channelId: string;
  /** The channel's name now, or null when it was deleted while locked. */
  name: string | null;
  lockedAt: string;
  lockedBy: UserRef;
  reason: string | null;
  endsAt: string | null;
}

export interface LockableChannelDto {
  id: string;
  name: string;
  /** The category it sits in, for grouping in the picker. */
  parent: string | null;
  locked: boolean;
  /** Left out of "all channels" by the server's settings. */
  exempt: boolean;
  /** A voice or stage channel. Absent from an older bot. */
  voice?: boolean;
}

export interface RaidStatusDto {
  moduleEnabled: boolean;
  locked: LockedChannelDto[];
  channels: LockableChannelDto[];
  /** The join-rate alert as set in the Moderation settings. */
  joinAlert: { enabled: boolean; joins: number; seconds: number; lockdown: boolean };
  /** Members who joined in the last ten minutes, as the bot counted them since it started. */
  recentJoins: number;
  /** Whether the bot can change channel permissions, which a lockdown needs. */
  canManageChannels: boolean;
}

export type MassActionKind = "ban" | "kick";

/** Who a mass action is aimed at: pasted ids, or everyone who joined between two times. */
export interface MassActionRequest {
  action: MassActionKind;
  ids?: string[];
  joinedAfter?: string;
  joinedBefore?: string;
  reason: string | null;
  /** A ban's days of messages to delete. */
  deleteDays?: number | null;
}

export interface MassTargetDto {
  user: UserRef;
  joinedAt: string | null;
  accountCreatedAt: string | null;
  /** Why this one would be left alone, or null when the action would go ahead. */
  skip: string | null;
}

export interface MassPreviewDto {
  action: MassActionKind;
  targets: MassTargetDto[];
  /** How many would be acted on. */
  count: number;
  skipped: number;
  /** Names exactly who would be acted on. The run must send it back, and is refused if the set has changed. */
  token: string;
}

export interface MassJobDto {
  id: string;
  action: MassActionKind;
  status: "running" | "done";
  total: number;
  /** Members processed so far, the failed ones included, so it reaches `total` when the job is done. */
  done: number;
  /** How many of `done` could not be actioned. */
  failed: number;
  /** One line per id that failed, for the person who started it. */
  failures: string[];
}

/** The most a mass action can name at once. Discord's own bulk ban takes 200. */
export const MASS_ACTION_LIMIT = 200;

/**
 * Where one member stands in Discord right now, for the person asking, read
 * by the bot rather than from the record. The record can disagree with
 * Discord: a ban case removed from it, or a ban made outside the bot.
 */
export interface ActionTargetDto {
  inServer: boolean;
  /** Whether Discord has them banned, or null when Discord could not be asked. */
  banned: boolean | null;
  /** When their Discord timeout ends, or null when they are not timed out. */
  timedOutUntil: string | null;
  /** The actions the bot would refuse for this person on this target, each with a short reason. */
  blocked: Partial<Record<ModActionKind, string>>;
}
