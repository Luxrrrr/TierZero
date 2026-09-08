import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } from "discord.js";
import type { CommandDefinition } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { historyFor } from "../infractions.js";
import { actionLabel } from "../modlog.js";

export const historyCommand: CommandDefinition<ModerationSettings> = {
  name: "history",
  description: "List a member's moderation history.",
  build: () =>
    new SlashCommandBuilder()
      .setName("history")
      .setDescription("List a member's moderation history.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((option) =>
        option.setName("member").setDescription("Who").setRequired(true),
      ),
  async run(interaction, ctx) {
    const target = interaction.options.getUser("member", true);
    const records = await historyFor(ctx.guild.id, target.id);

    if (records.length === 0) {
      await interaction.reply({
        content: `${target.username} has no recorded history.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const lines = records.map((record) => {
      const seconds = Math.floor(record.createdAt.getTime() / 1000);
      const status = record.active ? "" : " (reversed)";
      const reason = record.reason ?? "No reason given";
      return `**#${record.caseNumber}** ${actionLabel(record.action)}${status} - ${reason} - <t:${seconds}:d>`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`Moderation history for ${target.username}`)
      .setDescription(lines.join("\n"));

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
