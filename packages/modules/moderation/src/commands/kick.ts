import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import { plainReply, type CommandDefinition } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { runFromCommand } from "./run-action.js";

export const kickCommand: CommandDefinition<ModerationSettings> = {
  name: "kick",
  response: {
    starting: plainReply("Kicked {user}. Case #{case}."),
    placeholders: [
      { name: "user", description: "The member's username", sample: "spamlord_42" },
      { name: "case", description: "The case number", sample: "118" },
    ],
  },
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

    const custom = ctx.customReply?.({ user: target.username, case: record.caseNumber });
    await interaction.reply({
      ...(custom ?? { content: `Kicked ${target.username}. Case #${record.caseNumber}.` }),
      flags: MessageFlags.Ephemeral,
    });
  },
};
