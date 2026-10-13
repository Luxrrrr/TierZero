import { emptyEmbed, s, type Infer, type MessageBody, type MessageEmbed, type MessageVariable, type ReplyValues } from "@tier0/core";
import type { MemberDiff } from "./diff.js";

const FIELD_LIMIT = 1024;

const COLOR_REMOVE = "#ed4245";
const COLOR_EDIT = "#faa61a";
const COLOR_ADD = "#57f287";
const COLOR_NEUTRAL = "#5865f2";

export const truncate = (text: string, max = FIELD_LIMIT): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const field = (name: string, value: string, inline = false) => ({ name, value, inline });

function post(title: string, color: string, fields: MessageEmbed["fields"], extra: Partial<MessageEmbed> = {}): MessageBody {
  return {
    content: "",
    embeds: [{ ...emptyEmbed(), title, color, timestamp: "now", fields, ...extra }],
    buttons: [],
    selects: [],
    reactions: [],
  };
}

export type AuditEvent =
  | "messageDelete"
  | "messageEdit"
  | "memberJoin"
  | "memberLeave"
  | "memberUpdate"
  | "channelCreate"
  | "channelDelete"
  | "roleCreate"
  | "roleDelete"
  | "banAdd"
  | "banRemove";

/** What each log entry looks like until the owner writes something else. */
export const STARTING: Record<AuditEvent, MessageBody> = {
  messageDelete: post("Message deleted", COLOR_REMOVE, [
    field("Author", "{author}", true),
    field("Channel", "{message.channel}", true),
    field("Content", "{content}"),
  ]),
  messageEdit: post(
    "Message edited",
    COLOR_EDIT,
    [
      field("Author", "{author}", true),
      field("Channel", "{message.channel}", true),
      field("Before", "{before}"),
      field("After", "{after}"),
    ],
    { url: "{message.link}" },
  ),
  memberJoin: post("Member joined", COLOR_ADD, [field("Member", "{member}", true), field("Account created", "{member.created}", true)]),
  memberLeave: post("Member left", COLOR_REMOVE, [field("Member", "{member}")]),
  memberUpdate: post("Member updated", COLOR_NEUTRAL, [
    field("Member", "{member}"),
    field("Nickname before", "{nickname.before}", true),
    field("Nickname after", "{nickname.after}", true),
    field("Roles added", "{roles.added}"),
    field("Roles removed", "{roles.removed}"),
  ]),
  channelCreate: post("Channel created", COLOR_ADD, [field("Channel", "{new.channel}")]),
  channelDelete: post("Channel deleted", COLOR_REMOVE, [field("Channel", "{old.channel}")]),
  roleCreate: post("Role created", COLOR_ADD, [field("Role", "{new.role}")]),
  roleDelete: post("Role deleted", COLOR_REMOVE, [field("Role", "{old.role}")]),
  banAdd: post("Member banned", COLOR_REMOVE, [field("Member", "{member}"), field("Reason", "{reason}")]),
  banRemove: post("Member unbanned", COLOR_ADD, [field("Member", "{member}")]),
};

/** The stand-ins used when something is not known. The defaults are the words the log has always used. */
export const DEFAULT_LABELS = {
  authorUnknown: "Unknown (not cached)",
  deletedContent: "Unavailable (message was not cached)",
  editBefore: "Unavailable (not cached)",
  editAfter: "Unavailable",
  noNickname: "(none)",
} as const;

export const labelsGroup = s.object(
  {
    authorUnknown: s.string({
      label: "Author the bot never saw",
      help: "Fills {author} when the message was sent before the bot started watching.",
      default: DEFAULT_LABELS.authorUnknown,
      max: 200,
    }),
    deletedContent: s.string({
      label: "Deleted message the bot never saw",
      help: "Fills {content} on a deleted message the bot could not read.",
      default: DEFAULT_LABELS.deletedContent,
      max: 200,
    }),
    editBefore: s.string({
      label: "Text before an edit the bot never saw",
      help: "Fills {before} on an edited message the bot had not seen the original of.",
      default: DEFAULT_LABELS.editBefore,
      max: 200,
    }),
    editAfter: s.string({
      label: "Text after an edit that cannot be read",
      help: "Fills {after} when the edited message has no readable text.",
      default: DEFAULT_LABELS.editAfter,
      max: 200,
    }),
    noNickname: s.string({
      label: "Member with no nickname",
      help: "Fills {nickname.before} and {nickname.after} when a member had no nickname, or removed theirs.",
      default: DEFAULT_LABELS.noNickname,
      max: 200,
    }),
  },
  {
    label: "Labels and text",
    help: "The stand-ins written into an entry when the bot does not know something.",
    collapsible: true,
  },
);

export type AuditLabels = Infer<typeof labelsGroup>;

const MEMBER: MessageVariable = { name: "member", description: "The member, as a mention followed by their username", sample: "@Ada (ada)" };
const AUTHOR: MessageVariable = {
  name: "author",
  description: "Who wrote the message, as a mention followed by their username. A stand-in from Labels and text when the bot never saw it",
  sample: "@Ada (ada)",
};
const MESSAGE_CHANNEL: MessageVariable = { name: "message.channel", description: "The channel the message was in, as a link", sample: "#general" };

/** The label and variables the settings page offers for each entry. */
export const ENTRIES: Record<AuditEvent, { label: string; help: string; variables: MessageVariable[] }> = {
  messageDelete: {
    label: "Message deleted",
    help: "Posted when a message is deleted. Needs the message deletions switch above.",
    variables: [
      AUTHOR,
      MESSAGE_CHANNEL,
      {
        name: "content",
        description: "What the message said, cut to 1024 characters. A stand-in from Labels and text when the bot never saw it",
        sample: "Anyone up for a game tonight?",
      },
    ],
  },
  messageEdit: {
    label: "Message edited",
    help: "Posted when a message's text is changed. Needs the message edits switch above.",
    variables: [
      AUTHOR,
      MESSAGE_CHANNEL,
      {
        name: "before",
        description: "The text before the edit, cut to 1024 characters. A stand-in from Labels and text when the bot never saw it",
        sample: "Anyone up for a game tonight?",
      },
      { name: "after", description: "The text after the edit, cut to 1024 characters", sample: "Anyone up for a game tomorrow?" },
      { name: "message.link", description: "The address of the message, empty when it is not known", sample: "https://discord.com/channels/1/2/3" },
    ],
  },
  memberJoin: {
    label: "Member joined",
    help: "Posted when someone joins. Needs the joins switch above.",
    variables: [MEMBER, { name: "member.created", description: "When their account was created, shown as how long ago", sample: "<t:1700000000:R>" }],
  },
  memberLeave: {
    label: "Member left",
    help: "Posted when someone leaves or is removed. Needs the departures switch above.",
    variables: [MEMBER],
  },
  memberUpdate: {
    label: "Member updated",
    help: "Posted when a member's nickname or roles change. One entry covers both. A line with nothing to show is left out, so it only appears for what changed and is switched on above.",
    variables: [
      MEMBER,
      { name: "nickname.before", description: "Their nickname before, or a stand-in from Labels and text. Empty unless the nickname changed", sample: "Ada" },
      { name: "nickname.after", description: "Their nickname now, or a stand-in from Labels and text. Empty unless the nickname changed", sample: "Ada L." },
      { name: "roles.added", description: "The roles they gained, as mentions. Empty when none were added", sample: "@Member" },
      { name: "roles.removed", description: "The roles they lost, as mentions. Empty when none were removed", sample: "@Guest" },
    ],
  },
  channelCreate: {
    label: "Channel created",
    help: "Posted when a channel is created. Needs the channel creation switch above.",
    variables: [{ name: "new.channel", description: "The new channel, as a link followed by its name", sample: "#events (events)" }],
  },
  channelDelete: {
    label: "Channel deleted",
    help: "Posted when a channel is deleted. Needs the channel deletion switch above.",
    variables: [{ name: "old.channel", description: "The channel that was deleted, with a # before its name", sample: "#events" }],
  },
  roleCreate: {
    label: "Role created",
    help: "Posted when a role is created. Needs the role creation switch above.",
    variables: [{ name: "new.role", description: "The new role, as a mention followed by its name", sample: "@Member (Member)" }],
  },
  roleDelete: {
    label: "Role deleted",
    help: "Posted when a role is deleted. Needs the role deletion switch above.",
    variables: [{ name: "old.role", description: "The name of the role that was deleted", sample: "Guest" }],
  },
  banAdd: {
    label: "Member banned",
    help: "Posted when someone is banned. Needs the bans switch above.",
    variables: [MEMBER, { name: "reason", description: "The reason given for the ban, cut to 1024 characters. Empty when there is none", sample: "Spam" }],
  },
  banRemove: {
    label: "Member unbanned",
    help: "Posted when a ban is lifted. Needs the unbans switch above.",
    variables: [MEMBER],
  },
};

interface Tagged {
  id: string;
  tag: string;
}

const person = (user: Tagged): string => `<@${user.id}> (${user.tag})`;

interface MessageLike {
  author?: Tagged | null;
  channelId: string;
  content?: string | null;
}

const authorOf = (message: MessageLike, labels: AuditLabels): string =>
  message.author ? person(message.author) : labels.authorUnknown;

export function deleteValues(message: MessageLike, labels: AuditLabels = DEFAULT_LABELS): ReplyValues {
  return {
    author: authorOf(message, labels),
    "message.channel": `<#${message.channelId}>`,
    content: message.content ? truncate(message.content) : labels.deletedContent,
  };
}

export function editValues(
  message: MessageLike,
  contentBefore: string | null,
  contentAfter: string | null,
  link: string | null,
  labels: AuditLabels = DEFAULT_LABELS,
): ReplyValues {
  return {
    author: authorOf(message, labels),
    "message.channel": `<#${message.channelId}>`,
    before: contentBefore ? truncate(contentBefore) : labels.editBefore,
    after: contentAfter ? truncate(contentAfter) : labels.editAfter,
    "message.link": link ?? "",
  };
}

export const memberValues = (user: Tagged): ReplyValues => ({ member: person(user) });

export const joinValues = (user: Tagged & { createdTimestamp: number }): ReplyValues => ({
  member: person(user),
  "member.created": `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
});

export function updateValues(
  user: Tagged,
  diff: MemberDiff,
  show: { nickname: boolean; roles: boolean },
  labels: AuditLabels = DEFAULT_LABELS,
): ReplyValues {
  const mentions = (ids: string[]) => truncate(ids.map((id) => `<@&${id}>`).join(", "));
  return {
    member: person(user),
    "nickname.before": show.nickname ? (diff.nicknameBefore ?? labels.noNickname) : "",
    "nickname.after": show.nickname ? (diff.nicknameAfter ?? labels.noNickname) : "",
    "roles.added": show.roles ? mentions(diff.rolesAdded) : "",
    "roles.removed": show.roles ? mentions(diff.rolesRemoved) : "",
  };
}

export const channelCreateValues = (channel: { id: string; name: string }): ReplyValues => ({ "new.channel": `<#${channel.id}> (${channel.name})` });
export const channelDeleteValues = (channel: { name: string }): ReplyValues => ({ "old.channel": `#${channel.name}` });
export const roleCreateValues = (role: { id: string; name: string }): ReplyValues => ({ "new.role": `<@&${role.id}> (${role.name})` });
export const roleDeleteValues = (role: { name: string }): ReplyValues => ({ "old.role": role.name });

export const banValues = (user: Tagged, reason: string | null | undefined): ReplyValues => ({
  member: person(user),
  reason: reason ? truncate(reason) : "",
});
