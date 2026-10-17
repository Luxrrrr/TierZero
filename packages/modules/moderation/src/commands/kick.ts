import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { embedReply, type CommandDefinition, type ResponseTemplate } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { answer } from "./answer.js";
import { runFromCommand, suggestReasons } from "./run-action.js";

const KICK_REPLY: ResponseTemplate = {
  starting: embedReply("Kicked {user}. Case #{case}.", "success"),
  placeholders: [
    { name: "user", description: "The member's username", sample: "spamlord_42" },
    { name: "case", description: "The case number", sample: "118" },
  ],
};

export const kickCommand: CommandDefinition<ModerationSettings> = {
  name: "kick",
  response: KICK_REPLY,
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
        option.setName("reason").setDescription("Why, or pick one of the server's presets").setMaxLength(500).setAutocomplete(true),
      ),
  autocomplete: suggestReasons,
  async run(interaction, ctx) {
    const target = interaction.options.getUser("member", true);
    const record = await runFromCommand(interaction, ctx, { action: "kick", target });
    if (!record) return;

    await answer(interaction, ctx, KICK_REPLY, { user: target.username, case: record.caseNumber });
  },
};
