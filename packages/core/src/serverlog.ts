import type { UserRef } from "./mod.js";

/**
 * Everything the server log can record, in the order the dashboard lists it.
 * The bot writes entries with these ids and the dashboard builds its filters
 * and labels from the same list, so a new kind of event is one line here.
 */

export interface ServerLogType {
  id: string;
  label: string;
}

export interface ServerLogCategory {
  id: string;
  label: string;
  /** One line for the settings page and the filter, saying what is in it. */
  description: string;
  types: ServerLogType[];
}

export const SERVER_LOG_CATEGORIES = [
  {
    id: "members",
    label: "Members",
    description: "Joins, departures, nicknames and role changes.",
    types: [
      { id: "member.join", label: "Joined" },
      { id: "member.leave", label: "Left" },
      { id: "member.nickname", label: "Nickname changed" },
      { id: "member.roles", label: "Roles changed" },
    ],
  },
  {
    id: "messages",
    label: "Messages",
    description: "Edited and deleted messages, with what they said.",
    types: [
      { id: "message.edit", label: "Message edited" },
      { id: "message.delete", label: "Message deleted" },
      { id: "message.purge", label: "Messages purged" },
    ],
  },
  {
    id: "moderation",
    label: "Moderation",
    description: "Bans, unbans, kicks and timeouts, whoever did them.",
    types: [
      { id: "member.ban", label: "Banned" },
      { id: "member.unban", label: "Unbanned" },
      { id: "member.kick", label: "Kicked" },
      { id: "member.timeout", label: "Timed out" },
      { id: "member.timeout.end", label: "Timeout removed" },
    ],
  },
  {
    id: "roles",
    label: "Roles",
    description: "Roles created, changed and deleted.",
    types: [
      { id: "role.create", label: "Role created" },
      { id: "role.update", label: "Role changed" },
      { id: "role.delete", label: "Role deleted" },
    ],
  },
  {
    id: "channels",
    label: "Channels",
    description: "Channels and threads created, changed and deleted.",
    types: [
      { id: "channel.create", label: "Channel created" },
      { id: "channel.update", label: "Channel changed" },
      { id: "channel.delete", label: "Channel deleted" },
      { id: "thread.create", label: "Thread created" },
      { id: "thread.delete", label: "Thread deleted" },
    ],
  },
  {
    id: "voice",
    label: "Voice",
    description: "Joining, leaving and moving between voice channels.",
    types: [
      { id: "voice.join", label: "Joined voice" },
      { id: "voice.leave", label: "Left voice" },
      { id: "voice.move", label: "Moved voice channel" },
      { id: "voice.moderate", label: "Server muted or deafened" },
    ],
  },
  {
    id: "server",
    label: "Server",
    description: "Server settings, invites and emojis.",
    types: [
      { id: "server.update", label: "Server settings changed" },
      { id: "invite.create", label: "Invite created" },
      { id: "invite.delete", label: "Invite deleted" },
      { id: "emoji.create", label: "Emoji added" },
      { id: "emoji.update", label: "Emoji renamed" },
      { id: "emoji.delete", label: "Emoji removed" },
    ],
  },
] as const satisfies readonly ServerLogCategory[];

export type ServerLogCategoryId = (typeof SERVER_LOG_CATEGORIES)[number]["id"];

export const SERVER_LOG_CATEGORY_IDS = SERVER_LOG_CATEGORIES.map((c) => c.id) as ServerLogCategoryId[];

const TYPE_LABEL = new Map<string, string>(SERVER_LOG_CATEGORIES.flatMap((c) => c.types.map((t) => [t.id, t.label] as const)));
const TYPE_CATEGORY = new Map<string, ServerLogCategoryId>(
  SERVER_LOG_CATEGORIES.flatMap((c) => c.types.map((t) => [t.id, c.id] as const)),
);

export const isServerLogCategory = (value: string): value is ServerLogCategoryId => SERVER_LOG_CATEGORY_IDS.includes(value as ServerLogCategoryId);
export const serverLogTypeLabel = (type: string): string => TYPE_LABEL.get(type) ?? type;
export const serverLogCategoryOf = (type: string): ServerLogCategoryId | null => TYPE_CATEGORY.get(type) ?? null;
export const isServerLogType = (value: string): boolean => TYPE_LABEL.has(value);

/** One thing that changed in an event, such as a nickname or a channel's name. */
export interface ServerLogChange {
  label: string;
  before: string | null;
  after: string | null;
}

/** What an entry holds beyond its summary. Stored as JSON, so it stays readable as the shape grows. */
export interface ServerLogDetails {
  changes?: ServerLogChange[];
  /** Free lines for what has no before and after, such as an invite's code or a purge's size. */
  notes?: string[];
  /** The message an entry is about, so the Messages view can open it. */
  messageId?: string;
}

export interface ServerLogEntryDto {
  id: number;
  at: string;
  type: string;
  category: ServerLogCategoryId;
  label: string;
  summary: string;
  /** Who did it, when Discord says. Null when the bot cannot tell. */
  actor: UserRef | null;
  /** Who or what it happened to, for an event about a member. */
  target: UserRef | null;
  channel: { id: string; name: string } | null;
  details: ServerLogDetails;
}

/** Parses stored details, treating anything damaged as nothing rather than failing a whole list. */
export function readServerLogDetails(stored: string | null | undefined): ServerLogDetails {
  if (!stored) return {};
  try {
    const parsed: unknown = JSON.parse(stored);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as ServerLogDetails) : {};
  } catch {
    return {};
  }
}
