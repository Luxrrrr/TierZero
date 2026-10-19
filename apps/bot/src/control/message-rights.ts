import { PermissionFlagsBits, type Guild, type GuildBasedChannel } from "discord.js";
import type { ComponentAction, MessageBody } from "@tier0/core";
import { isInstanceOwner } from "../instance-owner.js";
import { roleGrantProblems } from "../runtime/role-grants.js";

/**
 * The Message creator sends with the bot's own access, so without a check it
 * lends that access to anyone who can open the dashboard: a channel they cannot
 * see, an @everyone ping they could not send, a name and picture they could not
 * give a webhook. Sending through it needs what sending by hand needs. The
 * dashboard says who is sending, from the signed-in account.
 */

/**
 * Set by the bot itself, never read from a request, for a scheduled send saved
 * before schedules recorded who made them. Those keep running as they did.
 */
export const TRUSTED_SEND = Symbol("trustedSend");

export function senderIdOf(payload: Record<string, unknown>): string | undefined {
  const { actor } = payload;
  return typeof actor === "string" && /^\d{17,20}$/.test(actor) ? actor : undefined;
}

/** The roles a message's buttons and menus give or take, by role id, with where it is set. */
export function roleActionsOf(message: MessageBody): Map<string, string> {
  const found = new Map<string, string>();
  const note = (action: ComponentAction, path: string): void => {
    if (action.type === "role" && action.roleId !== "" && !found.has(action.roleId)) found.set(action.roleId, path);
  };
  message.buttons.forEach((button, i) => note(button.action, `buttons[${i}]`));
  message.selects.forEach((select, i) => {
    note(select.action, `selects[${i}]`);
    select.options.forEach((option, j) => note(option.action, `selects[${i}].options[${j}]`));
  });
  return found;
}

export interface SendWants {
  allowEveryone: boolean;
  /** Sent, or edited, under another name through a webhook. */
  viaWebhook: boolean;
  roles: ReadonlyMap<string, string>;
}

/** Why this person may not send this, in words for them, or null when they may. */
export async function senderProblem(
  guild: Guild,
  actorId: string | undefined,
  channel: GuildBasedChannel,
  wants: SendWants,
): Promise<string | null> {
  if (!actorId) return "We couldn't tell who is sending this. Reload the page and try again.";
  if (guild.ownerId === actorId || (await isInstanceOwner(actorId))) return null;

  const member = await guild.members.fetch(actorId).catch(() => null);
  if (!member) return "Only a member of this server can send messages through the bot.";

  const permissions = channel.permissionsFor(member);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages)) {
    return `You can't send messages in #${channel.name}, so the bot won't send there for you.`;
  }
  if (wants.allowEveryone && !permissions.has(PermissionFlagsBits.MentionEveryone)) {
    return `Pinging @everyone and @here needs the Mention Everyone permission in #${channel.name}.`;
  }
  if (wants.viaWebhook && !permissions.has(PermissionFlagsBits.ManageWebhooks)) {
    return `Sending under another name needs the Manage Webhooks permission in #${channel.name}.`;
  }
  const roleProblem = (await roleGrantProblems(guild, actorId, wants.roles))[0];
  return roleProblem ? roleProblem.message : null;
}
