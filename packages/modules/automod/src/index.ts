import {
  EmbedBuilder,
  PermissionFlagsBits,
  type GuildMember,
  type Message,
  type PartialMessage,
} from "discord.js";
import { defineModule, type ModuleContext } from "@tier0/core";
import { prisma } from "@tier0/db";
import { settings, type AutomodSettings } from "./settings.js";
import { evaluateMessage, type EvaluationVerdict, type RuleAction } from "./evaluator.js";
import { AutomodState } from "./state.js";

// One instance for the whole process, not per guild: it is its own map keyed
// by guild id, and a module definition is only ever loaded once. See
// state.ts for why this lives in memory instead of the database.
const state = new AutomodState();

export default defineModule({
  id: "automod",
  name: "Automod",
  summary: "Filters invites, links, spam and banned words, each rule independently switchable.",
  settings,

  events: {
    async messageCreate(message, ctx) {
      await handleMessage(message, ctx);
    },
    async messageUpdate(_before, after, ctx) {
      // An edit is the obvious way to smuggle text past a filter that only
      // reads a message once, so an edited message gets the same treatment
      // as a new one.
      await handleMessage(after, ctx);
    },
  },

  async onDisable(ctx) {
    state.forgetGuild(ctx.guild.id);
  },

  requires: ["ManageMessages", "ModerateMembers"],
});

async function handleMessage(
  message: Message | PartialMessage,
  ctx: ModuleContext<AutomodSettings>,
): Promise<void> {
  // The gateway already keeps bot authors and DMs out of these events, but
  // that guarantee lives outside this module, so it is checked again here
  // rather than trusted.
  if (!message.guild || !message.author || message.author.bot) return;
  if (message.content === null) return;

  const member =
    message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member) return;

  const now = Date.now();
  const history = state.recordAndGetHistory(ctx.guild.id, member.id, {
    content: message.content,
    timestamp: now,
  });

  const verdict = evaluateMessage({
    content: message.content,
    authorRoles: [...member.roles.cache.keys()],
    authorIsBot: member.user.bot,
    authorIsModerator: isModerator(member),
    channelId: message.channelId,
    now,
    history,
    settings: ctx.settings,
  });

  if (!verdict.triggered || !verdict.rule || !verdict.action) return;

  await applyVerdict(message, member, verdict, ctx);
}

function isModerator(member: GuildMember): boolean {
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageMessages) ||
    member.permissions.has(PermissionFlagsBits.ModerateMembers)
  );
}

async function applyVerdict(
  message: Message | PartialMessage,
  member: GuildMember,
  verdict: EvaluationVerdict,
  ctx: ModuleContext<AutomodSettings>,
): Promise<void> {
  const { rule, action, reason, timeoutMs } = verdict;
  if (!rule || !action) return;

  if (action === "delete" || action === "timeout") {
    // The message can already be gone - the author deleted it themselves, or
    // another handler beat this one to it - and Discord's API returns a 404
    // for that, which is not a failure worth surfacing.
    await message.delete().catch(() => undefined);
  }

  if (action === "timeout" && timeoutMs) {
    await member.timeout(timeoutMs, `Automod: ${rule}`).catch(() => undefined);
  }

  await recordInfraction(ctx, member, rule, action, reason, timeoutMs);
  await notifyChannel(message, rule, action, reason);
  await postLog(ctx, member, verdict);
}

async function recordInfraction(
  ctx: ModuleContext<AutomodSettings>,
  member: GuildMember,
  rule: string,
  action: RuleAction,
  reason: string | undefined,
  timeoutMs: number | undefined,
): Promise<void> {
  try {
    await prisma.infraction.create({
      data: {
        guildId: ctx.guild.id,
        userId: member.id,
        moderatorId: ctx.client.user?.id ?? "0",
        action: `automod-${action}`,
        reason: reason ? `${rule}: ${reason}` : rule,
        expiresAt: action === "timeout" && timeoutMs ? new Date(Date.now() + timeoutMs) : null,
        active: action === "timeout",
      },
    });
  } catch (error) {
    console.error("[automod] failed to record infraction:", error);
  }
}

function describeAction(action: RuleAction): string {
  switch (action) {
    case "delete":
      return "your message was removed";
    case "timeout":
      return "your message was removed and you were timed out";
    case "warn":
      return "that message tripped automod";
  }
}

async function notifyChannel(
  message: Message | PartialMessage,
  rule: string,
  action: RuleAction,
  reason: string | undefined,
): Promise<void> {
  const channel = message.channel;
  if (!channel.isTextBased() || channel.isDMBased()) return;

  const notice = await channel
    .send({
      content: `<@${message.author?.id}>, ${describeAction(action)} (${rule}${reason ? `: ${reason}` : ""}).`,
      allowedMentions: { users: message.author ? [message.author.id] : [] },
    })
    .catch(() => null);
  if (!notice) return;

  setTimeout(() => {
    notice.delete().catch(() => undefined);
  }, 8000);
}

const LOG_COLOR: Record<RuleAction, number> = {
  warn: 0xf5a623,
  delete: 0xed4245,
  timeout: 0x992d22,
};

async function postLog(
  ctx: ModuleContext<AutomodSettings>,
  member: GuildMember,
  verdict: EvaluationVerdict,
): Promise<void> {
  const channelId = ctx.settings.logChannel;
  if (!channelId || !verdict.rule || !verdict.action) return;

  const channel = ctx.guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(LOG_COLOR[verdict.action])
    .setDescription(`${member} tripped **${verdict.rule}**`)
    .addFields(
      { name: "Action", value: verdict.action, inline: true },
      { name: "Reason", value: verdict.reason ?? "-", inline: true },
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => undefined);
}
