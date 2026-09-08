import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } from "discord.js";
import type { CommandDefinition } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { findByCaseNumber } from "../infractions.js";
import { formatModLogEntry } from "../modlog.js";
import { replyError } from "../reply.js";

export const caseCommand: CommandDefinition<ModerationSettings> = {
  name: "case",
  description: "Show one moderation case.",
  build: () =>
    new SlashCommandBuilder()
      .setName("case")
      .setDescription("Show one moderation case.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addIntegerOption((option) =>
        option.setName("number").setDescription("Case number").setRequired(true).setMinValue(1),
      ),
  async run(interaction, ctx) {
    const number = interaction.options.getInteger("number", true);
    const record = await findByCaseNumber(ctx.guild.id, number);
    if (!record) {
      await replyError(interaction, `There is no case #${number}.`);
      return;
    }

    const view = formatModLogEntry({
      caseNumber: record.caseNumber,
      action: record.action,
      targetId: record.userId,
      moderatorId: record.moderatorId,
      reason: record.reason,
      expiresAt: record.expiresAt,
    });

    const embed = new EmbedBuilder().setTitle(view.title).addFields(view.fields).setTimestamp(record.createdAt);
    if (!record.active) {
      embed.setFooter({ text: "This action has since been reversed." });
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
