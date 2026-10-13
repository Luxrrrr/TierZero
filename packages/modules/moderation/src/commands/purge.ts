import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import type { CommandDefinition } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { BULK_DELETE_WINDOW_MS } from "../duration.js";
import { PURGE_REPLY } from "../messages.js";
import { auditPurge } from "../purge-audit.js";
import { say } from "../reply.js";
import { fillLabel } from "../texts.js";

export const purgeCommand: CommandDefinition<ModerationSettings> = {
  name: "purge",
  response: PURGE_REPLY,
  description: "Bulk delete recent messages in this channel.",
  build: () =>
    new SlashCommandBuilder()
      .setName("purge")
      .setDescription("Bulk delete recent messages in this channel.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addIntegerOption((option) =>
        option
          .setName("count")
          .setDescription("How many recent messages, 1-100")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(100),
      ),
  async run(interaction, ctx) {
    const count = interaction.options.getInteger("count", true);

    // The command is only hidden from people without the permission by default; an operator can widen it.
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await say(ctx, interaction, "purge", "purgeNeedsPermission");
      return;
    }

    const channel = await ctx.guild.channels.fetch(interaction.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      await say(ctx, interaction, "purge", "purgeWrongChannel");
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const fetched = await channel.messages.fetch({ limit: count });
    const cutoff = Date.now() - BULK_DELETE_WINDOW_MS;
    const eligible = fetched.filter((message) => message.createdTimestamp > cutoff);
    const skipped = fetched.size - eligible.size;

    if (eligible.size === 0) {
      await say(ctx, interaction, "purge", "purgeNothingEligible");
      return;
    }

    let deletedCount: number;
    try {
      if (eligible.size === 1) {
        const only = eligible.first();
        await only?.delete();
        deletedCount = only ? 1 : 0;
      } else {
        const deleted = await channel.bulkDelete(eligible, false);
        deletedCount = deleted.size;
      }
    } catch (error) {
      console.error("moderation: purge failed:", error);
      await say(ctx, interaction, "purge", "purgeFailed");
      return;
    }

    if (deletedCount > 0) {
      await auditPurge({
        guildId: ctx.guild.id,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
        channelId: interaction.channelId,
        channelName: "name" in channel && typeof channel.name === "string" ? channel.name : "",
        deleted: deletedCount,
      });
    }

    const { counts } = ctx.settings.labels;
    const skippedNote = skipped > 0 ? ` ${fillLabel(skipped === 1 ? counts.skippedOne : counts.skippedMany, { count: skipped })}` : "";
    const messages = fillLabel(deletedCount === 1 ? counts.messageOne : counts.messageMany, { count: deletedCount });
    const values = { count: deletedCount, messages, skippedNote };
    // The reply was deferred as ephemeral, and an edit cannot change that.
    const { flags: _flags, ...custom } = ctx.customReply?.(values) ?? {};
    if (Object.keys(custom).length > 0) {
      await interaction.editReply(custom);
      return;
    }
    await ctx.reply(interaction, PURGE_REPLY.starting, values);
  },
};
