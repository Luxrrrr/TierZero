import { EmbedBuilder, MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import type { ModuleContext } from "@tier0/core";
import type { ModerationSettings } from "./settings.js";
import { formatModLogEntry, type ModLogEntry } from "./modlog.js";
import type { ModLogOutcome } from "./action-rules.js";

/** A user-facing failure. Always ephemeral, and always sent before any reply. */
export async function replyError(
  interaction: ChatInputCommandInteraction,
  message: string,
): Promise<void> {
  await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
}

/** Posts to the configured mod log channel. A no-op when none is set; never throws. */
export async function postModLog(
  ctx: ModuleContext<ModerationSettings>,
  entry: ModLogEntry,
): Promise<ModLogOutcome> {
  const channelId = ctx.settings.modLogChannel;
  if (!channelId) return "unset";

  const channel = ctx.guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return "missing";

  const view = formatModLogEntry(entry);
  const embed = new EmbedBuilder().setTitle(view.title).addFields(view.fields).setTimestamp();

  try {
    await channel.send({ embeds: [embed] });
    return "posted";
  } catch (error) {
    console.error("moderation: failed to post to the mod log channel:", error);
    return "failed";
  }
}
