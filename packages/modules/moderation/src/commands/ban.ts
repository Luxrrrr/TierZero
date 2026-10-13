import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { embedReply, type CommandDefinition, type ResponseTemplate } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { parseDuration } from "../duration.js";
import { fillLabel } from "../texts.js";
import { answer } from "./answer.js";
import { runFromCommand } from "./run-action.js";

const BAN_REPLY: ResponseTemplate = {
  starting: embedReply("Banned {user}. Case #{case}.{expiry}", "success"),
  placeholders: [
    { name: "user", description: "The member's username", sample: "spamlord_42" },
    { name: "case", description: "The case number", sample: "118" },
    { name: "expiry", description: "A note when the ban is temporary, otherwise empty", sample: " It expires in 7 days." },
  ],
};

export const banCommand: CommandDefinition<ModerationSettings> = {
  name: "ban",
  response: BAN_REPLY,
  description: "Ban a member, permanently or for a fixed duration.",
  build: () =>
    new SlashCommandBuilder()
      .setName("ban")
      .setDescription("Ban a member, permanently or for a fixed duration.")
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addUserOption((option) =>
        option.setName("member").setDescription("Who to ban").setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("duration")
          .setDescription("How long, e.g. 1d, 7d. Leave unset for a permanent ban."),
      )
      .addStringOption((option) =>
        option.setName("reason").setDescription("Why").setMaxLength(500),
      ),
  async run(interaction, ctx) {
    const target = interaction.options.getUser("member", true);
    const durationInput = interaction.options.getString("duration");
    const durationMs = durationInput === null ? null : parseDuration(durationInput);

    const record = await runFromCommand(interaction, ctx, {
      action: "ban",
      target,
      durationMs,
      unreadableDuration: durationInput !== null && durationMs === null,
    });
    if (!record) return;

    const expiry = record.expiresAt
      ? ` ${fillLabel(ctx.settings.labels.notes.banExpires, { when: `<t:${Math.floor(record.expiresAt.getTime() / 1000)}:R>` })}`
      : "";
    await answer(interaction, ctx, BAN_REPLY, { user: target.username, case: record.caseNumber, expiry });
  },
};
