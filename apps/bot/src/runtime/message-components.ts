import { Events, MessageFlags, type AnySelectMenuInteraction, type ButtonInteraction, type Client, type Guild, type GuildMember } from "discord.js";
import {
  applyVariablesToMessage,
  isRoleAssignable,
  plainReply,
  readButtons,
  readSelects,
  type ComponentAction,
  type MessageBody,
  type MessageButton,
  type MessageSelect,
} from "@tier0/core";
import { prisma } from "@tier0/db";
import { COMPONENT_PREFIX, hasInteractiveComponents } from "../control/message-payload.js";
import { buildReply } from "./command-reply.js";
import { commandVariables } from "./command-variables.js";

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return [];
  }
};

/** Keeps what a sent message's buttons and menus do, under the id of the message they are on. */
export async function saveInteractions(guildId: string, channelId: string, messageId: string, message: MessageBody): Promise<void> {
  if (!hasInteractiveComponents(message)) return;
  await prisma.messageInteraction.upsert({
    where: { messageId },
    create: { messageId, guildId, channelId, buttons: JSON.stringify(message.buttons), selects: JSON.stringify(message.selects) },
    update: { buttons: JSON.stringify(message.buttons), selects: JSON.stringify(message.selects) },
  });
}

type Clicked = ButtonInteraction | AnySelectMenuInteraction;

/**
 * Which server a click belongs to. In a server it is that server, and a stored
 * row from anywhere else is not trusted. In a direct message the row is the only
 * thing that says which server the message was sent about.
 */
export function clickGuildId(interactionGuildId: string | null, row: { guildId: string } | null): string | null {
  if (!row) return null;
  if (interactionGuildId !== null && row.guildId !== interactionGuildId) return null;
  return row.guildId;
}

/** Ephemeral means nothing in a direct message, which only the clicker can see anyway. */
export const ephemeralFlag = (interaction: Clicked, wanted = true): { flags?: MessageFlags.Ephemeral } =>
  wanted && interaction.inGuild() ? { flags: MessageFlags.Ephemeral } : {};

async function guildOf(client: Client, id: string): Promise<Guild | null> {
  return client.guilds.cache.get(id) ?? (await client.guilds.fetch(id).catch(() => null));
}

/** Everything a click can say: the usual variables, plus who clicked and what they picked. */
function clickVariables(interaction: Clicked, guild: Guild, extra: Record<string, string>): Record<string, string> {
  return {
    ...commandVariables({
      guild,
      user: interaction.user,
      channelId: interaction.channelId ?? "",
      // A direct message has no channel in the server to link to.
      channel: interaction.inGuild() ? interaction.channel : null,
      client: interaction.client,
    }),
    user: interaction.member && "displayName" in interaction.member ? interaction.member.displayName : interaction.user.displayName,
    "user.mention": `<@${interaction.user.id}>`,
    selected: "",
    role: "",
    ...extra,
  };
}

interface Outcome {
  /** A reply the action asked for, which wins over any confirmation. */
  reply: { message: MessageBody; ephemeral: boolean } | null;
  confirmations: string[];
}

/** Gives, takes or toggles a role for whoever clicked, and says what happened. */
async function applyRole(
  interaction: Clicked,
  guild: Guild,
  action: Extract<ComponentAction, { type: "role" }>,
  variables: Record<string, string>,
): Promise<string> {
  const role = guild.roles.cache.get(action.roleId);
  if (!role) return "That role no longer exists.";

  const botHighest = guild.members.me?.roles.highest.position ?? 0;
  if (!isRoleAssignable(role.position, botHighest)) {
    return `I can't change **${role.name}** because it sits above my own highest role. Ask an admin to move my role above it.`;
  }

  const member: GuildMember | null = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return "I couldn't find you on this server.";

  const has = member.roles.cache.has(role.id);
  const adding = action.mode === "add" || (action.mode === "toggle" && !has);
  try {
    if (adding) await member.roles.add(role);
    else await member.roles.remove(role);
  } catch {
    return `I couldn't change **${role.name}**. Check that I have Manage Roles.`;
  }

  const filled = { ...variables, role: role.name };
  if (action.confirmation.trim() !== "") {
    return applyVariablesToMessage(plainReply(action.confirmation), filled).content;
  }
  return adding ? `You now have **${role.name}**.` : `**${role.name}** was taken off you.`;
}

async function run(
  interaction: Clicked,
  guild: Guild,
  actions: ComponentAction[],
  extra: Record<string, string>,
): Promise<void> {
  const variables = clickVariables(interaction, guild, extra);
  const outcome: Outcome = { reply: null, confirmations: [] };

  for (const action of actions) {
    if (action.type === "role") outcome.confirmations.push(await applyRole(interaction, guild, action, variables));
    else if (action.type === "reply" && outcome.reply === null) {
      outcome.reply = {
        message: { content: action.reply.content, embeds: action.reply.embeds, buttons: [], selects: [], reactions: [] },
        ephemeral: action.reply.ephemeral,
      };
    }
  }

  if (outcome.reply) {
    const options = buildReply(outcome.reply.message, variables, guild);
    if (options) {
      await interaction.reply({ ...options, ...ephemeralFlag(interaction, outcome.reply.ephemeral) });
      return;
    }
  }
  if (outcome.confirmations.length > 0) {
    await interaction.reply({ content: outcome.confirmations.join("\n"), ...ephemeralFlag(interaction) });
    return;
  }
  // An action of "nothing" still has to answer, or Discord shows the person a failure.
  await interaction.deferUpdate();
}

const NOT_ACTIVE = "This message's buttons and menus are no longer active.";

/** Answers the buttons and menus the bot put on messages, by looking up what each was set to do. */
export function registerMessageComponents(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!(interaction.isButton() || interaction.isAnySelectMenu())) return;
    const parts = interaction.customId.split(":");
    if (parts[0] !== COMPONENT_PREFIX) return;
    const kind = parts[1];
    const index = Number(parts[2]);

    try {
      const row = await prisma.messageInteraction.findUnique({ where: { messageId: interaction.message.id } });
      const guildId = clickGuildId(interaction.guildId, row);
      const guild = guildId !== null ? (interaction.guild ?? (await guildOf(interaction.client, guildId))) : null;
      if (!row || !guild || !Number.isInteger(index)) {
        await interaction.reply({ content: NOT_ACTIVE, ...ephemeralFlag(interaction) });
        return;
      }

      if (kind === "b" && interaction.isButton()) {
        const button: MessageButton | undefined = readButtons(parseJson(row.buttons))[index];
        if (!button) {
          await interaction.reply({ content: NOT_ACTIVE, ...ephemeralFlag(interaction) });
          return;
        }
        await run(interaction, guild, [button.action], {});
        return;
      }

      if (kind === "s" && interaction.isAnySelectMenu()) {
        const select: MessageSelect | undefined = readSelects(parseJson(row.selects))[index];
        if (!select) {
          await interaction.reply({ content: NOT_ACTIVE, ...ephemeralFlag(interaction) });
          return;
        }
        if (select.kind === "string") {
          const chosen = select.options.filter((option) => interaction.values.includes(option.value));
          await run(interaction, guild, chosen.map((option) => option.action), { selected: chosen.map((option) => option.label).join(", ") });
        } else {
          const mention = (id: string) =>
            select.kind === "user" ? `<@${id}>` : select.kind === "role" ? `<@&${id}>` : select.kind === "channel" ? `<#${id}>` : interaction.isMentionableSelectMenu() && interaction.roles.has(id) ? `<@&${id}>` : `<@${id}>`;
          await run(interaction, guild, [select.action], { selected: interaction.values.map(mention).join(", ") });
        }
        return;
      }

      await interaction.reply({ content: NOT_ACTIVE, ...ephemeralFlag(interaction) });
    } catch (error) {
      console.error("message component failed:", error);
      const message = "That didn't work. The server log has the details.";
      if (interaction.replied || interaction.deferred) await interaction.followUp({ content: message, ...ephemeralFlag(interaction) }).catch(() => undefined);
      else await interaction.reply({ content: message, ...ephemeralFlag(interaction) }).catch(() => undefined);
    }
  });
}
