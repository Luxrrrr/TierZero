import { emptyEmbed, plainReply, type MessageBody } from "@tier0/core";

/**
 * Wording the role menus start with, and the upgrade for menus saved when a
 * title and description were separate settings. Free of discord.js so it can be
 * tested on its own.
 */

export const MENU_MESSAGE: MessageBody = {
  ...plainReply(""),
  embeds: [{ ...emptyEmbed(), title: "Pick your roles", description: "Press a button to add or remove a role." }],
};

export const GAVE_MESSAGE: MessageBody = plainReply("Gave you **{role}**.");
export const REMOVED_MESSAGE: MessageBody = plainReply("Removed **{role}**.");
export const PUBLISHED_MESSAGE: MessageBody = plainReply('Published "{menu}" in {menuChannel}.');

export const MENU_VARIABLES = [{ name: "menu", description: "The menu's name", sample: "Platforms" }];

export const TOGGLE_VARIABLES = [
  { name: "role", description: "The name of the role", sample: "Gamers" },
  { name: "menu", description: "The name of the menu the button is on", sample: "Platforms" },
];

export const PUBLISHED_VARIABLES = [
  { name: "menu", description: "The menu's name", sample: "Platforms" },
  { name: "menuChannel", description: "The channel the menu is posted in, as a link", sample: "#roles" },
];

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
