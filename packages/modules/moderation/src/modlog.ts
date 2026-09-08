/**
 * Formatting for the mod log post and the direct message sent to a member.
 * Kept free of discord.js so the exact wording is testable without building
 * an embed, and reads back straight from the database: fields are built from
 * mentions rather than cached usernames, so a case pulled up months later
 * never needs an extra API call to render.
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

/** Falls back to the raw value for a row written by some future action kind. */
export function actionLabel(action: string): string {
  return isModerationAction(action) ? ACTION_LABEL[action] : action;
}

export interface ActionNotice {
  action: string;
  reason: string | null;
  expiresAt: Date | null;
}

export interface ModLogEntry extends ActionNotice {
  caseNumber: number;
  targetId: string;
  moderatorId: string;
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

export function formatModLogEntry(entry: ModLogEntry): ModLogView {
  const fields: EmbedField[] = [
    { name: "Member", value: `<@${entry.targetId}> (${entry.targetId})`, inline: true },
    { name: "Moderator", value: `<@${entry.moderatorId}> (${entry.moderatorId})`, inline: true },
    { name: "Reason", value: entry.reason ?? "No reason given" },
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

export function formatDirectMessage(guildName: string, notice: ActionNotice): string {
  const label = actionLabel(notice.action).toLowerCase();
  const reason = notice.reason ? ` Reason: ${notice.reason}` : "";
  const expiry = notice.expiresAt
    ? ` This expires <t:${Math.floor(notice.expiresAt.getTime() / 1000)}:R>.`
    : "";
  return `You were ${label} in ${guildName}.${reason}${expiry}`;
}
