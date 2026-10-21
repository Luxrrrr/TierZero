import { embedReply, type MessageBody, type MessageVariable } from "@tier0/core";

/**
 * What the bot says on its own account, in the wording it has always used.
 * These are the settings' defaults and also what is sent when an owner's version
 * no longer fits Discord's limits once its variables are filled in.
 */
export const SYSTEM_MESSAGE_KEYS = [
  "featureOff",
  "commandOff",
  "channelOff",
  "noRole",
  "commandFailed",
  "roleGone",
  "roleTooHigh",
  "memberNotFound",
  "roleChangeFailed",
  "roleGiven",
  "roleTaken",
  "notActive",
  "componentFailed",
  "dmSent",
  "dmClosed",
] as const;

export type SystemMessageKey = (typeof SYSTEM_MESSAGE_KEYS)[number];

export const SYSTEM_MESSAGES: Record<SystemMessageKey, MessageBody> = {
  featureOff: embedReply("That feature is switched off on this server.", "error"),
  commandOff: embedReply("That command is switched off on this server.", "error"),
  channelOff: embedReply("That command is turned off in this channel.", "error"),
  noRole: embedReply("You do not have a role that is allowed to use that command.", "error"),
  commandFailed: embedReply("That command did not finish. The server log has the details.", "error"),
  roleGone: embedReply("That role no longer exists.", "error"),
  roleTooHigh: embedReply(
    "I can't change **{role}** because it sits above my own highest role. Ask an admin to move my role above it.",
    "error",
  ),
  memberNotFound: embedReply("I couldn't find you on this server.", "error"),
  roleChangeFailed: embedReply("I couldn't change **{role}**. Check that I have Manage Roles.", "error"),
  roleGiven: embedReply("You now have **{role}**.", "success"),
  roleTaken: embedReply("**{role}** was taken off you.", "success"),
  notActive: embedReply("This message's buttons and menus are no longer active.", "error"),
  componentFailed: embedReply("That didn't work. The server log has the details.", "error"),
  dmSent: embedReply("I sent that to your direct messages.", "success"),
  dmClosed: embedReply(
    "I couldn't send you a direct message. In this server's privacy settings, allow direct messages from server members, then try again.",
    "error",
  ),
};

const COMMAND: MessageVariable = { name: "command", description: "The command, as members type it", sample: "/rank" };
const FEATURE: MessageVariable = { name: "module", description: "The name of the feature the command belongs to", sample: "Leveling" };
const ROLE: MessageVariable = { name: "role", description: "The role's name", sample: "Events" };

export const SYSTEM_VARIABLES: Record<SystemMessageKey, MessageVariable[]> = {
  featureOff: [COMMAND, FEATURE],
  commandOff: [{ ...COMMAND, sample: "/ticket close" }],
  channelOff: [COMMAND, { name: "channel", description: "The channel the command was used in, as a link", sample: "#general" }],
  noRole: [
    COMMAND,
    { name: "roles", description: "The roles that may use it, as mentions", sample: "@Moderator, @Helper" },
  ],
  commandFailed: [COMMAND],
  roleGone: [],
  roleTooHigh: [ROLE],
  memberNotFound: [],
  roleChangeFailed: [ROLE],
  roleGiven: [ROLE],
  roleTaken: [ROLE],
  notActive: [],
  componentFailed: [],
  dmSent: [{ name: "count", description: "How many messages were sent", sample: "3" }],
  dmClosed: [],
};

export interface SystemMessageInfo {
  label: string;
  /** When it is sent, which the dashboard shows beside the setting. */
  help: string;
}

export const SYSTEM_INFO: Record<SystemMessageKey, SystemMessageInfo> = {
  featureOff: {
    label: "A feature is switched off",
    help: "Sent when someone uses a command whose feature is turned off on this server.",
  },
  commandOff: {
    label: "A command or part of one is switched off",
    help: "Sent when someone uses a part of a command, such as /ticket close, that the Commands page switched off. Discord still lists every part of a command, so the bot answers with this. A whole command that is off leaves Discord within a few seconds.",
  },
  channelOff: {
    label: "A command is turned off in this channel",
    help: "Sent when someone uses a command in a channel the Commands page excludes it from.",
  },
  noRole: {
    label: "No allowed role",
    help: "Sent when a command is limited to certain roles and the member has none of them.",
  },
  commandFailed: {
    label: "A command failed",
    help: "Sent when a command stops partway because of an error. The details go to the server log, not here.",
  },
  roleGone: {
    label: "A role no longer exists",
    help: "Sent when a role button or menu gives a role that has since been deleted.",
  },
  roleTooHigh: {
    label: "A role is above the bot's own",
    help: "Sent when a role button or menu points at a role positioned above the bot's highest role, which the bot cannot hand out.",
  },
  memberNotFound: {
    label: "The bot could not find the member",
    help: "Sent when someone presses a role button but is not found on the server.",
  },
  roleChangeFailed: {
    label: "A role could not be changed",
    help: "Sent when Discord refuses to give or take a role, usually because the bot lacks Manage Roles.",
  },
  roleGiven: {
    label: "A role was given",
    help: "Sent after a role button or menu gives a role, unless that button has a confirmation of its own.",
  },
  roleTaken: {
    label: "A role was taken away",
    help: "Sent after a role button or menu takes a role, unless that button has a confirmation of its own.",
  },
  notActive: {
    label: "The buttons are no longer active",
    help: "Sent when someone presses a button or menu on a message the bot no longer has a record of, such as one that was deleted and reposted.",
  },
  componentFailed: {
    label: "A button, menu or form failed",
    help: "Sent when pressing a button, choosing from a menu or sending a form stops partway because of an error.",
  },
  dmSent: {
    label: "Messages were sent as a direct message",
    help: "Sent after a button or menu sends its reply to the person as a direct message, so they know where to look.",
  },
  dmClosed: {
    label: "A direct message could not be sent",
    help: "Sent when a button or menu tries to send a direct message and the person has direct messages from server members turned off.",
  },
};

/** Short pieces of text the bot sets itself, with Discord's limits as the ceilings. */
export const LABEL_DEFAULTS = {
  unknownRole: "Unknown role",
  unknownChannel: "# unknown channel",
  webhookName: "TierZero messages",
  defaultSender: "the dashboard",
  timeoutRemovalReason: "Case #{case} removed by {actor}",
  banRemovalReason: "Case #{case} was removed from the record by {actor}",
} as const;

export type SystemLabels = { [K in keyof typeof LABEL_DEFAULTS]: string };
