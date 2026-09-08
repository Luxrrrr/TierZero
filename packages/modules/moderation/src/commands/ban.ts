import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import type { CommandDefinition } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { guardAgainstMember } from "../hierarchy-guard.js";
import { deleteMessageSeconds, parseDuration, validateBanDuration } from "../duration.js";
import { recordInfraction } from "../infractions.js";
import { formatDirectMessage } from "../modlog.js";
import { tryDirectMessage } from "../dm.js";
import { postModLog, replyError, replyReasonRequired } from "../reply.js";

export const banCommand: CommandDefinition<ModerationSettings> = {
  name: "ban",
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
    const reason = interaction.options.getString("reason");
    const durationInput = interaction.options.getString("duration");
    if (ctx.settings.requireReason && !reason) {
      await replyReasonRequired(interaction);
      return;
    }

    const guild = ctx.guild;

    const existingBan = await guild.bans.fetch(target.id).catch(() => null);
    if (existingBan) {
      await replyError(interaction, `${target.username} is already banned. Use /unban first to change it.`);
      return;
    }

    let expiresAt: Date | null = null;
    if (durationInput !== null) {
      const ms = parseDuration(durationInput);
      if (ms === null) {
        await replyError(interaction, "Duration must look like 1d or 7d.");
        return;
      }
      const check = validateBanDuration(ms);
      if (!check.ok) {
        await replyError(interaction, check.reason);
        return;
      }
      expiresAt = new Date(Date.now() + check.ms);
    }

    // A departed member has no roles left to weigh against the moderator's or
    // the bot's, so the hierarchy check only applies while they are still here.
    const targetMember = await guild.members.fetch(target.id).catch(() => null);
    if (targetMember) {
      const actor = await guild.members.fetch(interaction.user.id);
      const verdict = guardAgainstMember(guild, actor, targetMember);
      if (!verdict.allowed) {
        await replyError(interaction, verdict.reason);
        return;
      }
    }

    // Sent before the ban: afterwards the bot may no longer share a server
    // with this member and could lose the ability to open a DM at all.
    if (ctx.settings.dmOnAction) {
      await tryDirectMessage(
        ctx.client,
        target.id,
        formatDirectMessage(guild.name, { action: "ban", reason, expiresAt }),
      );
    }

    try {
      await guild.members.ban(target.id, {
        reason: reason ?? undefined,
        deleteMessageSeconds: deleteMessageSeconds(ctx.settings.deleteMessageDays),
      });
    } catch {
      await replyError(interaction, "I could not ban that member. Check that my role is above theirs.");
      return;
    }

    const record = await recordInfraction({
      guildId: guild.id,
      userId: target.id,
      moderatorId: interaction.user.id,
      action: "ban",
      reason,
      expiresAt,
    });

    if (expiresAt) {
      await ctx.tasks.schedule("unban", expiresAt, { userId: target.id });
    }

    await postModLog(ctx, {
      caseNumber: record.caseNumber,
      action: "ban",
      targetId: target.id,
      moderatorId: interaction.user.id,
      reason,
      expiresAt,
    });

    const durationNote = expiresAt
      ? ` It expires <t:${Math.floor(expiresAt.getTime() / 1000)}:R>.`
      : "";
    await interaction.reply({
      content: `Banned ${target.username}. Case #${record.caseNumber}.${durationNote}`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
