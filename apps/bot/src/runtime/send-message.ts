import { MessageFlags } from "discord.js";
import type { Guild, GuildMember, Message, MessageComponentInteraction, MessageCreateOptions, RepliableInteraction, TextBasedChannel, User } from "discord.js";
import {
  applyVariablesToMessage,
  flattenEmbeds,
  linksOnly,
  parseMessage,
  restrictMessage,
  type MessageBody,
  type EditMessageOptions,
  type MessageDelivery,
  type ReplyMessageOptions,
  type ReplyValues,
  type SendMessageOptions,
} from "@tier0/core";
import { firstEmptyLimitedMenu, namesOf, toDiscordPayload, type NameLookup } from "../control/message-payload.js";
import { commandVariables, globalVariables, stringValues } from "./command-variables.js";
import { saveInteractions } from "./message-components.js";

export type MessageTarget = TextBasedChannel | User | GuildMember;

export interface RenderedMessage {
  payload: MessageCreateOptions;
  /** The message after its variables were filled in, which is what buttons and reactions are taken from. */
  message: MessageBody;
}

/**
 * Fills in a message and turns it into what discord.js sends. Returns null when
 * filling it in made it too long or otherwise invalid, or left a menu with
 * nothing to offer, which the caller treats as "send the fallback". A channel
 * post can mention people and roles; a direct message mentions nobody.
 */
export function renderMessage(
  body: MessageBody,
  values: Record<string, string>,
  guild?: Guild,
  delivery: MessageDelivery = "channel",
  mentions?: SendMessageOptions["mentions"],
  unknown?: NameLookup["unknown"],
): RenderedMessage | null {
  const filled = parseMessage(applyVariablesToMessage(restrictMessage(body, delivery), values));
  if (!filled.ok) {
    console.error("A message no longer fits Discord's limits once its variables are filled in:", filled.errors[0]?.message);
    return null;
  }
  const names = guild ? namesOf(guild, unknown) : undefined;
  if (names && firstEmptyLimitedMenu(filled.value, names) >= 0) {
    console.error("A message has a menu limited to channels or roles that no longer exist.");
    return null;
  }
  return {
    payload: {
      ...toDiscordPayload(filled.value, names),
      allowedMentions: allowedMentionsFor(delivery, mentions),
    },
    message: filled.value,
  };
}

function allowedMentionsFor(delivery: MessageDelivery, mentions: SendMessageOptions["mentions"]): MessageCreateOptions["allowedMentions"] {
  if (delivery === "dm") return { parse: [] };
  // Naming ids and also setting `parse` is rejected by Discord, so an explicit
  // list replaces the blanket permission instead of narrowing it.
  if (mentions) return { users: mentions.users ?? [], roles: mentions.roles ?? [] };
  return { parse: ["users", "roles"] };
}

export interface SendOptions extends SendMessageOptions {
  /** The server the variables describe. Taken from the target when it belongs to one. */
  guild?: Guild;
  /** Replaced in tests, which have no database. */
  persist?: typeof saveInteractions;
  /** Set by the module context from the owner's "Labels and text"; the defaults apply without it. */
  unknown?: NameLookup["unknown"];
}

/**
 * Discord answers a post whose embeds the bot may not use with one of two
 * codes: missing permissions, or an empty message when it dropped the embed and
 * nothing else was left.
 */
function refusesEmbeds(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return code === 50013 || code === 50006;
}

/** What to post instead when the channel will not take embeds: the same message with them written out as text. */
function withoutEmbeds(rendered: RenderedMessage, guild: Guild | undefined, unknown: NameLookup["unknown"]): MessageCreateOptions {
  const flat = flattenEmbeds(rendered.message);
  return { ...toDiscordPayload(flat, guild ? namesOf(guild, unknown) : undefined), allowedMentions: rendered.payload.allowedMentions };
}

type Destination = { send(options: MessageCreateOptions): Promise<Message> };

const isChannel = (target: MessageTarget): target is TextBasedChannel => "isTextBased" in target && typeof target.isTextBased === "function";

function deliveryOf(target: MessageTarget): MessageDelivery {
  if (!isChannel(target)) return "dm";
  return target.isDMBased() ? "dm" : "channel";
}

/**
 * Sends a message an owner can edit, then does what the Messages page does once
 * a message is out: remembers what its buttons and menus do, and adds its
 * reactions. Never throws. A message that cannot be delivered, because a person
 * has direct messages closed or the bot lacks a permission, is logged and
 * resolves to null so a feature carries on without it.
 *
 * `values` are the module's own variables and win over the shared ones.
 */
export async function sendMessage(
  target: MessageTarget,
  body: MessageBody,
  values: ReplyValues = {},
  options: SendOptions = {},
): Promise<Message | null> {
  try {
    const delivery = deliveryOf(target);
    const guild = options.guild ?? ("guild" in target ? (target.guild ?? undefined) : undefined);
    const channel = isChannel(target) && delivery === "channel" ? target : null;
    const variables = {
      ...globalVariables({
        guild: guild ?? null,
        client: target.client,
        sender: options.sender ?? "",
        channel: channel ? { id: channel.id, ...("name" in channel && typeof channel.name === "string" ? { name: channel.name } : {}) } : null,
      }),
      ...stringValues(values),
    };
    if (options.sender === undefined) variables.sender = variables.bot ?? "";

    // Without a server there is nothing for a button to act on, so a direct
    // message then keeps only the buttons that open an address.
    const usable = (message: MessageBody) => (delivery === "dm" && !guild ? linksOnly(message) : message);
    let rendered = renderMessage(usable(body), variables, guild, delivery, options.mentions, options.unknown);
    if (!rendered && options.fallback) rendered = renderMessage(usable(options.fallback), variables, guild, delivery, options.mentions, options.unknown);
    if (!rendered) return null;

    const payload: MessageCreateOptions = {
      ...rendered.payload,
      components: [...(rendered.payload.components ?? []), ...(options.rows ?? [])],
      ...(options.files ? { files: options.files } : {}),
    };
    const destination = target as unknown as Destination;
    let sent: Message;
    try {
      sent = await destination.send(payload);
    } catch (error) {
      // Only a channel can lack Embed Links, and only a message with embeds has anything to give up.
      if (delivery !== "channel" || rendered.message.embeds.length === 0 || !refusesEmbeds(error)) throw error;
      console.error("A channel would not take embeds, probably because the bot lacks Embed Links there, so the message was sent as text:", error);
      sent = await destination.send({
        ...withoutEmbeds(rendered, guild, options.unknown),
        components: payload.components ?? [],
        ...(options.files ? { files: options.files } : {}),
      });
    }

    // The message is out by now, so what follows is extra and must not undo it.
    if (guild) {
      const persist = options.persist ?? saveInteractions;
      await persist(guild.id, sent.channelId, sent.id, rendered.message).catch((error: unknown) => {
        console.error("Could not keep what a sent message's buttons do:", error);
      });
    }
    if (delivery === "channel") {
      for (const reaction of rendered.message.reactions) await sent.react(reaction).catch(() => undefined);
    }
    return sent;
  } catch (error) {
    console.error("A message could not be sent:", error);
    return null;
  }
}

export interface EditOptions extends EditMessageOptions {
  guild?: Guild;
  persist?: typeof saveInteractions;
  unknown?: NameLookup["unknown"];
}

/**
 * Rewrites a message the bot sent earlier, for a post that stays in place and
 * is refreshed when its settings change. Never throws; resolves to null when
 * the message cannot be edited, so the caller can post a new one.
 */
export async function editMessage(
  message: Message,
  body: MessageBody,
  values: ReplyValues = {},
  options: EditOptions = {},
): Promise<Message | null> {
  try {
    const guild = options.guild ?? message.guild ?? undefined;
    const channel = message.channel;
    const variables = {
      ...globalVariables({
        guild: guild ?? null,
        client: message.client,
        sender: "",
        channel: { id: channel.id, ...("name" in channel && typeof channel.name === "string" ? { name: channel.name } : {}) },
      }),
      ...stringValues(values),
    };
    variables.sender = variables.bot ?? "";

    let rendered = renderMessage(body, variables, guild, "channel", undefined, options.unknown);
    if (!rendered && options.fallback) rendered = renderMessage(options.fallback, variables, guild, "channel", undefined, options.unknown);
    if (!rendered) return null;

    const components = [...(rendered.payload.components ?? []), ...(options.rows ?? [])];
    let edited: Message;
    try {
      edited = await message.edit({
        // An edit keeps whatever it is not told to change, so an empty text has to be said.
        content: rendered.payload.content ?? "",
        embeds: rendered.payload.embeds ?? [],
        components,
        allowedMentions: rendered.payload.allowedMentions ?? { parse: [] },
      });
    } catch (error) {
      if (rendered.message.embeds.length === 0 || !refusesEmbeds(error)) throw error;
      console.error("A channel would not take embeds, probably because the bot lacks Embed Links there, so the message was edited to text:", error);
      const flat = withoutEmbeds(rendered, guild, options.unknown);
      edited = await message.edit({
        content: flat.content ?? "",
        embeds: [],
        components,
        allowedMentions: flat.allowedMentions ?? { parse: [] },
      });
    }

    if (guild) {
      const persist = options.persist ?? saveInteractions;
      await persist(guild.id, edited.channelId, edited.id, rendered.message).catch((error: unknown) => {
        console.error("Could not keep what an edited message's buttons do:", error);
      });
    }
    for (const reaction of rendered.message.reactions) await edited.react(reaction).catch(() => undefined);
    return edited;
  } catch (error) {
    console.error("A message could not be edited:", error);
    return null;
  }
}

/**
 * Answers an interaction with an owner's message. Only link buttons survive,
 * because a reply is not kept the way a posted message is and nothing would
 * answer the others. `values` win over the shared variables.
 */
export async function replyMessage(
  interaction: RepliableInteraction | MessageComponentInteraction,
  body: MessageBody,
  values: ReplyValues = {},
  options: ReplyMessageOptions & { guild?: Guild; unknown?: NameLookup["unknown"] } = {},
): Promise<boolean> {
  try {
    const guild = options.guild ?? interaction.guild ?? undefined;
    const variables = {
      ...commandVariables({
        guild: guild ?? null,
        user: interaction.user,
        channelId: interaction.channelId ?? "",
        channel: interaction.channel,
        client: interaction.client,
      }),
      ...stringValues(values),
    };

    let rendered = renderMessage(linksOnly(body), variables, guild, "channel", undefined, options.unknown);
    if (!rendered && options.fallback) rendered = renderMessage(linksOnly(options.fallback), variables, guild, "channel", undefined, options.unknown);
    if (!rendered) return false;

    const ephemeral = options.ephemeral ?? true;
    const { content, embeds, components, allowedMentions } = rendered.payload;
    const reply = { ...(content !== undefined ? { content } : {}), embeds, components, allowedMentions };
    const flags = ephemeral ? { flags: MessageFlags.Ephemeral as const } : {};
    if (interaction.replied) await interaction.followUp({ ...reply, ...flags });
    else if (interaction.deferred) await interaction.editReply(reply);
    else await interaction.reply({ ...reply, ...flags });
    return true;
  } catch (error) {
    console.error("A reply could not be sent:", error);
    return false;
  }
}
