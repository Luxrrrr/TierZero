import { EmbedBuilder, MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import type { ModuleContext } from "@tier0/core";
import type { ModerationSettings } from "./settings.js";
import { formatModLogEntry, type ModLogEntry } from "./modlog.js";

/** A user-facing failure. Always ephemeral, and always sent before any reply. */
export async function replyError(
  interaction: ChatInputCommandInteraction,
  message: string,
): Promise<void> {
  await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
}

export async function replyReasonRequired(interaction: ChatInputCommandInteraction): Promise<void> {
  await replyError(interaction, "This server requires a reason for moderation actions.");
}

/** Posts to the configured mod log channel. A no-op when none is set. */
export async function postModLog(
  ctx: ModuleContext<ModerationSettings>,
  entry: ModLogEntry,
): Promise<void> {
  const channelId = ctx.settings.modLogChannel;
  if (!channelId) return;

  const channel = ctx.guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return;

  const view = formatModLogEntry(entry);
  const embed = new EmbedBuilder().setTitle(view.title).addFields(view.fields).setTimestamp();

  await channel.send({ embeds: [embed] }).catch((error: unknown) => {
    console.error("moderation: failed to post to the mod log channel:", error);
  });
}
