import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import type { GuildMember } from "discord.js";
import { defineModule, isRoleAssignable, s } from "@tier0/core";
import type { Infer, ModuleContext } from "@tier0/core";
import { prisma } from "@tier0/db";
import {
  applyMultiplier,
  canAward,
  highestMultiplierPercent,
  levelForXp,
  progressFor,
  renderProgressBar,
  resolveRewardRoles,
  xpForMessage,
} from "./curve.js";

const settingsSchema = s.object({
  xp: s.object(
    {
      min: s.integer({ label: "Minimum experience per message", min: 1, max: 1000, default: 15 }),
      max: s.integer({ label: "Maximum experience per message", min: 1, max: 1000, default: 25 }),
    },
    {
      label: "Experience per message",
      help: "A random amount in this range is awarded, so activity cannot be gamed by sending identical short messages.",
    },
  ),
  cooldown: s.duration({
    label: "Cooldown between awards",
    help: "How long a member must wait between messages that earn experience.",
    default: "60s",
    max: "1h",
  }),
  announce: s.object(
    {
      channel: s.channel({
        label: "Announce level-ups in",
        types: ["text"],
        optional: true,
      }),
      message: s.template({
        label: "Level-up message",
        placeholders: ["user", "level"],
        default: "{user} reached level {level}!",
      }),
    },
    {
      label: "Level-up announcements",
      help: "Leave the channel unset to turn announcements off.",
    },
  ),
  roleRewards: s.array(
    s.object({
      level: s.integer({ label: "Level", min: 1 }),
      role: s.role({ label: "Role" }),
    }),
    {
      label: "Role rewards",
      help: "Roles granted automatically when a member reaches the given level.",
    },
  ),
  stackRewards: s.boolean({
    label: "Keep every earned reward role",
    help: "When off, only the highest reward a member qualifies for is kept, and lower ones are removed as they level up.",
    default: true,
  }),
  noXpChannels: s.array(s.channel({ types: ["text"] }), {
    label: "Channels that earn no experience",
  }),
  noXpRoles: s.array(s.role(), {
    label: "Roles that earn no experience",
  }),
  multipliers: s.array(
    s.object({
      role: s.role({ label: "Role" }),
      percent: s.integer({
        label: "Percent of normal experience",
        help: "100 is normal, 200 is double.",
        min: 0,
        max: 1000,
        default: 100,
      }),
    }),
    {
      label: "Experience multipliers",
      help: "A member with more than one of these roles gets the highest percentage that applies.",
    },
  ),
});

type Settings = Infer<typeof settingsSchema>;

const LEADERBOARD_PAGE_SIZE = 10;

/**
 * Timestamp of each member's last award, held in process memory rather than
 * the database. Every message in every guild consults this map first, and a
 * member still inside their cooldown returns here without prisma ever being
 * asked - the only way to keep the hot path to "the minimum possible work"
 * is to never touch the database for the common case at all.
 */
const lastAwardAt = new Map<string, number>();

// A long-running process would otherwise keep one entry per member who has
// ever posted. Clearing past this size trades a few members being eligible a
// little early for bounded memory, which a cooldown measured in tens of
// seconds makes unnoticeable.
const MAX_TRACKED_MEMBERS = 50_000;

function cooldownKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

export default defineModule({
  id: "leveling",
  name: "Leveling",
  summary: "Experience, levels and role rewards for active members.",
  category: "engagement",

  settings: settingsSchema,

  commands: [
    {
      name: "rank",
      description: "Show a member's level and experience.",
      build: () =>
        new SlashCommandBuilder()
          .setName("rank")
          .setDescription("Show a member's level and experience.")
          .addUserOption((option) =>
            option.setName("member").setDescription("Defaults to you."),
          ),
      async run(interaction, ctx) {
        const target = interaction.options.getUser("member") ?? interaction.user;
        const row = await prisma.levelMember.findUnique({
          where: { guildId_userId: { guildId: ctx.guild.id, userId: target.id } },
        });
        const xp = row?.xp ?? 0;
        const { level, into, need } = progressFor(xp);
        const rank = row
          ? (await prisma.levelMember.count({
              where: { guildId: ctx.guild.id, xp: { gt: xp } },
            })) + 1
          : null;

        const embed = new EmbedBuilder()
          .setTitle(`${target.username} - Level ${level}`)
          .setThumbnail(target.displayAvatarURL())
          .addFields(
            { name: "Experience", value: `${into} / ${need}`, inline: true },
            { name: "Rank", value: rank ? `#${rank}` : "Unranked", inline: true },
            { name: "Progress", value: renderProgressBar(into, need) },
          );

        await interaction.reply({ embeds: [embed] });
      },
    },
    {
      name: "leaderboard",
      description: "Show the server's experience leaderboard.",
      build: () =>
        new SlashCommandBuilder()
          .setName("leaderboard")
          .setDescription("Show the server's experience leaderboard.")
          .addIntegerOption((option) =>
            option
              .setName("page")
              .setDescription("Page number, starting at 1.")
              .setMinValue(1),
          ),
      async run(interaction, ctx) {
        const page = interaction.options.getInteger("page") ?? 1;
        // take/skip on the (guildId, xp) index, never the whole table, so
        // paging cost stays flat regardless of how many members have leveled.
        const rows = await prisma.levelMember.findMany({
          where: { guildId: ctx.guild.id },
          orderBy: { xp: "desc" },
          skip: (page - 1) * LEADERBOARD_PAGE_SIZE,
          take: LEADERBOARD_PAGE_SIZE,
        });

        if (rows.length === 0) {
          await interaction.reply({
            content:
              page === 1
                ? "Nobody has earned experience here yet."
                : "There is no page that far into the leaderboard.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        // One batched fetch for every name on the page rather than one call
        // per row.
        const members = await ctx.guild.members
          .fetch({ user: rows.map((row) => row.userId) })
          .catch(() => null);

        const lines = rows.map((row, index) => {
          const name = members?.get(row.userId)?.displayName ?? `<@${row.userId}>`;
          const position = (page - 1) * LEADERBOARD_PAGE_SIZE + index + 1;
          return `**${position}.** ${name} - level ${row.level} (${row.xp} xp)`;
        });

        const embed = new EmbedBuilder()
          .setTitle(`${ctx.guild.name} leaderboard`)
          .setDescription(lines.join("\n"))
          .setFooter({ text: `Page ${page}` });

        await interaction.reply({ embeds: [embed] });
      },
    },
  ],

  events: {
    async messageCreate(message, ctx) {
      const member = message.member;
      // Guild messages normally carry the member Discord sent along with the
      // event; if it is missing there is no roster to check exclusions or
      // multipliers against, and fetching one over the API on every message
      // would defeat the point of keeping this path cheap.
      if (!member) return;

      const settings = ctx.settings;
      if (settings.noXpChannels.includes(message.channelId)) return;
      if (member.roles.cache.some((role) => settings.noXpRoles.includes(role.id))) return;

      const key = cooldownKey(ctx.guild.id, member.id);
      const now = Date.now();
      const last = lastAwardAt.get(key);
      if (last !== undefined && !canAward(last, now, settings.cooldown)) return;

      lastAwardAt.set(key, now);
      if (lastAwardAt.size > MAX_TRACKED_MEMBERS) lastAwardAt.clear();

      const roleIds = member.roles.cache.map((role) => role.id);
      const percent = highestMultiplierPercent(roleIds, settings.multipliers);
      const gained = applyMultiplier(xpForMessage(settings.xp.min, settings.xp.max), percent);
      if (gained <= 0) return;

      // The one write every awarding message makes: an increment, never a
      // read followed by a write.
      const row = await prisma.levelMember.upsert({
        where: { guildId_userId: { guildId: ctx.guild.id, userId: member.id } },
        create: { guildId: ctx.guild.id, userId: member.id, xp: gained, lastAwardAt: new Date(now) },
        update: { xp: { increment: gained }, lastAwardAt: new Date(now) },
      });

      const newLevel = levelForXp(row.xp);
      if (newLevel === row.level) return;

      // A second write, but only on the message that actually changes a
      // member's level - rare next to the volume of messages above - to
      // persist the recomputed level and drive rewards and the announcement.
      await prisma.levelMember.update({
        where: { guildId_userId: { guildId: ctx.guild.id, userId: member.id } },
        data: { level: newLevel },
      });

      await applyRoleRewards(member, settings, newLevel);
      await announceLevelUp(member, ctx, settings, newLevel);
    },
  },

  requires: ["ManageRoles"],
});

async function applyRoleRewards(
  member: GuildMember,
  settings: Settings,
  level: number,
): Promise<void> {
  if (settings.roleRewards.length === 0) return;

  const desired = new Set(resolveRewardRoles(level, settings.roleRewards, settings.stackRewards));
  const configuredRoleIds = new Set(settings.roleRewards.map((reward) => reward.role));

  const botHighest = member.guild.members.me?.roles.highest.position ?? 0;

  for (const roleId of desired) {
    if (member.roles.cache.has(roleId)) continue;
    const role = member.guild.roles.cache.get(roleId);
    if (role && !isRoleAssignable(role.position, botHighest)) {
      // The member keeps their level; the role catches up once an operator
      // moves it below the bot's own, so this must not stop anything else.
      console.warn(
        `[leveling] reward role ${roleId} sits above the bot's own in guild ${member.guild.id}`,
      );
      continue;
    }
    await member.roles.add(roleId).catch((error: unknown) => {
      console.error(`[leveling] could not add role ${roleId} in guild ${member.guild.id}:`, error);
    });
  }

  if (settings.stackRewards) return;

  for (const roleId of configuredRoleIds) {
    if (desired.has(roleId)) continue;
    if (!member.roles.cache.has(roleId)) continue;
    await member.roles.remove(roleId).catch((error: unknown) => {
      console.error(
        `[leveling] could not remove role ${roleId} in guild ${member.guild.id}:`,
        error,
      );
    });
  }
}

async function announceLevelUp(
  member: GuildMember,
  ctx: ModuleContext<Settings>,
  settings: Settings,
  level: number,
): Promise<void> {
  const channelId = settings.announce.channel;
  if (!channelId) return;

  const channel = ctx.guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return;

  const text = settings.announce.message
    .replace(/\{user\}/g, `<@${member.id}>`)
    .replace(/\{level\}/g, String(level));

  await channel.send(text).catch((error: unknown) => {
    console.error(`[leveling] could not announce in channel ${channelId}:`, error);
  });
}
