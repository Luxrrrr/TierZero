import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import type { CommandDefinition } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { runFromCommand } from "./run-action.js";

export const warnCommand: CommandDefinition<ModerationSettings> = {
  name: "warn",
  description: "Log a warning against a member.",
  build: () =>
    new SlashCommandBuilder()
      .setName("warn")
      .setDescription("Log a warning against a member.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((option) =>
        option.setName("member").setDescription("Who to warn").setRequired(true),
      )
      .addStringOption((option) =>
        option.setName("reason").setDescription("Why").setMaxLength(500),
      ),
  async run(interaction, ctx) {
    const target = interaction.options.getUser("member", true);
    const record = await runFromCommand(interaction, ctx, { action: "warn", target });
    if (!record) return;

    await interaction.reply({
      content: `Warned ${target.username}. Case #${record.caseNumber}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
