import {
  PermissionFlagsBits,
  type GuildMember,
  type Message,
  type PartialMessage,
} from "discord.js";
import { defineModule, type EvidenceMessage, type ModuleContext } from "@tier0/core";
import { createInfraction } from "@tier0/db";
import { evidenceForTrip, loggedCopyOf } from "@tier0/module-moderation";
import { settings, type AutomodSettings } from "./settings.js";
import type { EvaluationVerdict } from "./evaluator.js";
import { carryOut, draftInfraction, judgeMessage, type Outcome } from "./handler.js";
import { AutomodState } from "./state.js";
import { LOG_MESSAGES, NOTICE_MESSAGE, loggedAs, logValues, tripValues, type TripFacts } from "./messages.js";

// One instance for the whole process, not per guild: it is its own map keyed
// by guild id, and a module definition is only ever loaded once. See state.ts
// for why this lives in memory and not the database.
const state = new AutomodState();

export default defineModule({
  id: "automod",
  name: "Automod",
  summary: "Filters invites, links, spam and banned words, each rule independently switchable.",
  category: "moderation",
  area: "moderation",
  settings,

  events: {
    async messageCreate(message, ctx) {
      await handleMessage(message, ctx, false, null);
    },
    async messageUpdate(before, after, ctx) {
      // An edit is the obvious way to smuggle text past a filter that only
      // reads a message once, so an edited message is read again. Only when
      // its text changed, though: Discord also sends an update for an embed
      // finishing loading or a pin, and those are not new text.
      await handleMessage(after, ctx, true, before.content);
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
  isEdit: boolean,
  previousContent: string | null,
): Promise<void> {
  // The gateway already keeps bot authors and DMs out of these events, but
  // that guarantee lives outside this module. It gets checked again here
  // instead of just trusted.
  if (!message.guild || !message.author || message.author.bot) return;
  if (message.content === null) return;

  const member =
    message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member) return;

  const channel = message.channel;
  const verdict = judgeMessage(state, {
    guildId: ctx.guild.id,
    userId: member.id,
    messageId: message.id,
    content: message.content,
    isEdit,
    previousContent,
    authorRoles: [...member.roles.cache.keys()],
    authorIsModerator: isModerator(member),
    channelId: message.channelId,
    parentChannelId: channel.isThread() ? channel.parentId : null,
    now: Date.now(),
    settings: ctx.settings,
  });
  if (!verdict) return;

  await applyVerdict(message, member, verdict, ctx, isEdit, previousContent);
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
  isEdit: boolean,
  previousContent: string | null,
): Promise<void> {
  const { rule, actions, timeoutMs } = verdict;
  if (!rule || !actions) return;

  const outcome = await carryOut(actions, timeoutMs, {
    deleteMessage: () => message.delete(),
    timeoutMember: async (ms) => {
      // Discord would refuse an owner, an administrator or anyone above the bot
      // with the same error; asking first just saves the round trip.
      if (!member.moderatable) throw { code: 50013 };
      await member.timeout(ms, `Automod: ${rule}`);
    },
  });

  // Taken whether or not the delete worked: staff need to see what tripped the rule either way.
  const evidence = await evidenceOf(ctx, message, isEdit, previousContent, outcome.deleted);
  const caseNumber = await recordInfraction(ctx, member, verdict, outcome, evidence);
  const facts: TripFacts = {
    userId: member.id,
    rule,
    actions,
    reason: verdict.reason,
    detail: verdict.detail,
    matches: verdict.matches,
    timeoutMs,
    deleted: outcome.deleted,
    // The case is what carries a warning, so one that could not be recorded was not given.
    warned: outcome.warned && caseNumber !== undefined,
    timedOut: outcome.timedOut,
    problems: outcome.problems,
    caseNumber,
    guildId: ctx.guild.id,
    dashboardBase: await ctx.dashboardUrl(),
  };
  await notifyChannel(ctx, message, facts);
  await postLog(ctx, facts);
}

async function recordInfraction(
  ctx: ModuleContext<AutomodSettings>,
  member: GuildMember,
  verdict: EvaluationVerdict,
  outcome: Outcome,
  evidence: EvidenceMessage[],
): Promise<number | undefined> {
  const draft = draftInfraction(verdict, outcome, verdict.timeoutMs, Date.now());
  try {
    const record = await createInfraction({
      guildId: ctx.guild.id,
      userId: member.id,
      moderatorId: ctx.client.user?.id ?? "0",
      ...draft,
      evidence: JSON.stringify(evidence),
    });
    return record.caseNumber;
  } catch (error) {
    console.error("[automod] failed to record infraction:", error);
    return undefined;
  }
}

/**
 * A copy of the message that tripped the rule, kept with the case for staff to read
 * on the dashboard. It is built the way a moderator's attachment is, from the server
 * log's copy when there is one so an edited message keeps its earlier versions.
 * Never throws: a failure to copy must not cost the case its record.
 */
async function evidenceOf(
  ctx: ModuleContext<AutomodSettings>,
  message: Message | PartialMessage,
  isEdit: boolean,
  previousContent: string | null,
  deleted: boolean,
): Promise<EvidenceMessage[]> {
  try {
    const channel = message.channel;
    const logged = await loggedCopyOf(ctx.guild.id, message.id);
    return [
      evidenceForTrip({
        guildId: ctx.guild.id,
        message: {
          id: message.id,
          channelId: message.channelId,
          channelName: "name" in channel && typeof channel.name === "string" ? channel.name : "",
          content: message.content ?? "",
          attachments: [...message.attachments.values()].map((a) => ({ name: a.name, url: a.url, contentType: a.contentType })),
          createdAt: new Date(message.createdTimestamp ?? Date.now()),
        },
        logged,
        previousContent,
        isEdit,
        deleted,
        now: new Date(),
      }),
    ];
  } catch (error) {
    console.error("[automod] could not keep the message as evidence:", error);
    return [];
  }
}

async function notifyChannel(
  ctx: ModuleContext<AutomodSettings>,
  message: Message | PartialMessage,
  facts: TripFacts,
): Promise<void> {
  const channel = message.channel;
  if (!channel.isTextBased() || channel.isDMBased()) return;

  // Only the member it is about can be pinged, whatever the owner's text says.
  const notice = await ctx.send(channel, ctx.settings.noticeMessage, tripValues(facts), {
    fallback: NOTICE_MESSAGE,
    mentions: { users: [facts.userId], roles: [] },
  });
  if (!notice) return;

  setTimeout(() => {
    notice.delete().catch(() => undefined);
  }, 8000);
}

async function postLog(ctx: ModuleContext<AutomodSettings>, facts: TripFacts): Promise<void> {
  const channelId = ctx.settings.logChannel;
  if (!channelId) return;

  const channel = ctx.guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return;

  const preset = loggedAs(facts);
  await ctx.send(channel, ctx.settings.logMessages[preset], logValues(facts), {
    fallback: LOG_MESSAGES[preset],
    mentions: { users: [], roles: [] },
  });
}
