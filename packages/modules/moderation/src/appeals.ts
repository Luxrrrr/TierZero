import {
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
  type User,
} from "discord.js";
import { customId, type ComponentEvent, type ModuleContext, type ReplyValues } from "@tier0/core";
import { APPEAL_LIMITS } from "@tier0/shared-moderation";
import { prisma } from "@tier0/db";
import type { ModerationSettings } from "./settings.js";
import { APPEAL_POST, APPEAL_REPLIES } from "./messages.js";
import { latestOpenBan, type InfractionRecord } from "./infractions.js";
import { fetchBanOrNull } from "./lookups.js";
import { fillLabel } from "./texts.js";

/**
 * Ban appeals, from the member's side. A banned member is not in the server, so
 * this lives in their direct messages: the button under the ban's message opens
 * a form, and the form files an appeal against the ban in force. Staff decide it
 * on the dashboard, which is the control API's half.
 */

type Ctx = ModuleContext<ModerationSettings>;
type AppealReply = keyof typeof APPEAL_REPLIES;

export type AppealBlock =
  | { kind: "closed" }
  | { kind: "notBanned"; caseNumber: number | null }
  | { kind: "alreadyOpen"; caseNumber: number }
  | { kind: "cooldown"; caseNumber: number; until: Date }
  | { kind: "open"; ban: InfractionRecord };

export interface AppealFacts {
  enabled: boolean;
  /** The member's newest ban on the record that is still in force, if any. */
  ban: InfractionRecord | null;
  /** Whether Discord has them banned, or null when it could not be asked. */
  discordBanned: boolean | null;
  hasPending: boolean;
  /** When the latest denied appeal on this ban was decided. */
  lastDeniedAt: Date | null;
  cooldownMs: number;
}

/** Whether the member may appeal now, and if not, which reply says why. */
export function appealBlock(facts: AppealFacts, now: Date): AppealBlock {
  if (!facts.enabled) return { kind: "closed" };
  // Discord is the judge of whether they are banned: the record can still say so after a ban was lifted by hand.
  if (!facts.ban || facts.discordBanned === false) return { kind: "notBanned", caseNumber: facts.ban?.caseNumber ?? null };
  if (facts.hasPending) return { kind: "alreadyOpen", caseNumber: facts.ban.caseNumber };
  if (facts.lastDeniedAt && facts.cooldownMs > 0) {
    const until = new Date(facts.lastDeniedAt.getTime() + facts.cooldownMs);
    if (until.getTime() > now.getTime()) return { kind: "cooldown", caseNumber: facts.ban.caseNumber, until };
  }
  return { kind: "open", ban: facts.ban };
}

async function factsFor(ctx: Ctx, userId: string): Promise<AppealFacts> {
  const settings = ctx.settings.appeals;
  const ban = settings.enabled ? await latestOpenBan(ctx.guild.id, userId) : null;
  const discordBanned = ban ? await fetchBanOrNull(ctx.guild, userId).then((found) => found !== null, () => null) : null;
  const [pending, denied] = ban
    ? await Promise.all([
        prisma.appeal.count({ where: { infractionId: ban.id, status: "pending" } }),
        prisma.appeal.findFirst({ where: { infractionId: ban.id, status: "denied" }, orderBy: { decidedAt: "desc" }, select: { decidedAt: true } }),
      ])
    : [0, null];
  return { enabled: settings.enabled, ban, discordBanned, hasPending: pending > 0, lastDeniedAt: denied?.decidedAt ?? null, cooldownMs: settings.cooldown };
}

/** A few presses and forms per member in a while, across every server, so the button cannot be used to flood staff. */
export class AppealLimiter {
  private readonly seen = new Map<string, number[]>();

  constructor(
    private readonly limit = 5,
    private readonly windowMs = 10 * 60_000,
  ) {}

  take(userId: string, now: number): boolean {
    const recent = (this.seen.get(userId) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.seen.set(userId, recent);
      return false;
    }
    recent.push(now);
    this.seen.set(userId, recent);
    if (this.seen.size > 10_000) this.prune(now);
    return true;
  }

  private prune(now: number): void {
    for (const [key, times] of this.seen) if (times.every((at) => now - at >= this.windowMs)) this.seen.delete(key);
  }
}

const limiter = new AppealLimiter();

async function answer(ctx: Ctx, interaction: MessageComponentInteraction | ModalSubmitInteraction, key: AppealReply, values: ReplyValues = {}): Promise<void> {
  await ctx.reply(interaction, ctx.settings.appeals.replies[key], values, { fallback: APPEAL_REPLIES[key].starting });
}

async function answerBlock(ctx: Ctx, interaction: MessageComponentInteraction | ModalSubmitInteraction, block: Exclude<AppealBlock, { kind: "open" }>): Promise<void> {
  if (block.kind === "closed") return answer(ctx, interaction, "closed");
  if (block.kind === "notBanned") return answer(ctx, interaction, "notBanned", { case: block.caseNumber ?? "" });
  if (block.kind === "alreadyOpen") return answer(ctx, interaction, "alreadyOpen", { case: block.caseNumber });
  return answer(ctx, interaction, "cooldown", { case: block.caseNumber, until: `<t:${Math.floor(block.until.getTime() / 1000)}:f>` });
}

/** The "Appeal this ban" button: checks the member may appeal, then opens the form. */
export async function openAppealForm(interaction: MessageComponentInteraction, { ctx }: ComponentEvent<ModerationSettings>): Promise<void> {
  if (!limiter.take(interaction.user.id, Date.now())) return answer(ctx, interaction, "tooFast");
  const block = appealBlock(await factsFor(ctx, interaction.user.id), new Date());
  if (block.kind !== "open") return answerBlock(ctx, interaction, block);

  const settings = ctx.settings.appeals;
  const text = new TextInputBuilder()
    .setCustomId("text")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(APPEAL_LIMITS.text);
  if (settings.formPlaceholder) text.setPlaceholder(settings.formPlaceholder.slice(0, 100));
  const modal = new ModalBuilder()
    .setCustomId(customId("moderation", "appealform", ctx.guild.id))
    .setTitle(settings.formTitle.slice(0, 45))
    .addLabelComponents(new LabelBuilder().setLabel(settings.formQuestion.slice(0, 45)).setTextInputComponent(text));
  await interaction.showModal(modal);
}

// One appeal is filed at a time per member and server, so two forms sent together cannot both find none open.
const filing = new Set<string>();

/** The sent form: checks again, files the appeal and tells staff. */
export async function submitAppeal(interaction: ModalSubmitInteraction, { ctx }: ComponentEvent<ModerationSettings>): Promise<void> {
  if (!limiter.take(interaction.user.id, Date.now())) return answer(ctx, interaction, "tooFast");
  const key = `${ctx.guild.id}:${interaction.user.id}`;
  if (filing.has(key)) return answer(ctx, interaction, "tooFast");
  filing.add(key);
  try {
    const block = appealBlock(await factsFor(ctx, interaction.user.id), new Date());
    if (block.kind !== "open") return answerBlock(ctx, interaction, block);
    // Discord holds the box to at least ten characters, so the text is never empty here.
    const text = interaction.fields.getTextInputValue("text").trim().slice(0, APPEAL_LIMITS.text);
    const appeal = await prisma.appeal.create({
      data: { guildId: ctx.guild.id, userId: interaction.user.id, infractionId: block.ban.id, caseNumber: block.ban.caseNumber, text },
    });
    await answer(ctx, interaction, "received", { case: block.ban.caseNumber });
    await tellStaff(ctx, interaction.user, appeal.id, block.ban.caseNumber);
  } finally {
    filing.delete(key);
  }
}

/** Posts the new appeal in the appeals channel, or the mod log channel when none is set. Never throws. */
async function tellStaff(ctx: Ctx, user: User, appealId: number, caseNumber: number): Promise<void> {
  const channelId = ctx.settings.appeals.channel ?? ctx.settings.modLogChannel;
  if (!channelId) return;
  const channel = ctx.guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return;
  const base = await ctx.dashboardUrl();
  await ctx.send(
    channel,
    ctx.settings.appeals.post,
    {
      member: `<@${user.id}>`,
      memberId: user.id,
      user: user.username,
      case: caseNumber,
      appealUrl: base ? `${base}/guilds/${ctx.guild.id}/mod/appeals?appeal=${appealId}` : "",
    },
    { fallback: APPEAL_POST, mentions: { users: [], roles: [] } },
  );
}

/** What `{retryNote}` says in the message about a denied appeal: when they may appeal again, or nothing. */
export function retryNote(settings: ModerationSettings, decidedAt: Date): string {
  if (settings.appeals.cooldown <= 0) return "";
  const at = Math.floor((decidedAt.getTime() + settings.appeals.cooldown) / 1000);
  return ` ${fillLabel(settings.labels.notes.appealRetry, { when: `<t:${at}:R>` })}`;
}
