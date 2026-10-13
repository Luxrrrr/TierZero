import { MessageFlags } from "discord.js";
import type { ContextMenuCommandInteraction, MessageComponentInteraction, RepliableInteraction } from "discord.js";
import { REPLY_COLOR, type MessageBody, type ModuleContext, type ReplyKind, type ReplyValues } from "@tier0/core";
import type { ModerationSettings } from "./settings.js";
import { clip, noticeValues, type ModLogEntry } from "./modlog.js";
import { MODLOG_MESSAGE } from "./messages.js";
import { ActionRefused, type ModLogOutcome } from "./action-rules.js";
import { REFUSALS, REPLIES, defaultBody, fillLabel, stringValues, type ReplyGroup } from "./texts.js";

type Ctx = ModuleContext<ModerationSettings>;
/** A context menu interaction can be replied to like any other, though discord.js types its base class apart from the rest. */
export type Answerable = RepliableInteraction | MessageComponentInteraction | ContextMenuCommandInteraction;

export const repliable = (interaction: Answerable): RepliableInteraction | MessageComponentInteraction => interaction as RepliableInteraction;

/** The last-resort reply, in the same look as the defaults. An embed holds more than a message does, so a long value still fits. */
const sentence = (text: string, kind: ReplyKind) => ({ embeds: [{ description: text.slice(0, 4000), color: parseInt(REPLY_COLOR[kind].slice(1), 16) }] });

/**
 * Answers an interaction with one of the owner's editable replies. If it cannot
 * be sent in the owner's words, such as when a filled-in value pushes it past
 * Discord's limits, the default wording goes instead, so a moderator is never
 * left with no answer.
 */
export async function say<G extends ReplyGroup>(
  ctx: Ctx,
  interaction: Answerable,
  group: G,
  key: keyof (typeof REPLIES)[G] & string,
  values: ReplyValues = {},
): Promise<void> {
  const owned: Record<string, MessageBody> = ctx.settings.replies[group];
  const body = owned[key];
  const fallback = defaultBody(group, key);
  if (body && (await ctx.reply(repliable(interaction), body, values, { fallback }))) return;
  // Both were refused, which only happens when the values themselves are too long for a message.
  const specs: Record<string, { text: string; kind: ReplyKind }> = REPLIES[group];
  const payload = sentence(fillLabel(specs[key]?.text ?? "", stringValues(values)), specs[key]?.kind ?? "info");
  try {
    if (interaction.replied) await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    else if (interaction.deferred) await interaction.editReply(payload);
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error("moderation: a reply could not be sent:", error);
  }
}

/**
 * Tells the person who asked why an action was refused, in the owner's wording
 * when the refusal has some and in the plain sentence it carries otherwise.
 */
export async function replyRefusal(ctx: Ctx, interaction: Answerable, error: ActionRefused): Promise<void> {
  if (error.code !== undefined && Object.hasOwn(REFUSALS, error.code)) {
    await say(ctx, interaction, "refusals", error.code, error.values);
    return;
  }
  const payload = sentence(error.message, "error");
  if (interaction.replied) await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
  else if (interaction.deferred) await interaction.editReply(payload);
  else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

/** Discord's limit on an embed field's value, which the mod log's Reason field is. */
const FIELD_MAX = 1024;

/** Posts to the configured mod log channel. A no-op when none is set; never throws. */
export async function postModLog(
  ctx: ModuleContext<ModerationSettings>,
  entry: ModLogEntry,
): Promise<ModLogOutcome> {
  const channelId = ctx.settings.modLogChannel;
  if (!channelId) return "unset";

  const channel = ctx.guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return "missing";

  // A failed send is logged by ctx.send, which also falls back to the stock post if the owner's no longer fits.
  const links = { guildId: ctx.guild.id, dashboardBase: await ctx.dashboardUrl() };
  const values = noticeValues({ ...entry, links }, ctx.settings.labels);
  const reason = values.reason;
  if (typeof reason === "string") values.reason = clip(reason, FIELD_MAX);
  const sent = await ctx.send(channel, ctx.settings.modLogMessage, values, { fallback: MODLOG_MESSAGE });
  return sent ? "posted" : "failed";
}
