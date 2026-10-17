import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction, GuildMember, Message } from "discord.js";
import { defineModule, isRoleAssignable, s } from "@tier0/core";
import type { Infer, ModuleContext, ModuleNotice, RowHooks } from "@tier0/core";
import { prisma } from "@tier0/db";
import {
  adjustXp,
  applyMultiplier,
  MAX_XP,
  canAward,
  highestMultiplierPercent,
  levelForXp,
  progressFor,
  renderProgressBar,
  resolveRewardRoles,
  xpForMessage,
} from "./curve.js";
import {
  EMPTY_LEADERBOARD,
  LEADERBOARD_PLACEHOLDERS,
  LEADERBOARD_STARTING,
  LEVEL_UP_MESSAGE,
  PAST_END_LEADERBOARD,
  PRIVACY_HIDDEN,
  PRIVACY_SHOWN,
  RANK_PLACEHOLDERS,
  RANK_STARTING,
  XP_CHANGED,
  XP_RESET,
  labelsGroup,
  leaderboardLine,
  replyField,
  upgradeAnnounce,
  upgradeLayout,
} from "./messages.js";
import { publicPageUrl, setHidden } from "./public-page.js";

export { clampPage, publicLeaderboard, PUBLIC_PAGE_SIZE, type PublicLeaderboard, type PublicMember } from "./public-page.js";

const settingsSchema = s.object({
  xp: s.object(
    {
      min: s.integer({ label: "Minimum experience per message", min: 1, max: 1000, default: 15 }),
      max: s.integer({ label: "Maximum experience per message", min: 1, max: 1000, default: 25 }),
    },
    {
      label: "Experience per message",
      help: "A random amount in this range is awarded, so activity cannot be gamed by sending identical short messages. If the minimum is above the maximum, the two are swapped.",
    },
  ),
  earning: s.object(
    {
      cooldown: s.duration({
        label: "Cooldown between awards",
        help: "How long a member must wait between messages that earn experience. 0 lets every message earn.",
        default: "60s",
        min: "0s",
        max: "1h",
      }),
      noXpChannels: s.array(s.channel({ types: ["text", "voice", "forum"] }), {
        label: "Channels that earn no experience",
        help: "Threads inside these channels earn none either.",
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
          item: "multiplier",
          help: "A member with more than one of these roles gets the highest percentage that applies.",
        },
      ),
    },
    { label: "Earning experience" },
  ),
  announce: s.object(
    {
      where: s.choice({
        label: "Announce level-ups",
        options: [
          { value: "off", label: "Don't announce them" },
          { value: "channel", label: "In one channel", description: "Every level-up is posted in the channel below." },
          { value: "current", label: "Where they levelled up", description: "Posted in the channel the member was talking in." },
          { value: "dm", label: "By direct message", description: "Only the member sees it. A mention in it does not notify." },
        ],
        default: "off",
        guided: true,
      }),
      channel: s.channel({
        label: "Announce level-ups in",
        types: ["text"],
        optional: true,
        guided: true,
        when: { field: "where", equals: "channel" },
      }),
      message: s.message({
        label: "Level-up message",
        help: "Not sent while level-ups are not announced.",
        starting: LEVEL_UP_MESSAGE,
        variables: [
          { name: "user", description: "The member who levelled up, as a mention", sample: "@Ada" },
          { name: "level", description: "The level they reached", sample: "5" },
        ],
      }),
    },
    {
      label: "Level-up announcements",
      upgrade: upgradeAnnounce,
    },
  ),
  rewards: s.object(
    {
      roles: s.array(
        s.object({
          level: s.integer({ label: "Level", min: 1 }),
          role: s.role({ label: "Role to give", assigns: true }),
        }),
        {
          label: "Rewards",
          item: "reward",
          help: "Roles given automatically when a member reaches the level, and given back if they leave and rejoin. A reward added later reaches members already past its level when they next level up, or straight away with Give to members who qualify on its row.",
        },
      ),
      stack: s.boolean({
        label: "Keep every earned reward role",
        help: "When off, only the highest reward a member qualifies for is kept, and lower ones are removed as they level up.",
        default: true,
      }),
    },
    { label: "Role rewards" },
  ),
  publicPage: s.object(
    {
      enabled: s.boolean({
        label: "Public leaderboard page",
        help: "A page anyone with the link can open in a browser, without signing in. It shows each member's server name, picture and level, and nothing else. Members can leave themselves off it with /leaderboard-privacy.",
        default: false,
      }),
      indexed: s.boolean({
        label: "Let search engines list the page",
        help: "Off, the page asks search engines not to list it, so only people with the link find it.",
        default: false,
        when: { field: "enabled", equals: true },
      }),
    },
    { label: "Public leaderboard" },
  ),
  replies: s.object(
    {
      leaderboardEmpty: replyField("leaderboardEmpty"),
      leaderboardPastEnd: replyField("leaderboardPastEnd"),
      xpChanged: replyField("xpChanged"),
      xpReset: replyField("xpReset"),
      privacyHidden: replyField("privacyHidden"),
      privacyShown: replyField("privacyShown"),
    },
    {
      label: "Replies and errors",
      help: "What /leaderboard says when there is nothing to show, what /xp says to the moderator who used it, and what /leaderboard-privacy says. The level-up message is under Level-up announcements.",
      collapsible: true,
    },
  ),
  labels: labelsGroup,
}, { upgrade: upgradeLayout });

type Settings = Infer<typeof settingsSchema>;
type Ctx = ModuleContext<Settings>;

const LEADERBOARD_PAGE_SIZE = 10;

/** The public page's address while it is on and the dashboard has an address, else empty. */
async function pageUrl(ctx: Ctx): Promise<string> {
  if (!ctx.settings.publicPage.enabled) return "";
  return publicPageUrl(await ctx.dashboardUrl(), ctx.guild.id);
}

async function publicPageNotices(ctx: Ctx): Promise<ModuleNotice[]> {
  if (!ctx.settings.publicPage.enabled) return [];
  const url = publicPageUrl(await ctx.dashboardUrl(), ctx.guild.id);
  if (url === "") {
    return [
      {
        tone: "attention",
        text: "The public leaderboard is on, but this dashboard has no address that people outside this computer can open, so nobody can reach the page yet. Once the dashboard can be reached from the internet, enter its address as Dashboard address in the moderation settings.",
        link: { href: `/guilds/${ctx.guild.id}/mod/settings`, label: "Open the moderation settings" },
      },
    ];
  }
  return [
    {
      tone: "info",
      text: `The public leaderboard is at ${url}. /rank and /leaderboard link to it.`,
      link: { href: url, label: "Open the page" },
    },
  ];
}

/** Members a reward sync looks at in one go. */
const SYNC_LIMIT = 5000;
/**
 * Members whose roles one press changes. Role changes are rate limited by
 * Discord, so this keeps a press to well under a minute; members already in
 * line cost no request, so the next press carries on where this one stopped.
 */
const CHANGE_LIMIT = 100;
/** Discord returns at most this many members per request. */
const FETCH_CHUNK = 100;

/** Stores a member's new total and level, then brings their reward roles in line with it. */
async function setXp(ctx: Ctx, userId: string, xp: number): Promise<{ xp: number; level: number }> {
  const level = levelForXp(xp);
  await prisma.levelMember.upsert({
    where: { guildId_userId: { guildId: ctx.guild.id, userId } },
    create: { guildId: ctx.guild.id, userId, xp, level },
    update: { xp, level },
  });
  const member = await ctx.guild.members.fetch(userId).catch(() => null);
  if (member) await applyRoleRewards(member, ctx.settings, level);
  return { xp, level };
}

async function runXp(interaction: ChatInputCommandInteraction, ctx: Ctx): Promise<void> {
  const sub = interaction.options.getSubcommand();
  const target = interaction.options.getUser("member", true);
  const mention = `<@${target.id}>`;

  if (sub === "reset") {
    await setXp(ctx, target.id, 0);
    await ctx.reply(interaction, ctx.settings.replies.xpReset, { member: mention }, { fallback: XP_RESET });
    return;
  }

  const amount = interaction.options.getInteger("amount", true);
  const row = await prisma.levelMember.findUnique({
    where: { guildId_userId: { guildId: ctx.guild.id, userId: target.id } },
  });
  const change = sub === "give" ? "give" : sub === "take" ? "take" : "set";
  const result = await setXp(ctx, target.id, adjustXp(row?.xp ?? 0, change, amount));
  await ctx.reply(interaction, ctx.settings.replies.xpChanged, { member: mention, ...result }, { fallback: XP_CHANGED });
}

const rewardRows: RowHooks<Settings> = {
  actions: {
    sync: {
      label: "Give to members who qualify",
      help: "Gives this reward to members who are already at or past its level, and with Keep every earned reward role off, takes lower rewards from them.",
      async run({ ctx, row }) {
        const level = Number(row.row["level"]);
        if (!Number.isInteger(level)) return { ok: false, message: "That reward is incomplete. Fill it in and save first." };

        const rows = await prisma.levelMember.findMany({
          where: { guildId: ctx.guild.id, level: { gte: level } },
          orderBy: { xp: "desc" },
          take: SYNC_LIMIT,
        });
        if (rows.length === 0) return { ok: true, message: `Nobody has reached level ${level} yet.` };

        let changed = 0;
        scan: for (let i = 0; i < rows.length; i += FETCH_CHUNK) {
          const chunk = rows.slice(i, i + FETCH_CHUNK);
          const members = await ctx.guild.members.fetch({ user: chunk.map((entry) => entry.userId) }).catch(() => null);
          for (const entry of chunk) {
            const member = members?.get(entry.userId);
            if (member && (await applyRoleRewards(member, ctx.settings, entry.level)) > 0) changed += 1;
            if (changed >= CHANGE_LIMIT) break scan;
          }
        }
        const who = changed === 1 ? "1 member" : `${changed} members`;
        if (changed >= CHANGE_LIMIT) return { ok: true, message: `Updated the rewards of ${who}. Press it again to carry on with the rest.` };
        const more = rows.length === SYNC_LIMIT ? ` Only the ${SYNC_LIMIT} members with the most experience were checked.` : "";
        return { ok: true, message: changed === 0 ? `Everyone who qualifies already has their rewards.${more}` : `Updated the rewards of ${who}.${more}` };
      },
    },
  },
};

/**
 * Timestamp of each member's last award, held in process memory, not the
 * database. Every message in every guild consults this map first, and a
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
      publicReply: true,
      response: {
        starting: RANK_STARTING,
        placeholders: RANK_PLACEHOLDERS,
      },
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

        const values = {
          user: target.username,
          "user.avatar": target.displayAvatarURL(),
          level,
          xp: into,
          need,
          rank: rank ? `#${rank}` : ctx.settings.labels.unranked,
          progress: renderProgressBar(into, need),
          "leaderboard.url": await pageUrl(ctx),
        };
        const custom = ctx.customReply?.(values);
        if (custom) await interaction.reply(custom);
        else await ctx.reply(interaction, RANK_STARTING, values, { ephemeral: false });
      },
    },
    {
      name: "leaderboard",
      publicReply: true,
      response: {
        starting: LEADERBOARD_STARTING,
        placeholders: LEADERBOARD_PLACEHOLDERS,
        note: "Used when there is something to show. An empty leaderboard keeps its own message.",
      },
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
          await (page === 1
            ? ctx.reply(interaction, ctx.settings.replies.leaderboardEmpty, { page }, { fallback: EMPTY_LEADERBOARD })
            : ctx.reply(interaction, ctx.settings.replies.leaderboardPastEnd, { page }, { fallback: PAST_END_LEADERBOARD }));
          return;
        }

        // One batched fetch for every name on the page. Not one call per
        // row.
        const members = await ctx.guild.members
          .fetch({ user: rows.map((row) => row.userId) })
          .catch(() => null);

        const lines = rows.map((row, index) => {
          const name = members?.get(row.userId)?.displayName ?? `<@${row.userId}>`;
          const position = (page - 1) * LEADERBOARD_PAGE_SIZE + index + 1;
          return leaderboardLine(ctx.settings.labels.leaderboardLine, { position, name, level: row.level, xp: row.xp });
        });

        const values = { leaderboard: lines.join("\n"), page, "leaderboard.url": await pageUrl(ctx) };
        const custom = ctx.customReply?.(values);
        if (custom) await interaction.reply(custom);
        else await ctx.reply(interaction, LEADERBOARD_STARTING, values, { ephemeral: false });
      },
    },
    {
      name: "leaderboard-privacy",
      description: "Leave yourself off the public leaderboard page, or come back to it.",
      build: () =>
        new SlashCommandBuilder()
          .setName("leaderboard-privacy")
          .setDescription("Leave yourself off the public leaderboard page, or come back to it.")
          .addStringOption((option) =>
            option
              .setName("choice")
              .setDescription("Whether the page shows you.")
              .setRequired(true)
              .addChoices({ name: "Hide me", value: "hide" }, { name: "Show me", value: "show" }),
          ),
      async run(interaction, ctx) {
        const hide = interaction.options.getString("choice", true) === "hide";
        await setHidden(ctx.guild.id, interaction.user.id, hide);
        await (hide
          ? ctx.reply(interaction, ctx.settings.replies.privacyHidden, {}, { fallback: PRIVACY_HIDDEN })
          : ctx.reply(interaction, ctx.settings.replies.privacyShown, {}, { fallback: PRIVACY_SHOWN }));
      },
    },
    {
      name: "xp",
      description: "Give, take, set or reset a member's experience.",
      build: () =>
        new SlashCommandBuilder()
          .setName("xp")
          .setDescription("Give, take, set or reset a member's experience.")
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
          .addSubcommand((sub) =>
            sub
              .setName("give")
              .setDescription("Add experience to a member.")
              .addUserOption((option) => option.setName("member").setDescription("Who to give it to.").setRequired(true))
              .addIntegerOption((option) =>
                option.setName("amount").setDescription("How much experience.").setRequired(true).setMinValue(1).setMaxValue(MAX_XP),
              ),
          )
          .addSubcommand((sub) =>
            sub
              .setName("take")
              .setDescription("Remove experience from a member.")
              .addUserOption((option) => option.setName("member").setDescription("Who to take it from.").setRequired(true))
              .addIntegerOption((option) =>
                option.setName("amount").setDescription("How much experience.").setRequired(true).setMinValue(1).setMaxValue(MAX_XP),
              ),
          )
          .addSubcommand((sub) =>
            sub
              .setName("set")
              .setDescription("Set a member's experience to an exact amount.")
              .addUserOption((option) => option.setName("member").setDescription("Whose experience to set.").setRequired(true))
              .addIntegerOption((option) =>
                option.setName("amount").setDescription("Their new total.").setRequired(true).setMinValue(0).setMaxValue(MAX_XP),
              ),
          )
          .addSubcommand((sub) =>
            sub
              .setName("reset")
              .setDescription("Set a member's experience back to 0.")
              .addUserOption((option) => option.setName("member").setDescription("Whose experience to reset.").setRequired(true)),
          ),
      run: runXp,
    },
  ],

  rows: { "rewards.roles": rewardRows },

  notices: publicPageNotices,

  events: {
    async messageCreate(message, ctx) {
      const member = message.member;
      // Guild messages normally carry the member Discord sent along with the
      // event; if it is missing there is no roster to check exclusions or
      // multipliers against, and fetching one over the API on every message
      // would defeat the point of keeping this path cheap.
      if (!member) return;

      const settings = ctx.settings;
      // A thread earns what the channel it is in earns.
      const parentId = message.channel.isThread() ? message.channel.parentId : null;
      if (settings.earning.noXpChannels.includes(message.channelId) || (parentId && settings.earning.noXpChannels.includes(parentId))) return;
      if (member.roles.cache.some((role) => settings.earning.noXpRoles.includes(role.id))) return;

      const key = cooldownKey(ctx.guild.id, member.id);
      const now = Date.now();
      const last = lastAwardAt.get(key);
      if (last !== undefined && !canAward(last, now, settings.earning.cooldown)) return;

      lastAwardAt.set(key, now);
      if (lastAwardAt.size > MAX_TRACKED_MEMBERS) lastAwardAt.clear();

      const roleIds = member.roles.cache.map((role) => role.id);
      const percent = highestMultiplierPercent(roleIds, settings.earning.multipliers);
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
      // A level that went down, after a moderator took experience away, is not announced.
      if (newLevel > row.level) await announceLevelUp(member, message, ctx, newLevel);
    },

    async memberJoin(member, ctx) {
      // Experience outlives a departure, so a member who comes back gets their rewards back.
      if (ctx.settings.rewards.roles.length === 0) return;
      const row = await prisma.levelMember.findUnique({
        where: { guildId_userId: { guildId: ctx.guild.id, userId: member.id } },
      });
      if (row && row.level > 0) await applyRoleRewards(member, ctx.settings, row.level);
    },
  },

  requires: ["ManageRoles"],
});

/** Brings a member's reward roles in line with their level. Resolves to how many roles were changed. */
async function applyRoleRewards(
  member: GuildMember,
  settings: Settings,
  level: number,
): Promise<number> {
  if (settings.rewards.roles.length === 0) return 0;

  const desired = new Set(resolveRewardRoles(level, settings.rewards.roles, settings.rewards.stack));
  const configuredRoleIds = new Set(settings.rewards.roles.map((reward) => reward.role));

  const botHighest = member.guild.members.me?.roles.highest.position ?? 0;
  let changed = 0;
  const done = () => {
    changed += 1;
  };

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
    await member.roles.add(roleId).then(done, (error: unknown) => {
      console.error(`[leveling] could not add role ${roleId} in guild ${member.guild.id}:`, error);
    });
  }

  if (settings.rewards.stack) return changed;

  for (const roleId of configuredRoleIds) {
    if (desired.has(roleId)) continue;
    if (!member.roles.cache.has(roleId)) continue;
    await member.roles.remove(roleId).then(done, (error: unknown) => {
      console.error(
        `[leveling] could not remove role ${roleId} in guild ${member.guild.id}:`,
        error,
      );
    });
  }
  return changed;
}

async function announceLevelUp(member: GuildMember, message: Message, ctx: Ctx, level: number): Promise<void> {
  const { where, channel: channelId, message: body } = ctx.settings.announce;
  const values = { user: `<@${member.id}>`, level };

  // A failed send is logged by ctx.send and must not hold up the next message.
  if (where === "dm") {
    await ctx.send(member.user, body, values, { fallback: LEVEL_UP_MESSAGE });
    return;
  }
  const target =
    where === "current" ? message.channel : where === "channel" && channelId ? ctx.guild.channels.cache.get(channelId) : undefined;
  if (!target?.isTextBased()) return;
  await ctx.send(target, body, values, { fallback: LEVEL_UP_MESSAGE });
}
