import type { AuditEvent } from "./messages.js";

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
  | "banRemove"
  | "timeoutAdd"
  | "timeoutRemove"
  | "kick"
  | "voiceJoin"
  | "voiceLeave"
  | "voiceMove"
  | "inviteCreate"
  | "inviteDelete"
  | "threadCreate"
  | "threadDelete"
  | "threadArchive"
  | "emojiChange"
  | "stickerChange"
  | "serverUpdate";

export interface AuditSettings {
  logChannelId: string;
  /** The channels kinds of entry are sent to instead of the log channel. */
  otherLogChannels?: string[];
  ignoreChannels: string[];
  includeBots: boolean;
  categories: Record<AuditCategory, boolean>;
}

/** The kinds of entry an owner can send to a channel of their own. */
export type AuditGroup = "messages" | "members" | "server" | "bans" | "voice" | "invites" | "threads" | "emojis" | "settings";

const GROUP_OF: Record<AuditCategory | AuditEvent, AuditGroup> = {
  messageDelete: "messages",
  messageEdit: "messages",
  memberJoin: "members",
  memberLeave: "members",
  memberUpdate: "members",
  nicknameChange: "members",
  roleChange: "members",
  channelCreate: "server",
  channelDelete: "server",
  roleCreate: "server",
  roleDelete: "server",
  banAdd: "bans",
  banRemove: "bans",
  timeoutAdd: "bans",
  timeoutRemove: "bans",
  kick: "bans",
  memberTimeout: "bans",
  memberTimeoutEnd: "bans",
  memberKick: "bans",
  voiceJoin: "voice",
  voiceLeave: "voice",
  voiceMove: "voice",
  inviteCreate: "invites",
  inviteDelete: "invites",
  threadCreate: "threads",
  threadDelete: "threads",
  threadArchive: "threads",
  emojiChange: "emojis",
  emojiCreate: "emojis",
  emojiUpdate: "emojis",
  emojiDelete: "emojis",
  stickerChange: "emojis",
  stickerCreate: "emojis",
  stickerUpdate: "emojis",
  stickerDelete: "emojis",
  serverUpdate: "settings",
};

/**
 * Where an entry goes: the channel set for its kind, or else the log channel.
 * Empty when neither is set, which leaves the entry unposted.
 */
export function channelFor(event: AuditCategory | AuditEvent, main: string | undefined, routes: Partial<Record<AuditGroup, string>>): string {
  return routes[GROUP_OF[event]] || main || "";
}

/**
 * True when a channel's events should never reach the log: either it is a
 * channel the log writes to, in which case writing to it would log its own log
 * messages forever, or the operator listed it to be ignored. A thread counts as
 * the channel it is in, so ignoring a channel ignores its threads too.
 */
export function shouldIgnoreChannel(
  channelId: string,
  settings: Pick<AuditSettings, "logChannelId" | "ignoreChannels" | "otherLogChannels">,
  parentId?: string | null,
): boolean {
  const logs = [settings.logChannelId, ...(settings.otherLogChannels ?? [])].filter(Boolean);
  return [channelId, parentId].some((id) => !!id && (logs.includes(id) || settings.ignoreChannels.includes(id)));
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
 * out. It gets logged instead of silently dropped. Two known, equal contents
 * mean nothing actually changed - Discord fires an update for an embed
 * loading in, for instance - and that case is suppressed.
 */
export function contentChanged(before: string | null, after: string | null): boolean {
  if (before === null) return true;
  return before !== after;
}

interface MessageEventInput {
  channelId: string;
  /** The channel a thread is in, when the message is in a thread. */
  parentId?: string | null;
  authorIsBot: boolean;
}

/** The channel, author and category checks any message-based event needs. */
export function shouldLogMessageEvent(
  category: "messageDelete" | "messageEdit",
  settings: AuditSettings,
  message: MessageEventInput,
): boolean {
  if (!categoryEnabled(settings, category)) return false;
  if (shouldIgnoreChannel(message.channelId, settings, message.parentId)) return false;
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
