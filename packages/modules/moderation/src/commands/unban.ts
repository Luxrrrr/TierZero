import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import type { CommandDefinition } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { runFromCommand } from "./run-action.js";

export const unbanCommand: CommandDefinition<ModerationSettings> = {
  name: "unban",
  description: "Lift a ban.",
  build: () =>
    new SlashCommandBuilder()
      .setName("unban")
      .setDescription("Lift a ban.")
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addUserOption((option) =>
        option.setName("member").setDescription("Who to unban").setRequired(true),
      )
      .addStringOption((option) =>
        option.setName("reason").setDescription("Why").setMaxLength(500),
      ),
  async run(interaction, ctx) {
    const target = interaction.options.getUser("member", true);
    const record = await runFromCommand(interaction, ctx, { action: "unban", target });
    if (!record) return;

    await interaction.reply({
      content: `Unbanned ${target.username}. Case #${record.caseNumber}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
