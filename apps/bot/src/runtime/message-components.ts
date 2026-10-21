import { Events, MessageFlags, type AnySelectMenuInteraction, type ButtonInteraction, type Client, type Guild, type GuildMember, type InteractionReplyOptions, type MessageCreateOptions } from "discord.js";
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
import type { SystemMessageKey } from "@tier0/module-system";
import { prisma } from "@tier0/db";
import { COMPONENT_PREFIX, hasInteractiveComponents } from "../control/message-payload.js";
import { buildReply } from "./command-reply.js";
import { commandVariables } from "./command-variables.js";
import { renderSystem, replySystem, type SystemSource } from "./system-messages.js";

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

/** What a role action has to say, before it is joined with what the others said. */
export interface Piece {
  content?: string | undefined;
  embeds: NonNullable<MessageCreateOptions["embeds"]>;
}

/**
 * One reply for a click that did several things, such as a menu that gave two
 * roles: every text on its own line, every embed kept in order, and Discord's
 * ten embeds per message as the ceiling.
 */
export function mergePieces(pieces: readonly Piece[]): Piece {
  const lines = pieces.map((piece) => piece.content).filter((text): text is string => text !== undefined && text !== "");
  return {
    ...(lines.length > 0 ? { content: lines.join("\n") } : {}),
    embeds: pieces.flatMap((piece) => piece.embeds).slice(0, 10),
  };
}

interface Reply {
  message: MessageBody;
  ephemeral: boolean;
  dm: boolean;
}

interface Outcome {
  /** The replies the actions asked for, which win over any confirmation. A menu that allows several choices can ask for one each. */
  replies: Reply[];
  confirmations: Piece[];
}

/** Discord allows one reply to an interaction and five follow-ups, so a menu answers with at most this many messages. */
export const MAX_REPLIES = 6;

/** Gives, takes or toggles a role for whoever clicked, and says what happened. */
export async function applyRole(
  source: SystemSource,
  interaction: Clicked,
  guild: Guild,
  action: Extract<ComponentAction, { type: "role" }>,
  variables: Record<string, string>,
): Promise<Piece> {
  const say = async (key: SystemMessageKey, roleName: string): Promise<Piece> => {
    const rendered = await renderSystem(source, guild, key, { ...variables, role: roleName });
    return { content: rendered?.payload.content, embeds: rendered?.payload.embeds ?? [] };
  };

  const role = guild.roles.cache.get(action.roleId);
  if (!role) return say("roleGone", "");

  const botHighest = guild.members.me?.roles.highest.position ?? 0;
  if (!isRoleAssignable(role.position, botHighest)) return say("roleTooHigh", role.name);

  const member: GuildMember | null = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return say("memberNotFound", role.name);

  const has = member.roles.cache.has(role.id);
  const adding = action.mode === "add" || (action.mode === "toggle" && !has);
  try {
    if (adding) await member.roles.add(role);
    else await member.roles.remove(role);
  } catch {
    return say("roleChangeFailed", role.name);
  }

  // A confirmation written on the button itself wins over the server's usual one.
  if (action.confirmation.trim() !== "") {
    const filled = { ...variables, role: role.name };
    return { content: applyVariablesToMessage(plainReply(action.confirmation), filled).content, embeds: [] };
  }
  return say(adding ? "roleGiven" : "roleTaken", role.name);
}

async function run(
  source: SystemSource,
  interaction: Clicked,
  guild: Guild,
  actions: ComponentAction[],
  extra: Record<string, string>,
): Promise<void> {
  const variables = clickVariables(interaction, guild, extra);
  const outcome: Outcome = { replies: [], confirmations: [] };

  for (const action of actions) {
    if (action.type === "role") outcome.confirmations.push(await applyRole(source, interaction, guild, action, variables));
    else if (action.type === "reply" && outcome.replies.length < MAX_REPLIES) {
      outcome.replies.push({
        message: { content: action.reply.content, embeds: action.reply.embeds, buttons: [], selects: [], reactions: [] },
        ephemeral: action.reply.ephemeral,
        dm: action.reply.dm,
      });
    }
  }

  if (outcome.replies.length > 0) {
    const say = async (key: SystemMessageKey, extra: Record<string, string> = {}): Promise<InteractionReplyOptions | null> => {
      const rendered = await renderSystem(source, guild, key, { ...variables, ...extra });
      if (!rendered) return null;
      return { ...(rendered.payload.content !== undefined ? { content: rendered.payload.content } : {}), embeds: rendered.payload.embeds ?? [] };
    };

    // Direct messages go out first, so the answer in the channel can say whether they arrived.
    const privately = outcome.replies.filter((reply) => reply.dm);
    let delivered = 0;
    for (const reply of privately) {
      const options = buildReply(reply.message, variables, guild);
      if (!options) continue;
      const { flags: _flags, ...message } = options;
      if (await interaction.user.send(message as MessageCreateOptions).then(() => true, () => false)) delivered += 1;
    }

    const answers: (InteractionReplyOptions & { ephemeral: boolean })[] = [];
    for (const reply of outcome.replies.filter((entry) => !entry.dm)) {
      const options = buildReply(reply.message, variables, guild);
      if (options) answers.push({ ...options, ephemeral: reply.ephemeral });
    }
    if (privately.length > 0) {
      const note = delivered === 0 ? await say("dmClosed") : delivered < privately.length ? await say("dmClosed") : await say("dmSent", { count: String(delivered) });
      if (note) answers.push({ ...note, ephemeral: true });
    }

    const [first, ...rest] = answers;
    if (first) {
      const { ephemeral, ...options } = first;
      await interaction.reply({ ...options, ...ephemeralFlag(interaction, ephemeral) });
      for (const answer of rest) {
        const { ephemeral: hidden, ...more } = answer;
        await interaction.followUp({ ...more, ...ephemeralFlag(interaction, hidden) });
      }
      return;
    }
  }
  if (outcome.confirmations.length > 0) {
    const { content, embeds } = mergePieces(outcome.confirmations);
    if (content !== undefined || embeds.length > 0) {
      await interaction.reply({
        ...(content !== undefined ? { content } : {}),
        embeds,
        allowedMentions: { parse: ["users", "roles"] },
        ...ephemeralFlag(interaction),
      });
      return;
    }
  }
  // An action of "nothing" still has to answer, or Discord shows the person a failure.
  await interaction.deferUpdate();
}

/** Answers the buttons and menus the bot put on messages, by looking up what each was set to do. */
export function registerMessageComponents(client: Client, source: SystemSource): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!(interaction.isButton() || interaction.isAnySelectMenu())) return;
    const parts = interaction.customId.split(":");
    if (parts[0] !== COMPONENT_PREFIX) return;
    const kind = parts[1];
    const index = Number(parts[2]);

    // In a server this is the owner's wording for that server; in a direct message with no record there is nobody to ask, so it is the usual wording.
    const notActive = (guild: Guild | null) => replySystem(source, interaction, guild ?? interaction.guild, "notActive");

    try {
      const row = await prisma.messageInteraction.findUnique({ where: { messageId: interaction.message.id } });
      const guildId = clickGuildId(interaction.guildId, row);
      const guild = guildId !== null ? (interaction.guild ?? (await guildOf(interaction.client, guildId))) : null;
      if (!row || !guild || !Number.isInteger(index)) {
        await notActive(guild);
        return;
      }

      if (kind === "b" && interaction.isButton()) {
        const button: MessageButton | undefined = readButtons(parseJson(row.buttons))[index];
        if (!button) {
          await notActive(guild);
          return;
        }
        await run(source, interaction, guild, [button.action], {});
        return;
      }

      if (kind === "s" && interaction.isAnySelectMenu()) {
        const select: MessageSelect | undefined = readSelects(parseJson(row.selects))[index];
        if (!select) {
          await notActive(guild);
          return;
        }
        if (select.kind === "string") {
          const chosen = select.options.filter((option) => interaction.values.includes(option.value));
          await run(source, interaction, guild, chosen.map((option) => option.action), { selected: chosen.map((option) => option.label).join(", ") });
        } else {
          const mention = (id: string) =>
            select.kind === "user" ? `<@${id}>` : select.kind === "role" ? `<@&${id}>` : select.kind === "channel" ? `<#${id}>` : interaction.isMentionableSelectMenu() && interaction.roles.has(id) ? `<@&${id}>` : `<@${id}>`;
          await run(source, interaction, guild, [select.action], { selected: interaction.values.map(mention).join(", ") });
        }
        return;
      }

      await notActive(guild);
    } catch (error) {
      console.error("message component failed:", error);
      await replySystem(source, interaction, interaction.guild, "componentFailed");
    }
  });
}
