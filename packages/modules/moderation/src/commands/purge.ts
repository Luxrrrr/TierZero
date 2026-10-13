import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import type { CommandDefinition } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { BULK_DELETE_WINDOW_MS } from "../duration.js";
import { PURGE_REPLY } from "../messages.js";
import { auditPurge } from "../purge-audit.js";

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
      await interaction.reply({
        content: "You need the Manage Messages permission to delete messages.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channel = await ctx.guild.channels.fetch(interaction.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      await interaction.reply({
        content: "This command only works in a server text channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const fetched = await channel.messages.fetch({ limit: count });
    const cutoff = Date.now() - BULK_DELETE_WINDOW_MS;
    const eligible = fetched.filter((message) => message.createdTimestamp > cutoff);
    const skipped = fetched.size - eligible.size;

    if (eligible.size === 0) {
      await interaction.editReply(
        "None of those messages can be bulk deleted: Discord only allows deleting messages sent in the last 14 days.",
      );
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
      await interaction.editReply("I could not delete those messages. Check my permissions in this channel.");
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

    const skippedNote =
      skipped > 0
        ? ` ${skipped} message${skipped === 1 ? " was" : "s were"} left because ${skipped === 1 ? "it is" : "they are"} older than 14 days.`
        : "";
    const messages = `${deletedCount} message${deletedCount === 1 ? "" : "s"}`;
    // The reply was deferred as ephemeral, and an edit cannot change that.
    const { flags: _flags, ...custom } = ctx.customReply?.({ count: deletedCount, messages, skippedNote }) ?? {};
    await interaction.editReply(Object.keys(custom).length > 0 ? custom : `Deleted ${messages}.${skippedNote}`);
  },
};
