import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { embedReply, type CommandDefinition, type ResponseTemplate } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { answer } from "./answer.js";
import { runFromCommand } from "./run-action.js";

const UNBAN_REPLY: ResponseTemplate = {
  starting: embedReply("Unbanned {user}. Case #{case}.", "success"),
  placeholders: [
    { name: "user", description: "The member's username", sample: "spamlord_42" },
    { name: "case", description: "The case number", sample: "118" },
  ],
};

export const unbanCommand: CommandDefinition<ModerationSettings> = {
  name: "unban",
  response: UNBAN_REPLY,
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

    await answer(interaction, ctx, UNBAN_REPLY, { user: target.username, case: record.caseNumber });
  },
};
