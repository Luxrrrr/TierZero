/**
 * Decisions the audit log has to make before writing anything, kept free of
 * discord.js so they can be unit tested without a gateway connection.
 */

export type AuditCategory =
  | "messageDelete"
  | "messageEdit"
  | "memberJoin"
  | "memberLeave"
  | "nicknameChange"
  | "roleChange"
  | "channelCreate"
  | "channelDelete"
  | "roleCreate"
  | "roleDelete"
  | "banAdd"
  | "banRemove";

export interface AuditSettings {
  logChannelId: string;
  ignoreChannels: string[];
  includeBots: boolean;
  categories: Record<AuditCategory, boolean>;
}

/**
 * True when a channel's events should never reach the log: either it is the
 * log channel itself, in which case writing to it would log its own log
 * messages forever, or the operator listed it to be ignored.
 */
export function shouldIgnoreChannel(
  channelId: string,
  settings: Pick<AuditSettings, "logChannelId" | "ignoreChannels">,
): boolean {
  return channelId === settings.logChannelId || settings.ignoreChannels.includes(channelId);
}

export function shouldLogAuthor(isBot: boolean, includeBots: boolean): boolean {
  return includeBots || !isBot;
}

export function categoryEnabled(settings: Pick<AuditSettings, "categories">, category: AuditCategory): boolean {
  return settings.categories[category];
}

/**
 * Whether an edit is worth logging. A null side means the message arrived
 * partial and its prior content is unknown, so a real edit cannot be ruled
 * out and is logged rather than silently dropped. Two known, equal contents
 * mean nothing actually changed - Discord fires an update for an embed
 * loading in, for instance - and that case is suppressed.
 */
export function contentChanged(before: string | null, after: string | null): boolean {
  if (before === null) return true;
  return before !== after;
}

interface MessageEventInput {
  channelId: string;
  authorIsBot: boolean;
}

/** The channel, author and category checks any message-based event needs. */
export function shouldLogMessageEvent(
  category: "messageDelete" | "messageEdit",
  settings: AuditSettings,
  message: MessageEventInput,
): boolean {
  if (!categoryEnabled(settings, category)) return false;
  if (shouldIgnoreChannel(message.channelId, settings)) return false;
  return shouldLogAuthor(message.authorIsBot, settings.includeBots);
}

interface MessageEditInput extends MessageEventInput {
  contentBefore: string | null;
  contentAfter: string | null;
}

/** As shouldLogMessageEvent, plus the check that the content actually changed. */
export function shouldLogMessageEdit(settings: AuditSettings, message: MessageEditInput): boolean {
  if (!contentChanged(message.contentBefore, message.contentAfter)) return false;
  return shouldLogMessageEvent("messageEdit", settings, message);
}
