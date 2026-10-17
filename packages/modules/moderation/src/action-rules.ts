/**
 * The rules a moderation action is held to before anything is asked of
 * Discord, and the wording of what comes back. Kept free of discord.js so
 * every refusal and note can be tested without a gateway connection. The
 * slash commands and the dashboard both go through these, which is what keeps
 * the two from drifting apart.
 */

import { canTakeAction, type ActionContextDto, type ModActionKind, type ReplyValues, type StaffRole } from "@tier0/core";
import { MAX_TIMEOUT_MS, validateBanDuration, validateTimeoutDuration } from "./duration.js";
import type { ModerationAction } from "./modlog.js";
import { DEFAULT_WORDING, refusalSentence, type RefusalCode, type Wording } from "./texts.js";

/** Where an action was asked for. Some refusals and wording only apply to one of them. */
export type ActionOrigin = "command" | "dashboard";

export type RefusalStatus = 400 | 403 | 404 | 409 | 502;

/**
 * An action that will not go ahead, with a message fit to show the person who
 * asked. The status follows HTTP so the control API can pass it straight on:
 * 400 for bad input, 403 for not allowed, 404 for a missing member, 409 for a
 * member already in the requested state, 502 when Discord refused the call.
 */
export class ActionRefused extends Error {
  /**
   * `code` and `values` are set when the sentence is one an owner can reword.
   * `message` is always the default sentence, which is what the dashboard shows;
   * the place that answers in Discord looks the code up in the server's settings.
   */
  constructor(
    readonly status: RefusalStatus,
    message: string,
    readonly code?: RefusalCode,
    readonly values: ReplyValues = {},
  ) {
    super(message);
    this.name = "ActionRefused";
  }
}

/** A refusal whose wording comes from the table in texts.ts, in the dashboard's version when it was asked for there. */
export function refusal(status: RefusalStatus, code: RefusalCode, values: ReplyValues = {}, origin: ActionOrigin = "command"): ActionRefused {
  return new ActionRefused(status, refusalSentence(code, values, origin), code, values);
}

export const REASON_MAX = 500;
export const MIN_DURATION_MS = 1_000;
export const MAX_DELETE_DAYS = 7;
/**
 * Discord sets no ceiling on a ban, but a date far enough out cannot be
 * stored, and nobody means a ban of decades as anything but permanent.
 */
export const MAX_BAN_DAYS = 3650;
const DAY_MS = 86_400_000;
export const MAX_BAN_MS = MAX_BAN_DAYS * DAY_MS;

export const REASON_REQUIRED = refusalSentence("reasonRequired", {});
export const NOT_A_MEMBER = refusalSentence("notAMember", {});
export const LOOKUP_FAILED = refusalSentence("lookupFailed", {});
export const ACTION_IN_PROGRESS = refusalSentence("actionInProgress", {});

/** Discord's error codes for an id that is not a member, not a user at all, or not banned. */
const UNKNOWN_MEMBER = 10007;
const UNKNOWN_USER = 10013;
const UNKNOWN_BAN = 10026;

const codeOf = (error: unknown): unknown =>
  typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;

/**
 * Whether a failed member lookup means the person is not in the server. Only
 * Discord saying so counts: a timeout or an outage must not be mistaken for a
 * departure, because a departed member skips the role comparison.
 */
export function isAbsentMember(error: unknown): boolean {
  const code = codeOf(error);
  return code === UNKNOWN_MEMBER || code === UNKNOWN_USER;
}

/** Whether a failed ban lookup means there is no ban, as opposed to the lookup itself failing. */
export function isAbsentBan(error: unknown): boolean {
  const code = codeOf(error);
  return code === UNKNOWN_BAN || code === UNKNOWN_USER;
}

/** A short description of a Discord error for the log: its code and message, nothing from the request. */
export function describeDiscordError(error: unknown): string {
  const code = codeOf(error);
  const message = error instanceof Error ? error.message : String(error);
  return code === undefined ? message : `${String(code)} ${message}`;
}

/** The slash command whose switch on the Commands page also governs this action. */
export function commandForAction(kind: ModActionKind): string {
  return kind === "timeout-clear" ? "timeout" : kind;
}

const SWITCHED_OFF: Record<string, string> = {
  warn: "Warning is",
  timeout: "Timeouts are",
  kick: "Kicking is",
  ban: "Banning is",
  unban: "Unbanning is",
};

export function commandSwitchedOff(kind: ModActionKind): string {
  return `${SWITCHED_OFF[commandForAction(kind)]} switched off for this server on the Commands page.`;
}

const ALL_ACTIONS: ModActionKind[] = ["warn", "timeout", "timeout-clear", "kick", "ban", "unban"];

/** The actions whose command an operator has switched off, given the names of every switched-off command. */
export function disabledActions(disabledCommands: Iterable<string>): ModActionKind[] {
  const off = new Set(disabledCommands);
  return ALL_ACTIONS.filter((kind) => off.has(commandForAction(kind)));
}

export interface ReasonSettings {
  requireReason: boolean;
}

/** Trims the reason and treats an empty one as none. */
export function checkReason(raw: string | null, settings: ReasonSettings): string | null {
  const reason = raw === null ? null : raw.trim() || null;
  if (reason !== null && reason.length > REASON_MAX) {
    throw refusal(400, "reasonTooLong", { max: REASON_MAX });
  }
  if (settings.requireReason && reason === null) throw refusal(400, "reasonRequired");
  return reason;
}

function wholeMs(ms: number): void {
  if (!Number.isInteger(ms)) {
    throw new ActionRefused(400, "The duration must be a whole number of milliseconds.");
  }
}

/** A timeout's length: required, from one second to Discord's 28 days. */
export function checkTimeoutDuration(ms: number | null): number {
  if (ms === null) throw new ActionRefused(400, "Choose how long the timeout lasts.");
  wholeMs(ms);
  const check = validateTimeoutDuration(ms);
  if (!check.ok) throw new ActionRefused(400, check.reason, check.code);
  if (check.ms < MIN_DURATION_MS) throw new ActionRefused(400, "A timeout must last at least one second.");
  return check.ms;
}

/** A ban's length: null for a permanent ban. */
export function checkBanDuration(ms: number | null): number | null {
  if (ms === null) return null;
  wholeMs(ms);
  const check = validateBanDuration(ms);
  if (!check.ok) throw new ActionRefused(400, check.reason, check.code);
  if (check.ms < MIN_DURATION_MS) {
    throw new ActionRefused(400, "A temporary ban must last at least one second.");
  }
  if (check.ms > MAX_BAN_MS) {
    throw refusal(400, "banTooLong", { maxDays: MAX_BAN_DAYS });
  }
  return check.ms;
}

/** Days of the banned member's messages to delete, falling back to the server's setting. */
export function checkDeleteDays(days: number | null, fallback: number): number {
  const value = days ?? fallback;
  if (!Number.isInteger(value) || value < 0 || value > MAX_DELETE_DAYS) {
    throw new ActionRefused(400, `Choose between 0 and ${MAX_DELETE_DAYS} days of messages to delete.`);
  }
  return value;
}

/** Which identity rule rules the target out, or null when none does. The menu and the action share it. */
export function targetIdentityCode(
  targetId: string,
  actorId: string,
  botId: string | null,
  ownerId: string | null = null,
): "targetSelf" | "targetBot" | "targetOwner" | null {
  if (targetId === actorId) return "targetSelf";
  if (botId !== null && targetId === botId) return "targetBot";
  if (ownerId !== null && targetId === ownerId) return "targetOwner";
  return null;
}

/** Nobody acts on themselves, the bot does not act on itself, and the server owner is out of reach. */
export function checkTargetIdentity(
  targetId: string,
  actorId: string,
  botId: string | null,
  ownerId: string | null = null,
): void {
  const code = targetIdentityCode(targetId, actorId, botId, ownerId);
  if (code) throw refusal(403, code);
}

/** The key of an action in the label groups that name it by what it does. */
export function wordKey(kind: ModActionKind): keyof Wording["abilities"] {
  return kind === "timeout-clear" ? "timeoutClear" : kind;
}

export interface ActorStanding {
  action: ModActionKind;
  /** Whether the actor holds the Discord permission this action maps to, as a member of the server. */
  hasDiscordPermission: boolean;
  /** Their place on the server's moderation staff list, if any. */
  staffRole: StaffRole | null;
  /** The person running this install, who is trusted on every server. */
  isInstanceOwner: boolean;
}

/**
 * Whether the person asking may take this action at all. A slash command is
 * only hidden from people by default; an operator can widen it in Discord's
 * Integrations settings, so the permission has to be checked here too.
 * Holding the Discord permission or a staff role that allows the action are
 * the same two doors the right-click menu and the dashboard have always used.
 */
export function checkActorMayAct(actor: ActorStanding, abilities: Wording["abilities"] = DEFAULT_WORDING.abilities): void {
  if (actor.isInstanceOwner || actor.hasDiscordPermission) return;
  if (actor.staffRole !== null && canTakeAction(actor.staffRole, actor.action)) return;
  throw refusal(403, "noPermission", { action: abilities[wordKey(actor.action)] });
}

/**
 * Whether a scheduled unban must leave the ban alone: the member's newest open
 * ban is permanent or has not reached its end, so the task that fired belongs
 * to an earlier ban that has since been replaced.
 */
export function banOutlivesTask(latest: { expiresAt: Date | null } | null, now: Date): boolean {
  if (!latest) return false;
  return latest.expiresAt === null || latest.expiresAt.getTime() > now.getTime();
}

/** Whether the action is refused when the target is not in the server. */
export function needsMember(action: ModerationAction, origin: ActionOrigin): boolean {
  if (action === "ban" || action === "unban") return false;
  // A warning only writes a record, so the dashboard may log one against
  // someone who has left. The slash command has always refused it, and keeps to that.
  if (action === "warn") return origin === "command";
  return true;
}

export interface RequestFields {
  reason: string | null;
  durationMs: number | null;
  deleteDays: number | null;
}

/**
 * Reads the fields of a dashboard request whose shape is not yet known. A
 * field that does not apply to the action is ignored, whatever it holds.
 */
export function readRequestFields(action: ModerationAction, body: Record<string, unknown>): RequestFields {
  const { reason, durationMs, deleteDays } = body;
  if (reason !== undefined && reason !== null && typeof reason !== "string") {
    throw new ActionRefused(400, "The reason must be text.");
  }
  const takesDuration = action === "timeout" || action === "ban";
  if (takesDuration && durationMs !== undefined && durationMs !== null && typeof durationMs !== "number") {
    throw new ActionRefused(400, "The duration must be a number of milliseconds.");
  }
  if (action === "ban" && deleteDays !== undefined && deleteDays !== null && typeof deleteDays !== "number") {
    throw new ActionRefused(400, "The days of messages to delete must be a number.");
  }
  return {
    reason: typeof reason === "string" ? reason : null,
    durationMs: takesDuration && typeof durationMs === "number" ? durationMs : null,
    deleteDays: action === "ban" && typeof deleteDays === "number" ? deleteDays : null,
  };
}

export interface ContextSettings {
  requireReason: boolean;
  dmOnAction: boolean;
  defaultTimeoutDuration: number;
  deleteMessageDays: number;
}

/** What the dashboard's action form needs from the server's Moderation settings. */
export function actionContext(
  settings: ContextSettings,
): Omit<ActionContextDto, "moduleEnabled" | "disabledActions"> {
  return {
    requireReason: settings.requireReason,
    dmOnAction: settings.dmOnAction,
    defaultTimeoutMs: settings.defaultTimeoutDuration,
    maxTimeoutMs: MAX_TIMEOUT_MS,
    deleteMessageDays: settings.deleteMessageDays,
    maxBanDays: MAX_BAN_DAYS,
  };
}

export function alreadyBanned(name: string, origin: ActionOrigin): string {
  return refusalSentence("alreadyBanned", { name }, origin);
}

export const notBanned = (name: string): string => refusalSentence("notBanned", { name });

/** Only the dashboard can ask to clear a timeout that is not there, so this has no wording an owner can change. */
export const notTimedOut = (name: string): string =>
  `${name} is not timed out, so there is no timeout to clear.`;

type FailableAction = Exclude<ModerationAction, "warn">;

const FAILED_CHECK: Record<FailableAction, "rank" | "permissions"> = {
  timeout: "rank",
  "timeout-clear": "permissions",
  kick: "rank",
  ban: "rank",
  unban: "permissions",
};

/** The refusal code for Discord turning an action down, and the values it needs. */
export function discordFailureCode(
  action: FailableAction,
  verbs: Wording["verbs"] = DEFAULT_WORDING.verbs,
): { code: RefusalCode; values: ReplyValues } {
  const code = FAILED_CHECK[action] === "rank" ? "discordFailedRank" : "discordFailedPermission";
  return { code, values: { verb: verbs[action === "timeout-clear" ? "timeoutClear" : action] } };
}

/** Discord refused the call itself. The command speaks as the bot; the dashboard speaks about it. */
export function discordFailure(action: FailableAction, origin: ActionOrigin): string {
  const { code, values } = discordFailureCode(action);
  return refusalSentence(code, { ...values, correctionNote: "" }, origin);
}

/**
 * Discord would refuse this call, and that is known before anyone is told
 * about it: the member holds Administrator or sits above the bot, or the bot
 * lacks the permission. Raised ahead of the direct message so nobody hears
 * they were removed by an action that was never going to happen.
 */
export function cannotActOn(action: "timeout" | "kick" | "ban", origin: ActionOrigin): string {
  return refusalSentence("cannotActOn", { verb: DEFAULT_WORDING.verbs[action] }, origin);
}

export const BOT_RANK_DASHBOARD = refusalSentence("botRank", {}, "dashboard");

/** `withheld`: the member is not in the server, so they are not messaged. */
export type DmOutcome = "sent" | "failed" | "off" | "withheld";

/**
 * Whether to send the direct message at all. A target who is not in the
 * server could be any Discord account, and the message carries free text, so
 * the bot does not become a way to message strangers, whichever way the
 * action was asked for. An unban is the exception: its target is confirmed as
 * banned from this server.
 */
export function shouldMessage(
  action: ModerationAction,
  targetInServer: boolean,
  dmOnAction: boolean,
): DmOutcome | "send" {
  if (!dmOnAction) return "off";
  if (!targetInServer && action !== "unban") return "withheld";
  return "send";
}
export type ModLogOutcome = "posted" | "unset" | "missing" | "failed";

export interface OutcomeFacts {
  action: ModerationAction;
  dm: DmOutcome;
  modLog: ModLogOutcome;
  /** Whether the target was in the server when the action was taken. */
  targetInServer: boolean;
}

export type OutcomeNote = "warnNotInServer" | "banNotInServer" | "dmWithheld" | "dmFailed" | "modLogMissing" | "modLogFailed";

/**
 * Side notes for the person who acted, as the labels that word them. Only what
 * they could not otherwise know: a setting they chose, such as having no mod
 * log channel, is not news.
 */
export function outcomeNoteKeys(facts: OutcomeFacts): OutcomeNote[] {
  const notes: OutcomeNote[] = [];
  if (!facts.targetInServer && facts.action === "warn") notes.push("warnNotInServer");
  if (!facts.targetInServer && facts.action === "ban") notes.push("banNotInServer");
  if (facts.dm === "withheld") notes.push("dmWithheld");
  if (facts.dm === "failed") notes.push("dmFailed");
  if (facts.modLog === "missing") notes.push("modLogMissing");
  if (facts.modLog === "failed") notes.push("modLogFailed");
  return notes;
}

export function outcomeNotes(facts: OutcomeFacts, wording: Wording["notes"] = DEFAULT_WORDING.notes): string[] {
  return outcomeNoteKeys(facts).map((key) => wording[key]);
}
