import { canTakeAction, isInForce, isModActionKind } from "@tier0/core";
import type {
  ActionContextDto,
  ActionRequest,
  ActionResult,
  ActionTargetDto,
  InfractionDto,
  ModActionKind,
  ReasonPresetDto,
  StaffRole,
  EvidenceRef,
} from "@tier0/core";

/**
 * The rules behind the profile's "Take action" control: which actions a role
 * and the member's current state allow, the length control, building the
 * request, and the wording around it. No React here so each rule is tested on
 * its own. The bot checks every request again; nothing here grants anything.
 */

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** Discord refuses a member timeout longer than this, whatever the server's settings say. */
export const DISCORD_TIMEOUT_MAX_MS = 28 * DAY_MS;

export const ACTION_REASON_LIMIT = 500;

/* Member state ------------------------------------------------------------------ */

export interface MemberState {
  inServer: boolean;
  banned: boolean;
  timedOut: boolean;
  /** When the timeout in force ends. */
  timeoutUntil: string | null;
}

/**
 * Where the member stands. The record is read by the same rule the standing
 * and the member list use, and automod timeouts count: they are real Discord
 * timeouts and can be cleared the same way. When the bot has said what Discord
 * itself holds, that wins, because the record can disagree: a ban made in
 * Discord leaves no case, and a case can be removed from the record.
 */
export function memberState(
  profile: { user: { inServer: boolean }; infractions: InfractionDto[] },
  now: Date,
  discord: Pick<ActionTargetDto, "inServer" | "banned" | "timedOutUntil"> | null = null,
): MemberState {
  const live = profile.infractions.filter((entry) =>
    isInForce(
      { action: entry.action, active: entry.active, expiresAt: entry.expiresAt, removed: entry.voided !== null },
      now,
    ),
  );
  const timeout = live.find((entry) => entry.action === "timeout" || entry.action === "automod-timeout");
  const recorded: MemberState = {
    inServer: profile.user.inServer,
    banned: live.some((entry) => entry.action === "ban"),
    timedOut: timeout !== undefined,
    timeoutUntil: timeout?.expiresAt ?? null,
  };
  if (!discord) return recorded;
  const until = discord.inServer ? discord.timedOutUntil : null;
  return {
    inServer: discord.inServer,
    banned: discord.banned ?? recorded.banned,
    timedOut: until !== null && Date.parse(until) > now.getTime(),
    timeoutUntil: until,
  };
}

/* Which actions to offer ---------------------------------------------------------- */

export interface ActionOption {
  kind: ModActionKind;
  label: string;
  description: string;
  /** Kick and ban remove the member, so the menu sets them apart. */
  heavy: boolean;
  /** Why the action cannot be taken right now, shown in place of the description. Null when it can. */
  unavailable: string | null;
}

const NOT_IN_SERVER = "Not possible while they are out of the server";

/**
 * The actions the menu lists, in a fixed order. A role's missing permissions
 * are left out entirely. Actions that do not fit the member's state are left
 * out too (Unban for someone who is not banned). Actions the bot would refuse
 * for this target (the server owner, the bot, yourself, someone who outranks
 * you or the bot, or someone who has left) stay listed, greyed out with the
 * reason, so nobody hunts for a missing kick or fills in a form for nothing.
 * `blocked` comes from the bot, which applies the same rules when it acts.
 */
export function actionOptions(
  role: StaffRole,
  state: MemberState,
  switchedOff: readonly ModActionKind[] = [],
  blocked: Partial<Record<ModActionKind, string>> = {},
): ActionOption[] {
  const options: ActionOption[] = [];
  // An action the operator switched off is left out like one the role lacks:
  // there is nothing this person can do about it from the profile.
  const allowed = (kind: ModActionKind) => canTakeAction(role, kind) && !switchedOff.includes(kind);
  const away = state.inServer ? null : NOT_IN_SERVER;
  const why = (kind: ModActionKind, fallback: string | null = null) => blocked[kind] ?? fallback;

  if (allowed("warn")) {
    options.push({ kind: "warn", label: "Warn", description: "Add a warning to their record", heavy: false, unavailable: why("warn") });
  }
  if (allowed("timeout")) {
    options.push({
      kind: "timeout",
      label: state.timedOut ? "Change timeout" : "Timeout",
      description: state.timedOut ? "Set a new end for the current timeout" : "Stop them talking for a set time",
      heavy: false,
      unavailable: why("timeout", away),
    });
  }
  if (allowed("timeout-clear") && state.timedOut) {
    options.push({
      kind: "timeout-clear",
      label: "Clear timeout",
      description: "Let them talk again straight away",
      heavy: false,
      unavailable: why("timeout-clear", away),
    });
  }
  if (allowed("kick")) {
    options.push({ kind: "kick", label: "Kick", description: "Remove them from the server", heavy: true, unavailable: why("kick", away) });
  }
  if (allowed("ban") && !state.banned) {
    options.push({
      kind: "ban",
      label: "Ban",
      description: "Remove them and stop them rejoining",
      heavy: true,
      unavailable: why("ban"),
    });
  }
  if (allowed("unban") && state.banned) {
    options.push({ kind: "unban", label: "Unban", description: "Let them rejoin the server", heavy: false, unavailable: why("unban") });
  }
  return options;
}

/** Reads the bot's answer about where a member stands. Anything malformed reads as no answer, so the record decides. */
export function readStanding(raw: unknown): ActionTargetDto | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.inServer !== "boolean") return null;
  const blocked: Partial<Record<ModActionKind, string>> = {};
  if (value.blocked && typeof value.blocked === "object") {
    for (const [kind, reason] of Object.entries(value.blocked as Record<string, unknown>)) {
      if (isModActionKind(kind) && typeof reason === "string" && reason.trim() !== "") blocked[kind] = reason;
    }
  }
  return {
    inServer: value.inServer,
    banned: typeof value.banned === "boolean" ? value.banned : null,
    timedOutUntil: typeof value.timedOutUntil === "string" && !Number.isNaN(Date.parse(value.timedOutUntil)) ? value.timedOutUntil : null,
    blocked,
  };
}

/* Wording ------------------------------------------------------------------------- */

/** Long names are cut so a button or toast stays one readable line. */
export function shortName(name: string, max = 24): string {
  const clean = name.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function possessive(name: string): string {
  return `${name}’s`;
}

/**
 * The dialog title, which also names the member for the reader. `changing` is
 * a timeout on someone already timed out, which replaces the one running.
 */
export function actionTitle(kind: ModActionKind, name: string, changing = false): string {
  switch (kind) {
    case "warn":
      return `Warn ${name}`;
    case "timeout":
      return changing ? `Change ${possessive(name)} timeout` : `Time out ${name}`;
    case "timeout-clear":
      return `Clear ${possessive(name)} timeout`;
    case "kick":
      return `Kick ${name}`;
    case "ban":
      return `Ban ${name}`;
    case "unban":
      return `Unban ${name}`;
  }
}

/** The confirm button: the action and the person, so a destructive click is never ambiguous. */
export function confirmLabel(kind: ModActionKind, name: string, changing = false): string {
  return actionTitle(kind, shortName(name), changing);
}

export function busyLabel(kind: ModActionKind, changing = false): string {
  switch (kind) {
    case "warn":
      return "Warning…";
    case "timeout":
      return changing ? "Changing…" : "Timing out…";
    case "timeout-clear":
      return "Clearing…";
    case "kick":
      return "Kicking…";
    case "ban":
      return "Banning…";
    case "unban":
      return "Unbanning…";
  }
}

const DONE: Record<ModActionKind, (name: string) => string> = {
  warn: (name) => `Warned ${name}.`,
  timeout: (name) => `Timed out ${name}.`,
  "timeout-clear": (name) => `Cleared ${possessive(name)} timeout.`,
  kick: (name) => `Kicked ${name}.`,
  ban: (name) => `Banned ${name}.`,
  unban: (name) => `Unbanned ${name}.`,
};

/** "Banned Priya. Case #61." */
export function successTitle(kind: ModActionKind, name: string, caseNumber: number | null, changing = false): string {
  const done = changing && kind === "timeout" ? `Changed ${possessive(shortName(name))} timeout.` : DONE[kind](shortName(name));
  return caseNumber !== null && Number.isFinite(caseNumber) ? `${done} Case #${caseNumber}.` : done;
}

/** The start of the sentence a refusal is shown in, before the server's own reason. */
export function failureLead(kind: ModActionKind, name: string): string {
  const who = shortName(name);
  switch (kind) {
    case "warn":
      return `${who} was not warned`;
    case "timeout":
      return `${who} was not timed out`;
    case "timeout-clear":
      return `${possessive(who)} timeout was not cleared`;
    case "kick":
      return `${who} was not kicked`;
    case "ban":
      return `${who} was not banned`;
    case "unban":
      return `${who} was not unbanned`;
  }
}

/* Lengths --------------------------------------------------------------------------- */

export type DurationUnit = "s" | "m" | "h" | "d";

export const UNIT_MS: Record<DurationUnit, number> = { s: SECOND_MS, m: MINUTE_MS, h: HOUR_MS, d: DAY_MS };

export const UNIT_OPTIONS: { value: DurationUnit; label: string }[] = [
  { value: "s", label: "seconds" },
  { value: "m", label: "minutes" },
  { value: "h", label: "hours" },
  { value: "d", label: "days" },
];

const UNIT_NAME: Record<DurationUnit, string> = { s: "second", m: "minute", h: "hour", d: "day" };

export interface DurationPreset {
  ms: number;
  label: string;
}

export const TIMEOUT_PRESETS: DurationPreset[] = [
  { ms: 60 * SECOND_MS, label: "60 seconds" },
  { ms: 5 * MINUTE_MS, label: "5 minutes" },
  { ms: HOUR_MS, label: "1 hour" },
  { ms: DAY_MS, label: "1 day" },
  { ms: 7 * DAY_MS, label: "7 days" },
];

/** A temporary ban is measured in days; a minute-long ban is never what anyone means. */
export const BAN_PRESETS: DurationPreset[] = [
  { ms: DAY_MS, label: "1 day" },
  { ms: 3 * DAY_MS, label: "3 days" },
  { ms: 7 * DAY_MS, label: "7 days" },
  { ms: 30 * DAY_MS, label: "30 days" },
];

/** "90 minutes", "1 day": the coarsest unit that divides the length exactly. */
export function describeMs(ms: number): string {
  const units: DurationUnit[] = ["d", "h", "m", "s"];
  for (const unit of units) {
    const size = UNIT_MS[unit];
    if (ms >= size && ms % size === 0) {
      const amount = ms / size;
      return `${amount} ${UNIT_NAME[unit]}${amount === 1 ? "" : "s"}`;
    }
  }
  const seconds = Math.max(1, Math.round(ms / SECOND_MS));
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

/** Splits a length into the number and unit the custom fields show. */
export function splitMs(ms: number): { amount: string; unit: DurationUnit } {
  const units: DurationUnit[] = ["d", "h", "m", "s"];
  for (const unit of units) {
    const size = UNIT_MS[unit];
    if (ms >= size && ms % size === 0) return { amount: String(ms / size), unit };
  }
  return { amount: String(Math.max(1, Math.round(ms / SECOND_MS))), unit: "s" };
}

/** The longest timeout this server allows, never past Discord's own ceiling. */
export function timeoutMax(context: Pick<ActionContextDto, "maxTimeoutMs">): number {
  const configured = context.maxTimeoutMs;
  return Number.isFinite(configured) && configured > 0 ? Math.min(configured, DISCORD_TIMEOUT_MAX_MS) : DISCORD_TIMEOUT_MAX_MS;
}

/** The longest temporary ban, or 0 when the server allows only permanent bans. */
export function banMax(context: Pick<ActionContextDto, "maxBanDays">): number {
  const days = context.maxBanDays;
  return Number.isFinite(days) && days > 0 ? Math.floor(days) * DAY_MS : 0;
}

export function presetsWithin(presets: DurationPreset[], max: number): DurationPreset[] {
  return presets.filter((preset) => preset.ms <= max);
}

/** Either one of the presets, by its length, or a custom number and unit. Null until one is picked. */
export interface DurationDraft {
  choice: number | "custom" | null;
  amount: string;
  unit: DurationUnit;
}

/**
 * Nothing picked. Changing a running timeout opens like this, because any
 * preset would be a guess at a new end, and one click on it could cut a
 * two-day timeout to an hour.
 */
export function unchosenDuration(): DurationDraft {
  return { choice: null, amount: "", unit: "h" };
}

/**
 * The starting length: the preset that matches the value exactly, or the
 * value written out as a custom length. A default past the ceiling starts at
 * the ceiling, so the form never opens already invalid.
 */
export function initialDuration(presets: DurationPreset[], value: number, max: number): DurationDraft {
  const start = Number.isFinite(value) && value > 0 ? Math.min(value, max) : (presets[0]?.ms ?? Math.min(HOUR_MS, max));
  const preset = presets.find((entry) => entry.ms === start);
  const parts = splitMs(start);
  return { choice: preset ? preset.ms : "custom", amount: parts.amount, unit: parts.unit };
}

/** Milliseconds for the draft, or null while the custom number is missing or not a whole number. */
export function draftMs(draft: DurationDraft): number | null {
  if (draft.choice === null) return null;
  if (draft.choice !== "custom") return draft.choice;
  if (!/^\d+$/.test(draft.amount.trim())) return null;
  return Number(draft.amount.trim()) * UNIT_MS[draft.unit];
}

/** Why a length cannot be used, or null when it can. */
export function durationProblem(draft: DurationDraft, max: number, what: "timeout" | "ban"): string | null {
  if (draft.choice === null) return `Choose how long the new ${what} lasts.`;
  if (draft.choice === "custom" && draft.amount.trim() === "") {
    return `Enter how long the ${what} lasts.`;
  }
  const ms = draftMs(draft);
  if (ms === null) return "Use a whole number.";
  if (ms <= 0) return "The length has to be more than zero.";
  if (ms > max) {
    return what === "timeout" && max === DISCORD_TIMEOUT_MAX_MS
      ? "Discord allows a timeout of up to 28 days."
      : `This server allows a ${what} of up to ${describeMs(max)}.`;
  }
  return null;
}

/** When a length starting now runs out, as an ISO string for the date helpers. */
export function endsAt(ms: number, now: Date): string {
  return new Date(now.getTime() + ms).toISOString();
}

/* Message deletion ------------------------------------------------------------------ */

export const DELETE_DAY_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Don’t delete any" },
  { value: 1, label: "Previous 24 hours" },
  ...[2, 3, 4, 5, 6, 7].map((days) => ({ value: days, label: `Previous ${days} days` })),
];

export function clampDeleteDays(days: number): number {
  if (!Number.isFinite(days)) return 0;
  return Math.min(7, Math.max(0, Math.trunc(days)));
}

/* The request ---------------------------------------------------------------------------- */

export type BanLength = "permanent" | "temporary";

export interface ActionDraft {
  kind: ModActionKind;
  reason: string;
  duration: DurationDraft;
  banLength: BanLength;
  deleteDays: number;
  /** Messages from the member to keep with the action. */
  evidence?: EvidenceRef[];
}

export interface DraftErrors {
  reason?: string;
  duration?: string;
}

export type DraftCheck = { ok: true; request: ActionRequest } | { ok: false; errors: DraftErrors };

export function reasonProblem(reason: string, required: boolean): string | null {
  const text = reason.trim();
  if (required && text === "") return "Write a reason. This server asks for one on every action.";
  if (text.length > ACTION_REASON_LIMIT) return `Keep the reason to ${ACTION_REASON_LIMIT} characters.`;
  return null;
}

/** Whether this draft uses a length at all. */
export function usesDuration(draft: Pick<ActionDraft, "kind" | "banLength">): boolean {
  return draft.kind === "timeout" || (draft.kind === "ban" && draft.banLength === "temporary");
}

/**
 * Checks the draft against the server's settings and builds exactly what the
 * bot expects. Fields that do not apply to the action are sent as null rather
 * than left over from a choice the reader changed their mind about.
 */
export function buildRequest(draft: ActionDraft, context: ActionContextDto): DraftCheck {
  const errors: DraftErrors = {};
  const reason = reasonProblem(draft.reason, context.requireReason);
  if (reason) errors.reason = reason;

  let durationMs: number | null = null;
  if (usesDuration(draft)) {
    const max = draft.kind === "timeout" ? timeoutMax(context) : banMax(context);
    const problem = durationProblem(draft.duration, max, draft.kind === "timeout" ? "timeout" : "ban");
    if (problem) errors.duration = problem;
    else durationMs = draftMs(draft.duration);
  }

  if (errors.reason || errors.duration) return { ok: false, errors };
  const text = draft.reason.trim();
  return {
    ok: true,
    request: {
      action: draft.kind,
      reason: text === "" ? null : text,
      durationMs,
      deleteDays: draft.kind === "ban" ? clampDeleteDays(draft.deleteDays) : null,
      // Only an action that puts something on the record has anything to attach it to.
      ...(draft.evidence && draft.evidence.length > 0 && draft.kind !== "timeout-clear" && draft.kind !== "unban" ? { evidence: draft.evidence } : {}),
    },
  };
}

/* What will happen ------------------------------------------------------------------------- */

export interface ConsequenceInput {
  kind: ModActionKind;
  dmOnAction: boolean;
  banLength: BanLength;
  deleteDays: number;
  /** The formatted end of a timeout or temporary ban, when the length is valid. */
  until: string | null;
  /** For a change to a running timeout, when that one is due to end, formatted. */
  replacing?: string | null;
}

/**
 * The warning shown when a new timeout would end before the one running now,
 * which is easy to do by accident with a short preset. Null when it ends later
 * or the new end is not known yet.
 */
export function earlierEndWarning(currentUntil: string | null, newEnd: string | null, currentText: string): string | null {
  if (!currentUntil || !newEnd) return null;
  return Date.parse(newEnd) < Date.parse(currentUntil)
    ? `This ends the timeout sooner. It is set to run until ${currentText} now.`
    : null;
}

/**
 * The plain sentences shown above the confirm button. The direct message line
 * appears only when the server sends one, because the bot includes the reason
 * in it and the moderator should know the member will read it.
 */
export function consequences(input: ConsequenceInput): string[] {
  const lines: string[] = [];
  switch (input.kind) {
    case "warn":
      lines.push("A warning is added to their record.");
      break;
    case "timeout":
      if (input.replacing) lines.push(`The timeout running until ${input.replacing} is replaced by this one.`);
      lines.push(
        input.until
          ? `They cannot send messages, react or speak in voice until ${input.until}.`
          : "They cannot send messages, react or speak in voice until the timeout ends.",
      );
      break;
    case "timeout-clear":
      lines.push("They can send messages and speak again straight away.");
      break;
    case "kick":
      lines.push("They will be removed from the server and can rejoin with a new invite.");
      break;
    case "ban":
      if (input.banLength === "temporary") {
        lines.push(
          input.until
            ? `They will be removed from the server and cannot rejoin until ${input.until}, when the ban lifts on its own.`
            : "They will be removed from the server and cannot rejoin until the ban lifts on its own.",
        );
      } else {
        lines.push("They will be removed from the server and will not be able to rejoin until unbanned.");
      }
      {
        const days = clampDeleteDays(input.deleteDays);
        if (days > 0) {
          lines.push(`Their messages from the ${days === 1 ? "previous 24 hours" : `previous ${days} days`} will be deleted.`);
        }
      }
      break;
    case "unban":
      lines.push("They will be able to rejoin the server with a new invite.");
      break;
  }
  if (input.dmOnAction) lines.push("The member will get a direct message from the bot saying what happened, with the reason.");
  return lines;
}

/**
 * The context with the actions an operator switched off on the Commands page.
 * The field is optional on the wire, so an older bot that never sends it
 * leaves every action on.
 */
export type FormContext = ActionContextDto;

export const SWITCHED_OFF = "Switched off for this server on the Commands page.";

/* Keyboard -------------------------------------------------------------------------- */

export interface EnterKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  /** The focused element's tag, upper case as the DOM gives it. */
  tag: string;
  /** The input's type, for an INPUT. */
  type: string;
}

/**
 * What Enter does inside an action form. A browser submits a form when Enter
 * is pressed in a radio or a text box, which here would ban someone from the
 * first control the dialog focuses. Plain Enter is therefore stopped on every
 * input; Ctrl or Cmd with Enter confirms from anywhere, and the buttons keep
 * their own behaviour.
 */
export function enterKeyAction(event: EnterKey): "submit" | "block" | "default" {
  if (event.key !== "Enter") return "default";
  if (event.ctrlKey || event.metaKey) return "submit";
  if (event.tag === "INPUT" && event.type !== "submit" && event.type !== "button") return "block";
  return "default";
}

/** Kicks and bans remove someone from the server, so their dialog reads as a warning. */
export function isHeavy(kind: ModActionKind): boolean {
  return kind === "kick" || kind === "ban";
}

/* Reading replies ---------------------------------------------------------------------------- */

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * The context as the form uses it. A field the bot leaves out falls back to
 * the moderation module's own default, so a slightly older bot still opens a
 * usable form. Anything that is not an object at all is refused.
 */
export function readContext(raw: unknown): FormContext | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.moduleEnabled !== "boolean") return null;
  return {
    moduleEnabled: value.moduleEnabled,
    requireReason: value.requireReason === true,
    dmOnAction: value.dmOnAction === true,
    defaultTimeoutMs: finiteNumber(value.defaultTimeoutMs, 10 * MINUTE_MS),
    maxTimeoutMs: finiteNumber(value.maxTimeoutMs, DISCORD_TIMEOUT_MAX_MS),
    deleteMessageDays: clampDeleteDays(finiteNumber(value.deleteMessageDays, 0)),
    maxBanDays: finiteNumber(value.maxBanDays, 0),
    disabledActions: Array.isArray(value.disabledActions) ? value.disabledActions.filter(isModActionKind) : [],
    reasonPresets: readPresets(value.reasonPresets),
  };
}

/** The presets an older bot leaves out read as none, and a damaged entry is dropped rather than shown half-filled. */
export function readPresets(raw: unknown): ReasonPresetDto[] {
  if (!Array.isArray(raw)) return [];
  const presets: ReasonPresetDto[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const value = entry as Record<string, unknown>;
    const name = typeof value.name === "string" ? value.name.trim() : "";
    const reason = typeof value.reason === "string" ? value.reason : "";
    if (name === "" || reason.trim() === "") continue;
    const ms = value.durationMs;
    presets.push({ name, reason, durationMs: typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? ms : null });
  }
  return presets;
}

/* Reason presets ------------------------------------------------------------------------------ */

export interface PresetApplied {
  reason: string;
  /** The length to switch to, or null to leave the length as it is. */
  duration: DurationDraft | null;
  /** For a ban, set when the preset's length turns it into a temporary one. */
  banLength: BanLength | null;
  /** Set when the preset's length was longer than this server allows and was cut to the ceiling. */
  clampedTo: number | null;
}

/**
 * What picking a preset changes in the form. The reason is always replaced:
 * picking a preset is the moderator choosing that wording. A preset's length
 * applies to a timeout and to a ban, and only when the server allows a length
 * at all; one longer than the ceiling is cut to the ceiling rather than
 * ignored, and the form says so, because the preset clearly meant "long".
 */
export function applyPreset(
  preset: ReasonPresetDto,
  kind: ModActionKind,
  limits: { timeoutMax: number; banMax: number; presets: DurationPreset[] },
): PresetApplied {
  const reason = preset.reason.slice(0, ACTION_REASON_LIMIT);
  const result: PresetApplied = { reason, duration: null, banLength: null, clampedTo: null };
  const ms = preset.durationMs;
  if (ms === null || ms <= 0) return result;
  const ceiling = kind === "timeout" ? limits.timeoutMax : kind === "ban" ? limits.banMax : 0;
  if (ceiling <= 0) return result;
  const length = Math.min(ms, ceiling);
  const match = limits.presets.find((entry) => entry.ms === length);
  result.duration = match ? { choice: match.ms, ...splitMs(match.ms) } : { choice: "custom", ...splitMs(length) };
  if (kind === "ban") result.banLength = "temporary";
  if (length < ms) result.clampedTo = length;
  return result;
}

/** The line under a preset's name in the picker: its reason, cut short, and its length where this action uses one. */
export function presetDescription(preset: ReasonPresetDto, kind: ModActionKind, max = 80): string {
  const text = preset.reason.replace(/\s+/g, " ").trim();
  const short = text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
  const timed = (kind === "timeout" || kind === "ban") && preset.durationMs !== null;
  return timed ? `${short} (${describeMs(preset.durationMs!)})` : short;
}

/** The note under the preset picker when its length had to be cut. */
export function clampedPresetText(presetMs: number, clampedTo: number, what: "timeout" | "ban"): string {
  return `The preset asks for ${describeMs(presetMs)}, longer than this server allows for a ${what}, so the length is set to ${describeMs(clampedTo)}.`;
}

/** The case number and notes from a successful reply. A reply missing them still counts as done. */
export function readResult(raw: unknown): { caseNumber: number | null; notes: string[] } {
  if (raw === null || typeof raw !== "object") return { caseNumber: null, notes: [] };
  const value = raw as Partial<ActionResult> & Record<string, unknown>;
  const caseNumber =
    typeof value.caseNumber === "number" && Number.isFinite(value.caseNumber)
      ? value.caseNumber
      : typeof value.infraction?.caseNumber === "number"
        ? value.infraction.caseNumber
        : null;
  const notes = Array.isArray(value.notes)
    ? value.notes.filter((note): note is string => typeof note === "string" && note.trim() !== "").map((note) => note.trim())
    : [];
  return { caseNumber, notes };
}
