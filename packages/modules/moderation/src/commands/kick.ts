import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import type { CommandDefinition } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { guardAgainstMember } from "../hierarchy-guard.js";
import { recordInfraction } from "../infractions.js";
import { formatDirectMessage } from "../modlog.js";
import { tryDirectMessage } from "../dm.js";
import { postModLog, replyError, replyReasonRequired } from "../reply.js";

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
    const verdict = guardAgainstMember(guild, actor, targetMember);
    if (!verdict.allowed) {
      await replyError(interaction, verdict.reason);
      return;
    }

    // Sent before the kick: once the member leaves, the bot may no longer
    // share a server with them and could lose the ability to open a DM at all.
    if (ctx.settings.dmOnAction) {
      await tryDirectMessage(
        ctx.client,
        target.id,
        formatDirectMessage(guild.name, { action: "kick", reason, expiresAt: null }),
      );
    }

    try {
      await targetMember.kick(reason ?? undefined);
    } catch {
      await replyError(interaction, "I could not kick that member. Check that my role is above theirs.");
      return;
    }

    const record = await recordInfraction({
      guildId: guild.id,
      userId: target.id,
      moderatorId: interaction.user.id,
      action: "kick",
      reason,
    });

    await postModLog(ctx, {
      caseNumber: record.caseNumber,
      action: "kick",
      targetId: target.id,
      moderatorId: interaction.user.id,
      reason,
      expiresAt: null,
    });

    await interaction.reply({
      content: `Kicked ${target.username}. Case #${record.caseNumber}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
