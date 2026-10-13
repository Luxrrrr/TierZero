import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { embedReply, type CommandDefinition, type ResponseTemplate } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { answer } from "./answer.js";
import { runFromCommand } from "./run-action.js";

const WARN_REPLY: ResponseTemplate = {
  starting: embedReply("Warned {user}. Case #{case}.", "success"),
  placeholders: [
    { name: "user", description: "The member's username", sample: "spamlord_42" },
    { name: "case", description: "The case number", sample: "118" },
  ],
};

export const warnCommand: CommandDefinition<ModerationSettings> = {
  name: "warn",
  response: WARN_REPLY,
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

    await answer(interaction, ctx, WARN_REPLY, { user: target.username, case: record.caseNumber });
  },
};
