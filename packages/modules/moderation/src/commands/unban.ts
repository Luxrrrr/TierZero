import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import type { CommandDefinition } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { deactivateOpen, recordInfraction } from "../infractions.js";
import { formatDirectMessage } from "../modlog.js";
import { tryDirectMessage } from "../dm.js";
import { postModLog, replyError, replyReasonRequired } from "../reply.js";

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
    const reason = interaction.options.getString("reason");
    if (ctx.settings.requireReason && !reason) {
      await replyReasonRequired(interaction);
      return;
    }

    const guild = ctx.guild;

    const ban = await guild.bans.fetch(target.id).catch(() => null);
    if (!ban) {
      await replyError(interaction, `${target.username} is not banned.`);
      return;
    }

    try {
      await guild.members.unban(target.id, reason ?? undefined);
    } catch {
      await replyError(interaction, "I could not lift that ban. Check my permissions.");
      return;
    }

    // A ban issued for a fixed duration schedules its own reversal; lifting it
    // early must cancel that or the member gets banned again when it fires.
    await ctx.tasks.cancel("unban", { userId: target.id });
    await deactivateOpen(guild.id, target.id, "ban");

    const record = await recordInfraction({
      guildId: guild.id,
      userId: target.id,
      moderatorId: interaction.user.id,
      action: "unban",
      reason,
    });

    if (ctx.settings.dmOnAction) {
      await tryDirectMessage(
        ctx.client,
        target.id,
        formatDirectMessage(guild.name, { action: "unban", reason, expiresAt: null }),
      );
    }

    await postModLog(ctx, {
      caseNumber: record.caseNumber,
      action: "unban",
      targetId: target.id,
      moderatorId: interaction.user.id,
      reason,
      expiresAt: null,
    });

    await interaction.reply({
      content: `Unbanned ${target.username}. Case #${record.caseNumber}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
