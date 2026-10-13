import { dashboardLinks } from "@tier0/core";

/**
 * What the mod log post, the direct message and the case replies say, as plain
 * values. Kept free of discord.js so the exact wording is testable without
 * building an embed, and reads back straight from the database: members are
 * mentions, not cached usernames, so a case pulled up months later never
 * needs an extra API call to render.
 */

export type ModerationAction = "warn" | "timeout" | "timeout-clear" | "kick" | "ban" | "unban";

const ACTION_LABEL: Record<ModerationAction, string> = {
  warn: "Warned",
  timeout: "Timed out",
  "timeout-clear": "Timeout cleared",
  kick: "Kicked",
  ban: "Banned",
  unban: "Unbanned",
};

const KNOWN_ACTIONS = new Set(Object.keys(ACTION_LABEL));

function isModerationAction(value: string): value is ModerationAction {
  return KNOWN_ACTIONS.has(value);
}

/**
 * What automod writes: the same names the dashboard shows (see
 * automodActionLabel in apps/web/components/mod/automod.ts), which has to
 * be kept in step by hand because the two sides share no code.
 */
const AUTOMOD_LABEL: Record<string, string> = {
  "automod-warn": "Automod warn",
  "automod-timeout": "Automod timeout",
  "automod-delete": "Automod message delete",
};

const AUTOMOD_PREFIX = "automod-";

export function isAutomodAction(action: string): boolean {
  return action.startsWith(AUTOMOD_PREFIX);
}

/** Falls back to a tidied form for an automod kind this version does not know, and the raw value for any other. */
export function actionLabel(action: string): string {
  if (isModerationAction(action)) return ACTION_LABEL[action];
  const automod = AUTOMOD_LABEL[action];
  if (automod) return automod;
  if (isAutomodAction(action)) {
    const kind = action.slice(AUTOMOD_PREFIX.length).replace(/[-_]+/g, " ").trim();
    return kind === "" ? "Automod" : `Automod ${kind}`;
  }
  return action;
}

/** How a case names its moderator: automod's rows are written under the bot's own id, which is no use to read. */
export function moderatorName(action: string, moderatorId: string, botId: string | null): string | undefined {
  return isAutomodAction(action) && moderatorId === botId ? "Automod" : undefined;
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

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface ModLogView {
  title: string;
  fields: EmbedField[];
}

/** Discord's limit on an embed field's value. */
const FIELD_MAX = 1024;

/** Cuts text to `max` characters, ending in an ellipsis when it had to. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

/** The default look of a case, kept in code so /case still has it when no reply is customised. */
export function formatModLogEntry(entry: ModLogEntry): ModLogView {
  const fields: EmbedField[] = [
    { name: "Member", value: `<@${entry.targetId}> (${entry.targetId})`, inline: true },
    {
      name: "Moderator",
      value: entry.moderatorName ?? `<@${entry.moderatorId}> (${entry.moderatorId})`,
      inline: true,
    },
    { name: "Reason", value: clip(entry.reason ?? "No reason given", FIELD_MAX) },
  ];
  if (entry.expiresAt) {
    const seconds = Math.floor(entry.expiresAt.getTime() / 1000);
    fields.push({ name: "Expires", value: `<t:${seconds}:f> (<t:${seconds}:R>)` });
  }
  return {
    title: `Case #${entry.caseNumber} - ${actionLabel(entry.action)}`,
    fields,
  };
}

const UNITS: readonly [string, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1_000],
];

/** "10 minutes", "2 hours": the largest unit that divides the length exactly. */
export function describeLength(ms: number): string {
  const whole = Math.max(1000, Math.round(ms / 1000) * 1000);
  for (const [name, size] of UNITS) {
    if (whole % size === 0) {
      const n = whole / size;
      return `${n} ${name}${n === 1 ? "" : "s"}`;
    }
  }
  return "1 second";
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
export function noticeValues(notice: NoticeSource): Record<string, string | number> {
  const label = actionLabel(notice.action);
  const created = notice.createdAt ?? new Date();
  const values: Record<string, string | number> = {
    action: label.toLowerCase(),
    actionTitle: label,
    reason: notice.reason ?? "No reason given",
    reasonNote: notice.reason ? ` Reason: ${notice.reason}` : "",
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
    values.expiryNote = ` This expires <t:${seconds}:R>.`;
    values.duration = describeLength(notice.durationMs ?? lengthBetween(created, notice.expiresAt));
  }
  if (notice.caseNumber !== undefined) values.case = notice.caseNumber;
  if (notice.targetId) {
    values.member = `<@${notice.targetId}>`;
    values.memberId = notice.targetId;
  }
  if (notice.moderatorId) {
    values.moderator = notice.moderatorName ?? `<@${notice.moderatorId}>`;
    values.moderatorId = notice.moderatorId;
  }
  if (notice.links && notice.targetId) {
    const { caseUrl, memberUrl } = dashboardLinks(notice.links.dashboardBase, notice.links.guildId, notice.targetId, notice.caseNumber);
    values.caseUrl = caseUrl;
    values.memberUrl = memberUrl;
  }
  return values;
}
