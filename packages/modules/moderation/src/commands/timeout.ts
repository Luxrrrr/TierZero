import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import type { CommandDefinition, ModuleContext } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { guardAgainstMember } from "../hierarchy-guard.js";
import { parseDuration, validateTimeoutDuration } from "../duration.js";
import { deactivateOpen, recordInfraction } from "../infractions.js";
import { formatDirectMessage } from "../modlog.js";
import { tryDirectMessage } from "../dm.js";
import { postModLog, replyError, replyReasonRequired } from "../reply.js";

type Ctx = ModuleContext<ModerationSettings>;

async function runSet(interaction: ChatInputCommandInteraction, ctx: Ctx): Promise<void> {
  const target = interaction.options.getUser("member", true);
  const reason = interaction.options.getString("reason");
  const durationInput = interaction.options.getString("duration");
  if (ctx.settings.requireReason && !reason) {
    await replyReasonRequired(interaction);
    return;
  }

  const ms = durationInput === null ? ctx.settings.defaultTimeoutDuration : parseDuration(durationInput);
  if (ms === null) {
    await replyError(interaction, "Duration must look like 10m, 2h or 7d.");
    return;
  }
  const check = validateTimeoutDuration(ms);
  if (!check.ok) {
    await replyError(interaction, check.reason);
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

  const expiresAt = new Date(Date.now() + check.ms);

  if (ctx.settings.dmOnAction) {
    await tryDirectMessage(
      ctx.client,
      target.id,
      formatDirectMessage(guild.name, { action: "timeout", reason, expiresAt }),
    );
  }

  try {
    await targetMember.timeout(check.ms, reason ?? undefined);
  } catch {
    await replyError(interaction, "I could not time that member out. Check that my role is above theirs.");
    return;
  }

  const record = await recordInfraction({
    guildId: guild.id,
    userId: target.id,
    moderatorId: interaction.user.id,
    action: "timeout",
    reason,
    expiresAt,
  });

  await postModLog(ctx, {
    caseNumber: record.caseNumber,
    action: "timeout",
    targetId: target.id,
    moderatorId: interaction.user.id,
    reason,
    expiresAt,
  });

  await interaction.reply({
    content: `Timed out ${target.username} until <t:${Math.floor(expiresAt.getTime() / 1000)}:f>. Case #${record.caseNumber}.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function runClear(interaction: ChatInputCommandInteraction, ctx: Ctx): Promise<void> {
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

  try {
    await targetMember.timeout(null, reason ?? undefined);
  } catch {
    await replyError(interaction, "I could not clear that timeout. Check my permissions.");
    return;
  }

  await deactivateOpen(guild.id, target.id, "timeout");

  const record = await recordInfraction({
    guildId: guild.id,
    userId: target.id,
    moderatorId: interaction.user.id,
    action: "timeout-clear",
    reason,
  });

  if (ctx.settings.dmOnAction) {
    await tryDirectMessage(
      ctx.client,
      target.id,
      formatDirectMessage(guild.name, { action: "timeout-clear", reason, expiresAt: null }),
    );
  }

  await postModLog(ctx, {
    caseNumber: record.caseNumber,
    action: "timeout-clear",
    targetId: target.id,
    moderatorId: interaction.user.id,
    reason,
    expiresAt: null,
  });

  await interaction.reply({
    content: `Cleared ${target.username}'s timeout. Case #${record.caseNumber}.`,
    flags: MessageFlags.Ephemeral,
  });
}

export const timeoutCommand: CommandDefinition<ModerationSettings> = {
  name: "timeout",
  description: "Time a member out, or lift an existing timeout.",
  build: () =>
    new SlashCommandBuilder()
      .setName("timeout")
      .setDescription("Time a member out, or lift an existing timeout.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addSubcommand((sub) =>
        sub
          .setName("set")
          .setDescription("Time a member out.")
          .addUserOption((option) =>
            option.setName("member").setDescription("Who to time out").setRequired(true),
          )
          .addStringOption((option) =>
            option
              .setName("duration")
              .setDescription("How long, e.g. 10m, 2h, 7d. Defaults to the server's setting."),
          )
          .addStringOption((option) =>
            option.setName("reason").setDescription("Why").setMaxLength(500),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("clear")
          .setDescription("Lift a member's timeout.")
          .addUserOption((option) =>
            option.setName("member").setDescription("Who to clear").setRequired(true),
          )
          .addStringOption((option) =>
            option.setName("reason").setDescription("Why").setMaxLength(500),
          ),
      ),
  async run(interaction, ctx) {
    const sub = interaction.options.getSubcommand(true);
    if (sub === "set") {
      await runSet(interaction, ctx);
    } else {
      await runClear(interaction, ctx);
    }
  },
};
