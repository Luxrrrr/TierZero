import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } from "discord.js";
import type { CommandDefinition } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { historyFor } from "../infractions.js";
import { actionLabel } from "../modlog.js";

/** The embed /history and the right-click menu both show, or null when the member has no record. */
export async function historyEmbed(guildId: string, userId: string, username: string): Promise<EmbedBuilder | null> {
  const records = await historyFor(guildId, userId);
  if (records.length === 0) return null;

  const lines = records.map((record) => {
    const seconds = Math.floor(record.createdAt.getTime() / 1000);
    const status = record.active ? "" : " (reversed)";
    const reason = record.reason ?? "No reason given";
    return `**#${record.caseNumber}** ${actionLabel(record.action)}${status} - ${reason} - <t:${seconds}:d>`;
  });

  return new EmbedBuilder().setTitle(`Moderation history for ${username}`).setDescription(lines.join("\n"));
}

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
    const embed = await historyEmbed(ctx.guild.id, target.id, target.username);

    if (!embed) {
      await interaction.reply({
        content: `${target.username} has no recorded history.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
