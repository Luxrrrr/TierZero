/**
 * The rules a moderation action is held to before anything is asked of
 * Discord, and the wording of what comes back. Kept free of discord.js so
 * every refusal and note can be tested without a gateway connection. The
 * slash commands and the dashboard both go through these, which is what keeps
 * the two from drifting apart.
 */

import type { ActionContextDto, ModActionKind } from "@tier0/core";
import { MAX_TIMEOUT_MS, validateBanDuration, validateTimeoutDuration } from "./duration.js";
import type { ModerationAction } from "./modlog.js";

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
  constructor(
    readonly status: RefusalStatus,
    message: string,
  ) {
    super(message);
    this.name = "ActionRefused";
  }
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

export const REASON_REQUIRED = "This server requires a reason for moderation actions.";
export const NOT_A_MEMBER = "That user is not a member of this server.";
export const LOOKUP_FAILED = "Could not check that member. Try again.";
export const ACTION_IN_PROGRESS = "Another action on this member is in progress. Try again in a moment.";

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
    throw new ActionRefused(400, `A reason can be at most ${REASON_MAX} characters.`);
  }
  if (settings.requireReason && reason === null) throw new ActionRefused(400, REASON_REQUIRED);
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
  if (!check.ok) throw new ActionRefused(400, check.reason);
  if (check.ms < MIN_DURATION_MS) throw new ActionRefused(400, "A timeout must last at least one second.");
  return check.ms;
}

/** A ban's length: null for a permanent ban. */
export function checkBanDuration(ms: number | null): number | null {
  if (ms === null) return null;
  wholeMs(ms);
  const check = validateBanDuration(ms);
  if (!check.ok) throw new ActionRefused(400, check.reason);
  if (check.ms < MIN_DURATION_MS) {
    throw new ActionRefused(400, "A temporary ban must last at least one second.");
  }
  if (check.ms > MAX_BAN_MS) {
    throw new ActionRefused(
      400,
      `A temporary ban can last at most ${MAX_BAN_DAYS} days. Leave the duration unset for a permanent ban.`,
    );
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

/** Nobody acts on themselves, and the bot does not act on itself. */
export function checkTargetIdentity(targetId: string, actorId: string, botId: string | null): void {
  if (targetId === actorId) {
    throw new ActionRefused(403, "You cannot take a moderation action against yourself.");
  }
  if (botId !== null && targetId === botId) {
    throw new ActionRefused(403, "The bot cannot take a moderation action against itself.");
  }
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
  return origin === "command"
    ? `${name} is already banned. Use /unban first to change it.`
    : `${name} is already banned. Lift the ban first to change it.`;
}

export const notBanned = (name: string): string => `${name} is not banned.`;

export const notTimedOut = (name: string): string =>
  `${name} is not timed out, so there is no timeout to clear.`;

const FAILED_VERB: Record<Exclude<ModerationAction, "warn">, { verb: string; check: "rank" | "permissions" }> = {
  timeout: { verb: "time that member out", check: "rank" },
  "timeout-clear": { verb: "clear that timeout", check: "permissions" },
  kick: { verb: "kick that member", check: "rank" },
  ban: { verb: "ban that member", check: "rank" },
  unban: { verb: "lift that ban", check: "permissions" },
};

/** Discord refused the call itself. The command speaks as the bot; the dashboard speaks about it. */
export function discordFailure(action: Exclude<ModerationAction, "warn">, origin: ActionOrigin): string {
  const { verb, check } = FAILED_VERB[action];
  if (origin === "command") {
    return check === "rank"
      ? `I could not ${verb}. Check that my role is above theirs.`
      : `I could not ${verb}. Check my permissions.`;
  }
  return check === "rank"
    ? `The bot could not ${verb}. Check that its role is above theirs.`
    : `The bot could not ${verb}. Check its permissions.`;
}

export const BOT_RANK_DASHBOARD =
  "The bot's highest role is not above theirs, so Discord will not let it do that. Move the bot's role higher in the server's role settings.";

/** `withheld`: the dashboard does not message someone who is not in the server. */
export type DmOutcome = "sent" | "failed" | "off" | "withheld";

/**
 * Whether to send the direct message at all. From the dashboard, a target who
 * is not in the server could be any Discord account, and the message carries
 * free text, so the bot does not become a way to message strangers. An unban
 * is the exception: its target is confirmed as banned from this server.
 */
export function shouldMessage(
  action: ModerationAction,
  origin: ActionOrigin,
  targetInServer: boolean,
  dmOnAction: boolean,
): DmOutcome | "send" {
  if (!dmOnAction) return "off";
  if (origin === "dashboard" && !targetInServer && action !== "unban") return "withheld";
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

/**
 * Side notes for the person who acted. Only what they could not otherwise
 * know: a setting they chose, such as having no mod log channel, is not news.
 */
export function outcomeNotes(facts: OutcomeFacts): string[] {
  const notes: string[] = [];
  if (!facts.targetInServer && facts.action === "warn") {
    notes.push("They are not in the server, so the warning is on their record only.");
  }
  if (!facts.targetInServer && facts.action === "ban") {
    notes.push("They are not in the server, so the ban stops them from joining again.");
  }
  if (facts.dm === "withheld") {
    notes.push("They are not in the server, so they were not sent a direct message.");
  }
  if (facts.dm === "failed") {
    notes.push("They could not be sent a direct message, most likely because they do not accept messages from the bot.");
  }
  if (facts.modLog === "missing") {
    notes.push("The mod log channel no longer exists, so nothing was posted. Choose another in the Moderation settings.");
  }
  if (facts.modLog === "failed") {
    notes.push("The mod log post failed. Check that the bot can send messages in the mod log channel.");
  }
  return notes;
}
