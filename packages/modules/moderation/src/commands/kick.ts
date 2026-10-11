import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import type { CommandDefinition } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { runFromCommand } from "./run-action.js";

export const kickCommand: CommandDefinition<ModerationSettings> = {
  name: "kick",
  description: "Remove a member from the server.",
  build: () =>
    new SlashCommandBuilder()
      .setName("kick")
      .setDescription("Remove a member from the server.")
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
      .addUserOption((option) =>
        option.setName("member").setDescription("Who to kick").setRequired(true),
      )
      .addStringOption((option) =>
        option.setName("reason").setDescription("Why").setMaxLength(500),
      ),
  async run(interaction, ctx) {
    const target = interaction.options.getUser("member", true);
    const record = await runFromCommand(interaction, ctx, { action: "kick", target });
    if (!record) return;

    await interaction.reply({
      content: `Kicked ${target.username}. Case #${record.caseNumber}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
