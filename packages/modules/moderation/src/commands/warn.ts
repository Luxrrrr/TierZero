import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import type { CommandDefinition } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { guardAgainstMember } from "../hierarchy-guard.js";
import { recordInfraction } from "../infractions.js";
import { formatDirectMessage } from "../modlog.js";
import { tryDirectMessage } from "../dm.js";
import { postModLog, replyError, replyReasonRequired } from "../reply.js";

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
    const reason = interaction.options.getString("reason");
    if (ctx.settings.requireReason && !reason) {
      await replyReasonRequired(interaction);
      return;
    }

    const guild = ctx.guild;
    const targetMember = await guild.members.fetch(target.id).catch(() => null);
    if (!targetMember) {
      await replyError(interaction, "That user is not a member of this server.");
      return;
    }

    const actor = await guild.members.fetch(interaction.user.id);
    const verdict = guardAgainstMember(guild, actor, targetMember, false);
    if (!verdict.allowed) {
      await replyError(interaction, verdict.reason);
      return;
    }

    if (ctx.settings.dmOnAction) {
      await tryDirectMessage(
        ctx.client,
        target.id,
        formatDirectMessage(guild.name, { action: "warn", reason, expiresAt: null }),
      );
    }

    const record = await recordInfraction({
      guildId: guild.id,
      userId: target.id,
      moderatorId: interaction.user.id,
      action: "warn",
      reason,
    });

    await postModLog(ctx, {
      caseNumber: record.caseNumber,
      action: "warn",
      targetId: target.id,
      moderatorId: interaction.user.id,
      reason,
      expiresAt: null,
    });

    await interaction.reply({
      content: `Warned ${target.username}. Case #${record.caseNumber}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
