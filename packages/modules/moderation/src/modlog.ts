import { dashboardLinks } from "@tier0/core";
import { DEFAULT_WORDING, fillLabel, type Wording } from "./texts.js";

/**
 * What the mod log post, the direct message and the case replies say, as plain
 * values. Kept free of discord.js so the exact wording is testable without
 * building an embed, and reads back straight from the database: members are
 * mentions, not cached usernames, so a case pulled up months later never
 * needs an extra API call to render.
 */

export type ModerationAction = "warn" | "timeout" | "timeout-clear" | "kick" | "ban" | "unban";

const ACTION_WORD: Record<ModerationAction, keyof Wording["actions"]> = {
  warn: "warned",
  timeout: "timedOut",
  "timeout-clear": "timeoutCleared",
  kick: "kicked",
  ban: "banned",
  unban: "unbanned",
};

function isModerationAction(value: string): value is ModerationAction {
  return Object.hasOwn(ACTION_WORD, value);
}

/**
 * What automod writes: the same names the dashboard shows (see
 * automodActionLabel in apps/web/components/mod/automod.ts), which has to
 * be kept in step by hand because the two sides share no code.
 */
const AUTOMOD_WORD: Record<string, keyof Wording["actions"]> = {
  "automod-warn": "automodWarn",
  "automod-timeout": "automodTimeout",
  "automod-delete": "automodDelete",
};

const AUTOMOD_PREFIX = "automod-";

export function isAutomodAction(action: string): boolean {
  return action.startsWith(AUTOMOD_PREFIX);
}

/** Falls back to a tidied form for an automod kind this version does not know, and the raw value for any other. */
export function actionLabel(action: string, wording: Wording = DEFAULT_WORDING): string {
  if (isModerationAction(action)) return wording.actions[ACTION_WORD[action]];
  const automod = AUTOMOD_WORD[action];
  if (automod) return wording.actions[automod];
  if (isAutomodAction(action)) {
    const kind = action.slice(AUTOMOD_PREFIX.length).replace(/[-_]+/g, " ").trim();
    return kind === "" ? wording.actions.automod : fillLabel(wording.actions.automodOther, { kind });
  }
  return action;
}

/** How a case names its moderator: automod's rows are written under the bot's own id, which is no use to read. */
export function moderatorName(action: string, moderatorId: string, botId: string | null, wording: Wording = DEFAULT_WORDING): string | undefined {
  return isAutomodAction(action) && moderatorId === botId ? wording.actions.automod : undefined;
}

export interface ActionNotice {
  action: string;
  reason: string | null;
  expiresAt: Date | null;
  /** How long the timeout or ban lasts, when the caller knows it exactly. */
  durationMs?: number | null;
  /** The moderator, for a message that offers `{moderator}`. */
  moderatorId?: string;
  /** Shown in place of a mention of the moderator, such as "Automod". */
  moderatorName?: string;
}

export interface ModLogEntry extends ActionNotice {
  caseNumber: number;
  targetId: string;
  moderatorId: string;
  /** When the case was made. Defaults to now. */
  createdAt?: Date;
}

/** Cuts text to `max` characters, ending in an ellipsis when it had to. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

const UNITS: readonly [keyof Wording["time"], keyof Wording["time"], number][] = [
  ["dayOne", "dayMany", 86_400_000],
  ["hourOne", "hourMany", 3_600_000],
  ["minuteOne", "minuteMany", 60_000],
  ["secondOne", "secondMany", 1_000],
];

/** "10 minutes", "2 hours": the largest unit that divides the length exactly. */
export function describeLength(ms: number, time: Wording["time"] = DEFAULT_WORDING.time): string {
  const whole = Math.max(1000, Math.round(ms / 1000) * 1000);
  for (const [one, many, size] of UNITS) {
    if (whole % size === 0) {
      const n = whole / size;
      return fillLabel(n === 1 ? time[one] : time[many], { n });
    }
  }
  return fillLabel(time.secondOne, { n: 1 });
}

/**
 * A stored case keeps its expiry but not the length it was given, and the case
 * is made a moment after the expiry was worked out. Lengths over a minute are
 * therefore rounded to the minute so they read as they were typed.
 */
export function lengthBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return ms >= 90_000 ? Math.round(ms / 60_000) * 60_000 : ms;
}

type NoticeSource = ActionNotice &
  Partial<Pick<ModLogEntry, "caseNumber" | "targetId" | "createdAt">> & {
    /**
     * Where the case lives in the dashboard. Passed only for the posts staff read, so the member's
     * direct message never carries a link to a page they cannot open. `caseUrl` and `memberUrl` are
     * set, to an empty string when the address is not known, whenever `guildId` is given.
     */
    links?: { guildId: string; dashboardBase: string };
  };

/**
 * The variables the mod log post, the direct message and the case replies
 * share. Parts a caller does not have are left out, not blanked, so a message
 * that asks for one shows it as typed instead of silently empty.
 */
export function noticeValues(notice: NoticeSource, wording: Wording = DEFAULT_WORDING): Record<string, string | number> {
  const label = actionLabel(notice.action, wording);
  const created = notice.createdAt ?? new Date();
  const values: Record<string, string | number> = {
    action: label.toLowerCase(),
    actionTitle: label,
    reason: notice.reason ?? wording.actions.noReason,
    reasonNote: notice.reason ? ` ${fillLabel(wording.notes.reasonNote, { reason: notice.reason })}` : "",
    expires: "",
    expiresRelative: "",
    expiryNote: "",
    duration: "",
    created: created.toISOString(),
  };
  if (notice.expiresAt) {
    const seconds = Math.floor(notice.expiresAt.getTime() / 1000);
    values.expires = `<t:${seconds}:f> (<t:${seconds}:R>)`;
    values.expiresRelative = `<t:${seconds}:R>`;
    values.expiryNote = ` ${fillLabel(wording.notes.expiryNote, { when: `<t:${seconds}:R>` })}`;
    values.duration = describeLength(notice.durationMs ?? lengthBetween(created, notice.expiresAt), wording.time);
  }
  if (notice.caseNumber !== undefined) values.case = notice.caseNumber;
  if (notice.targetId) {
    values.member = `<@${notice.targetId}>`;
    values.memberId = notice.targetId;
  }
  if (notice.moderatorId) {
    values.moderator = notice.moderatorName ?? `<@${notice.moderatorId}>`;
    values.moderatorId = notice.moderatorId;
    values.moderatorLine = notice.moderatorName ?? `<@${notice.moderatorId}> (${notice.moderatorId})`;
  }
  if (notice.links && notice.targetId) {
    const { caseUrl, memberUrl } = dashboardLinks(notice.links.dashboardBase, notice.links.guildId, notice.targetId, notice.caseNumber);
    values.caseUrl = caseUrl;
    values.memberUrl = memberUrl;
  }
  return values;
}
