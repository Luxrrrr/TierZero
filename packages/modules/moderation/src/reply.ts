import { MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import type { ModuleContext } from "@tier0/core";
import type { ModerationSettings } from "./settings.js";
import { noticeValues, type ModLogEntry } from "./modlog.js";
import { MODLOG_MESSAGE } from "./messages.js";
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

  // A failed send is logged by ctx.send, which also falls back to the stock post if the owner's no longer fits.
  const links = { guildId: ctx.guild.id, dashboardBase: await ctx.dashboardUrl() };
  const sent = await ctx.send(channel, ctx.settings.modLogMessage, noticeValues({ ...entry, links }), { fallback: MODLOG_MESSAGE });
  return sent ? "posted" : "failed";
}
