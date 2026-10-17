import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { can, type CommandDefinition, type ModuleContext } from "@tier0/core";
import type { ModerationSettings } from "../settings.js";
import { parseDuration } from "../duration.js";
import { botCanLock, lockChannels, unlockChannels, type LockResult } from "../lockdown.js";
import { say } from "../reply.js";
import { staffRoleOf } from "../staff.js";
import { fillLabel } from "../texts.js";
import { auditLockdown } from "../raid-audit.js";

type Ctx = ModuleContext<ModerationSettings>;

/** The longest a lockdown can be given from the command. Longer is still possible by leaving it open. */
const MAX_LOCK_MS = 7 * 86_400_000;

const CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
] as const;

/** Holding Manage Channels, or an admin place on the staff list, is what lets someone lock channels. */
async function mayLock(interaction: ChatInputCommandInteraction, ctx: Ctx): Promise<boolean> {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) return true;
  const role = await staffRoleOf(ctx.guild.id, interaction.user.id);
  return role !== null && can(role, "raid.lockdown");
}

function channelCount(ctx: Ctx, count: number): string {
  const { counts } = ctx.settings.labels;
  return fillLabel(count === 1 ? counts.channelOne : counts.channelMany, { count });
}

function skippedNote(ctx: Ctx, result: LockResult): string {
  return result.failed.length === 0 ? "" : ` ${fillLabel(ctx.settings.labels.counts.lockSkipped, { count: channelCount(ctx, result.failed.length) })}`;
}

async function start(interaction: ChatInputCommandInteraction, ctx: Ctx, everywhere: boolean): Promise<void> {
  if (!botCanLock(ctx.guild)) return say(ctx, interaction, "raid", "lockdownNeedsPermission");
  const durationInput = interaction.options.getString("duration");
  const durationMs = durationInput === null ? null : parseDuration(durationInput);
  if (durationInput !== null && (durationMs === null || durationMs <= 0)) return say(ctx, interaction, "refusals", "durationUnreadableBan");
  const reason = interaction.options.getString("reason")?.trim() || null;
  const channelId = everywhere ? null : (interaction.options.getChannel("channel")?.id ?? interaction.channelId);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const endsAt = durationMs === null ? null : new Date(Date.now() + Math.min(durationMs, MAX_LOCK_MS));
  const result = await lockChannels(ctx, { channels: channelId ? [channelId] : "all", actorId: interaction.user.id, reason, endsAt });
  if (result.changed.length === 0 && result.failed.length === 0) return say(ctx, interaction, "raid", "lockdownNothingToLock");
  await auditLockdown(ctx, { actorId: interaction.user.id, actorName: interaction.user.username, locked: true, result, reason });
  await say(ctx, interaction, "raid", "lockdownStarted", { count: channelCount(ctx, result.changed.length), skippedNote: skippedNote(ctx, result) });
}

async function end(interaction: ChatInputCommandInteraction, ctx: Ctx): Promise<void> {
  if (!botCanLock(ctx.guild)) return say(ctx, interaction, "raid", "lockdownNeedsPermission");
  const channel = interaction.options.getChannel("channel");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await unlockChannels(ctx, channel ? [channel.id] : "all");
  if (result.changed.length === 0 && result.failed.length === 0) return say(ctx, interaction, "raid", "lockdownNothingLocked");
  await auditLockdown(ctx, { actorId: interaction.user.id, actorName: interaction.user.username, locked: false, result, reason: null });
  await say(ctx, interaction, "raid", "lockdownEnded", { count: channelCount(ctx, result.changed.length), skippedNote: skippedNote(ctx, result) });
}

export const lockdownCommand: CommandDefinition<ModerationSettings> = {
  name: "lockdown",
  description: "Stop members talking in one channel or every channel, and let them again.",
  build: () =>
    new SlashCommandBuilder()
      .setName("lockdown")
      .setDescription("Stop members talking in one channel or every channel, and let them again.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addSubcommand((sub) =>
        sub
          .setName("channel")
          .setDescription("Lock one channel.")
          .addChannelOption((option) => option.setName("channel").setDescription("Which channel. Leave it out for this one.").addChannelTypes(...CHANNEL_TYPES))
          .addStringOption((option) => option.setName("duration").setDescription("Unlock by itself after this long, e.g. 30m, 2h. Leave it out to keep it locked."))
          .addStringOption((option) => option.setName("reason").setDescription("Why").setMaxLength(300)),
      )
      .addSubcommand((sub) =>
        sub
          .setName("server")
          .setDescription("Lock every channel members can talk in, except those the settings leave alone.")
          .addStringOption((option) => option.setName("duration").setDescription("Unlock by itself after this long, e.g. 30m, 2h. Leave it out to keep it locked."))
          .addStringOption((option) => option.setName("reason").setDescription("Why").setMaxLength(300)),
      )
      .addSubcommand((sub) =>
        sub
          .setName("end")
          .setDescription("Unlock what the bot locked.")
          .addChannelOption((option) => option.setName("channel").setDescription("Only this channel. Leave it out to unlock every one.").addChannelTypes(...CHANNEL_TYPES)),
      ),
  async run(interaction, ctx) {
    if (!(await mayLock(interaction, ctx))) return say(ctx, interaction, "raid", "lockdownNotAllowed");
    const sub = interaction.options.getSubcommand(true);
    if (sub === "end") return end(interaction, ctx);
    return start(interaction, ctx, sub === "server");
  },
};
