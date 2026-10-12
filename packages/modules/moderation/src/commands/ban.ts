import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import { plainReply, type CommandDefinition } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { parseDuration } from "../duration.js";
import { runFromCommand } from "./run-action.js";

export const banCommand: CommandDefinition<ModerationSettings> = {
  name: "ban",
  response: {
    starting: plainReply("Banned {user}. Case #{case}.{expiry}"),
    placeholders: [
      { name: "user", description: "The member's username", sample: "spamlord_42" },
      { name: "case", description: "The case number", sample: "118" },
      { name: "expiry", description: "A note when the ban is temporary, otherwise empty", sample: " It expires in 7 days." },
    ],
  },
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
      unreadableDuration:
        durationInput !== null && durationMs === null ? "Duration must look like 1d or 7d." : undefined,
    });
    if (!record) return;

    const durationNote = record.expiresAt
      ? ` It expires <t:${Math.floor(record.expiresAt.getTime() / 1000)}:R>.`
      : "";
    const custom = ctx.customReply?.({ user: target.username, case: record.caseNumber, expiry: durationNote });
    await interaction.reply({
      ...(custom ?? { content: `Banned ${target.username}. Case #${record.caseNumber}.${durationNote}` }),
      flags: MessageFlags.Ephemeral,
    });
  },
};
