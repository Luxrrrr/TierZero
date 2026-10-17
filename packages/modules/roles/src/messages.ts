import { embedReply, emptyEmbed, plainReply, s, type Field, type MessageBody, type MessageVariable } from "@tier0/core";

/**
 * Wording the role menus start with, and the upgrade for menus saved when a
 * title and description were separate settings. Free of discord.js so it can be
 * tested on its own.
 */

export const MENU_MESSAGE: MessageBody = {
  ...plainReply(""),
  embeds: [{ ...emptyEmbed(), title: "Pick your roles", description: "Press a button to add or remove a role." }],
};

export const GAVE_MESSAGE: MessageBody = embedReply("Gave you **{role}**.", "success");
export const REMOVED_MESSAGE: MessageBody = embedReply("Removed **{role}**.", "success");
export const PUBLISHED_MESSAGE: MessageBody = embedReply('Published "{menu}" in {menuChannel}.', "success");
export const UPDATED_MESSAGE: MessageBody = embedReply("Your roles from {menu} are now: {roles}.", "success");
export const ALREADY_HAD_MESSAGE: MessageBody = embedReply("You already have **{role}**.", "info");
export const DID_NOT_HAVE_MESSAGE: MessageBody = embedReply("You don't have **{role}**, so there was nothing to remove.", "info");

export const MENU_VARIABLES = [{ name: "menu", description: "The menu's name", sample: "Platforms" }];

export const TOGGLE_VARIABLES = [
  { name: "role", description: "The name of the role", sample: "Gamers" },
  { name: "menu", description: "The name of the menu the button is on", sample: "Platforms" },
];

export const UPDATED_VARIABLES = [
  { name: "roles", description: "The names of the menu's roles the member has now, or a stand-in from Labels and text when there are none", sample: "PC, Console" },
  { name: "menu", description: "The name of the menu", sample: "Platforms" },
];

export const DEFAULT_LABELS = {
  noRoles: "none",
  placeholder: "Pick your roles",
} as const;

export const PUBLISHED_VARIABLES = [
  { name: "menu", description: "The menu's name", sample: "Platforms" },
  { name: "menuChannel", description: "The channel the menu is posted in, as a link", sample: "#roles" },
];

export type ProblemKey =
  | "noMenu"
  | "channelGone"
  | "editFailed"
  | "postFailed"
  | "inactive"
  | "optionGone"
  | "cannotAssign"
  | "roleChangeFailed"
  | "needsRole"
  | "tooMany";

interface ProblemDefinition {
  label: string;
  help: string;
  starting: MessageBody;
  variables?: MessageVariable[];
}

/** The refusals and failures a member or moderator is told about in private. */
export const PROBLEMS: Record<ProblemKey, ProblemDefinition> = {
  noMenu: {
    label: "Menu not found",
    help: "Shown to someone who runs /rolemenu with a name that is not on the list of menus.",
    starting: embedReply('No role menu named "{name}" is configured. Add one on the dashboard first.', "error"),
    variables: [{ name: "name", description: "The name that was typed", sample: "Platforms" }],
  },
  channelGone: {
    label: "Menu channel deleted",
    help: "Shown when a menu is published but the channel it should go in no longer exists.",
    starting: embedReply("The channel configured for this menu no longer exists.", "error"),
  },
  editFailed: {
    label: "Menu could not be updated",
    help: "Shown when a menu that is already posted cannot be edited, for example because the bot lost access to the channel.",
    starting: embedReply("I couldn't update the menu message. Check that I can still edit it.", "error"),
  },
  postFailed: {
    label: "Menu could not be posted",
    help: "Shown when the bot cannot post a new menu in its channel.",
    starting: embedReply("I couldn't post the menu there. Check that I can send messages and embed links in that channel.", "error"),
  },
  inactive: {
    label: "Menu no longer active",
    help: "Shown to a member who presses a button on a menu that was removed or replaced.",
    starting: embedReply("This menu is no longer active. Ask a moderator to republish it.", "error"),
  },
  optionGone: {
    label: "Option removed from the menu",
    help: "Shown to a member who presses a button whose role was taken off the menu or deleted.",
    starting: embedReply("That option is no longer part of this menu.", "error"),
  },
  cannotAssign: {
    label: "Role is above the bot",
    help: "Shown to a member who presses a button for a role the bot is not allowed to give because it sits above the bot's own highest role.",
    starting: embedReply("I can't give you **{role}** because that role sits above my own highest role. Ask an admin to move my role above it.", "error"),
    variables: TOGGLE_VARIABLES,
  },
  roleChangeFailed: {
    label: "Role could not be changed",
    help: "Shown to a member when Discord refuses to give or take a role, usually because the bot lacks Manage Roles.",
    starting: embedReply("I couldn't change **{role}**. Ask an admin to check that I have Manage Roles.", "error"),
    variables: TOGGLE_VARIABLES,
  },
  needsRole: {
    label: "Member lacks the required role",
    help: "Shown to a member who uses a menu that needs a role they do not have.",
    starting: embedReply("You need the **{required}** role to use {menu}.", "error"),
    variables: [
      { name: "required", description: "The name of the role the menu needs", sample: "Verified" },
      { name: "menu", description: "The name of the menu", sample: "Platforms" },
    ],
  },
  tooMany: {
    label: "Member already has the most roles allowed",
    help: "Shown to a member who picks a role from a menu with a limit when they already hold as many of its roles as it allows.",
    starting: embedReply("You can have at most {max} roles from {menu}. Remove one first.", "error"),
    variables: [
      { name: "max", description: "The most roles the menu allows", sample: "2" },
      { name: "menu", description: "The name of the menu", sample: "Platforms" },
    ],
  },
};

export const problemField = (key: ProblemKey): Field<MessageBody> =>
  s.message({
    label: PROBLEMS[key].label,
    help: PROBLEMS[key].help,
    note: "Only the person it is shown to sees this.",
    audience: "private",
    starting: PROBLEMS[key].starting,
    variables: PROBLEMS[key].variables ?? [],
    delivery: "dm",
    components: false,
    compact: true,
  });

const filled = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/**
 * A menu saved with a title and description becomes a message with an embed
 * holding them, which is what the menu has always posted. A menu that already
 * has a message is left as it is.
 */
export function upgradeMenu(stored: Record<string, unknown>): Record<string, unknown> {
  const { title, description, ...rest } = stored;
  if (rest.message !== undefined || (!filled(title) && !filled(description))) return rest;
  return {
    ...rest,
    message: {
      ...plainReply(""),
      embeds: [{ ...emptyEmbed(), title: filled(title) ? title : "", description: filled(description) ? description : "" }],
    },
  };
}
