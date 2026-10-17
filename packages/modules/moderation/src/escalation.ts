import { PermissionFlagsBits, type GuildMember } from "discord.js";
import { AUTOMOD_ACTOR_NAME, describeAutomatic, isCounting, readAutomatic, warnExpiresAt, type AutomaticCase, type ModuleContext } from "@tier0/core";
import { prisma } from "@tier0/db";
import type { EscalationAction, EscalationRule, ModerationSettings } from "./settings.js";
import { describeDiscordError } from "./action-rules.js";
import { deleteMessageSeconds } from "./duration.js";
import { tryDirectMessage } from "./dm.js";
import { recordInfraction, type InfractionRecord } from "./infractions.js";
import { fetchBanOrNull, fetchMemberOrNull } from "./lookups.js";
import { postModLog } from "./reply.js";
import { staffRoleOf } from "./staff.js";
import { fillLabel } from "./texts.js";

/**
 * Automatic escalation: after a warning is recorded, the member's warnings are
 * counted against the server's rules and the bot may take a heavier action by
 * itself. The counting is kept apart from Discord so every rule about when a
 * rule fires can be tested with plain values.
 */

const DAY_MS = 86_400_000;

export interface WarningRow {
  caseNumber: number;
  action: string;
  createdAt: Date;
  removed: boolean;
  /** False for an automod warning whose rule does not count toward escalation. */
  escalates: boolean;
}

export interface FiredBefore {
  ruleId: string;
  createdAt: Date;
}

export interface RulePick {
  rule: EscalationRule;
  /** The warnings that made the count, newest first, exactly `rule.warns` of them. */
  counted: WarningRow[];
}

/** The warnings a rule counts, newest first: still counting under the warn expiry, inside its window, and allowed to escalate. */
export function countedWarnings(warnings: readonly WarningRow[], rule: Pick<EscalationRule, "windowDays">, now: Date, warnExpiryMs: number | null): WarningRow[] {
  const since = rule.windowDays > 0 ? now.getTime() - rule.windowDays * DAY_MS : null;
  return warnings
    .filter((row) => row.escalates)
    .filter((row) =>
      isCounting({ action: row.action, active: true, expiresAt: null, removed: row.removed, warnExpiresAt: warnExpiresAt(row.action, row.createdAt, warnExpiryMs) }, now),
    )
    .filter((row) => since === null || row.createdAt.getTime() >= since)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.caseNumber - a.caseNumber);
}

/**
 * The rule to act on now, or null. A rule is reached when it counts at least
 * its number of warnings. It fires once for each run of warnings: if it already
 * fired at or after the oldest of the warnings that would make this count, those
 * warnings were answered and it waits for new ones. Of the rules reached, the
 * one needing the most warnings wins, and on a tie the one listed first.
 */
export function pickRule(
  rules: readonly EscalationRule[],
  warnings: readonly WarningRow[],
  fired: readonly FiredBefore[],
  now: Date,
  warnExpiryMs: number | null,
): RulePick | null {
  let best: RulePick | null = null;
  for (const [index, rule] of rules.entries()) {
    if (!rule.enabled) continue;
    const counted = countedWarnings(warnings, rule, now, warnExpiryMs);
    if (counted.length < rule.warns) continue;
    const run = counted.slice(0, rule.warns);
    const oldest = run[run.length - 1]!.createdAt.getTime();
    const ruleId = ruleKey(rule, index);
    if (fired.some((entry) => entry.ruleId === ruleId && entry.createdAt.getTime() >= oldest)) continue;
    if (!best || rule.warns > best.rule.warns) best = { rule, counted: run };
  }
  return best;
}

/** A rule's id, or its place in the list for a rule saved before ids were given. */
export function ruleKey(rule: Pick<EscalationRule, "id">, index: number): string {
  return rule.id && rule.id !== "" ? rule.id : `rule-${index + 1}`;
}

const ACTION_WORD: Record<EscalationAction, string> = { timeout: "time out", kick: "kick", ban: "ban" };

/** The name a rule is known by on its case: the owner's, or what it does. */
export function ruleName(rule: EscalationRule): string {
  const name = rule.name?.trim();
  if (name) return name;
  const window = rule.windowDays > 0 ? ` in ${rule.windowDays} ${rule.windowDays === 1 ? "day" : "days"}` : "";
  return `${rule.warns} warnings${window}, then ${ACTION_WORD[rule.action as EscalationAction] ?? rule.action}`;
}

/** The facts stored on the case, and what its reason says. */
export function automaticFacts(rule: EscalationRule, index: number, counted: readonly WarningRow[]): AutomaticCase {
  return {
    ruleId: ruleKey(rule, index),
    rule: ruleName(rule),
    warns: counted.length,
    windowMs: rule.windowDays > 0 ? rule.windowDays * DAY_MS : null,
    fromCase: counted[0]?.caseNumber ?? null,
  };
}

export interface TargetStanding {
  isBot: boolean;
  isServerOwner: boolean;
  /** On the Access list, or the person running the install. */
  isStaff: boolean;
  hasExemptRole: boolean;
  isAdministrator: boolean;
  /** Whether the bot's role and permissions let it take this action on them. Null when they are not in the server. */
  botCanAct: boolean | null;
  inServer: boolean;
  /** For a timeout: when a running one ends, if it does. */
  timedOutUntil: Date | null;
  /** For a ban: whether they are banned already. */
  banned: boolean;
}

/**
 * Why a rule must leave this member alone, or null. Staff, anyone the server
 * exempts, administrators and anyone the bot cannot act on are never escalated,
 * and an action that would change nothing (a ban on the banned, a shorter
 * timeout over a longer one) is skipped rather than recorded.
 */
export function standingBlocks(action: EscalationAction, standing: TargetStanding, endsAt: Date | null): string | null {
  if (standing.isBot || standing.isServerOwner) return "the bot and the server owner are never escalated";
  if (standing.isStaff) return "staff are never escalated";
  if (standing.hasExemptRole) return "they have a role the rules leave alone";
  if (standing.isAdministrator) return "administrators are never escalated";
  if (action !== "ban" && !standing.inServer) return "they are not in the server";
  if (standing.botCanAct === false) return "the bot's role is not above theirs, or it lacks the permission";
  if (action === "ban" && standing.banned) return "they are already banned";
  if (action === "timeout" && standing.timedOutUntil && endsAt && standing.timedOutUntil.getTime() >= endsAt.getTime()) {
    return "a longer timeout is already running";
  }
  return null;
}

type Ctx = ModuleContext<ModerationSettings>;

export interface EscalationOutcome {
  record: InfractionRecord;
  automatic: AutomaticCase;
  action: EscalationAction;
}

// One count at a time per member, so two warnings recorded together cannot both see the rule unfired.
const queues = new Map<string, Promise<unknown>>();

function serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(work, work);
  const settled = next.catch(() => undefined);
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return next;
}

/**
 * Counts the member's warnings after a new one and takes the action of the rule
 * that is reached, as a case of its own. Never throws: the warning is already
 * recorded, and a failure here is logged and leaves it at that. Resolves to the
 * case it made, or null.
 */
export async function escalateAfterWarning(ctx: Ctx, userId: string): Promise<EscalationOutcome | null> {
  const rules = ctx.settings.escalation.rules;
  if (!rules.some((rule) => rule.enabled)) return null;
  return serialized(`${ctx.guild.id}:${userId}`, async () => {
    try {
      return await escalate(ctx, userId, new Date());
    } catch (error) {
      console.error(`moderation: escalation failed for ${userId} in guild ${ctx.guild.id}:`, error);
      return null;
    }
  });
}

/**
 * The same, for a warning another module recorded, such as automod's. The rules
 * are moderation's settings, so nothing happens while Moderation is off.
 */
export async function escalateFromPeer(ctx: ModuleContext<unknown>, userId: string): Promise<EscalationOutcome | null> {
  const moderation = await ctx.peer?.("moderation").catch(() => null);
  return moderation ? escalateAfterWarning(moderation as Ctx, userId) : null;
}

async function escalate(ctx: Ctx, userId: string, now: Date): Promise<EscalationOutcome | null> {
  const { guild, settings } = ctx;
  const [warningRows, automaticRows] = await Promise.all([
    prisma.infraction.findMany({
      where: { guildId: guild.id, userId, action: { in: ["warn", "automod-warn"] } },
      select: { caseNumber: true, action: true, createdAt: true, voidedAt: true, escalates: true },
    }),
    // Removed automatic cases count too: staff taking one off the record does not ask for it to happen again.
    prisma.infraction.findMany({ where: { guildId: guild.id, userId, automatic: { not: null } }, select: { automatic: true, createdAt: true } }),
  ]);
  const warnings: WarningRow[] = warningRows.map((row) => ({ ...row, removed: row.voidedAt !== null }));
  const fired: FiredBefore[] = automaticRows.flatMap((row) => {
    const facts = readAutomatic(row.automatic);
    return facts ? [{ ruleId: facts.ruleId, createdAt: row.createdAt }] : [];
  });

  const pick = pickRule(settings.escalation.rules, warnings, fired, now, settings.warnExpiry ?? null);
  if (!pick) return null;
  const index = settings.escalation.rules.indexOf(pick.rule);
  const action = pick.rule.action as EscalationAction;
  const automatic = automaticFacts(pick.rule, index, pick.counted);

  const durationMs = action === "timeout" ? pick.rule.timeoutDuration : action === "ban" ? (pick.rule.banDuration ?? null) : null;
  const expiresAt = durationMs ? new Date(now.getTime() + durationMs) : null;

  const member = await fetchMemberOrNull(guild, userId);
  const botId = ctx.client.user?.id ?? null;
  const standing: TargetStanding = {
    isBot: userId === botId,
    isServerOwner: userId === guild.ownerId,
    isStaff: (await staffRoleOf(guild.id, userId)) !== null,
    hasExemptRole: member ? settings.escalation.exemptRoles.some((role) => member.roles.cache.has(role)) : false,
    isAdministrator: member ? member.permissions.has(PermissionFlagsBits.Administrator) : false,
    botCanAct: member ? botCanAct(member, action) : null,
    inServer: member !== null,
    timedOutUntil: member?.communicationDisabledUntil ?? null,
    banned: action === "ban" ? (await fetchBanOrNull(guild, userId)) !== null : false,
  };
  const blocked = standingBlocks(action, standing, expiresAt);
  if (blocked) {
    console.info(`moderation: escalation rule "${automatic.rule}" reached for ${userId} in guild ${guild.id}, left alone: ${blocked}`);
    return null;
  }

  const reason = fillLabel(settings.labels.reasons.escalated, { rule: automatic.rule, warns: describeAutomatic(automatic) }).slice(0, 500);
  const moderatorId = botId ?? "0";

  // The member is told first, while the bot still shares a server with them, as a moderator's action does.
  if (settings.dmOnAction && member) {
    await tryDirectMessage(ctx, userId, { action, reason, expiresAt, durationMs, moderatorId });
  }

  try {
    if (action === "timeout") await member!.timeout(durationMs!, reason);
    else if (action === "kick") await member!.kick(reason);
    else {
      await guild.members.ban(userId, { reason, deleteMessageSeconds: deleteMessageSeconds(0) });
      await ctx.tasks.cancel("unban", { userId });
    }
  } catch (error) {
    console.warn(`moderation: Discord refused the escalation ${action} on ${userId} in guild ${guild.id}: ${describeDiscordError(error)}`);
    return null;
  }

  const record = await recordInfraction({ guildId: guild.id, userId, moderatorId, action, reason, expiresAt, automatic });
  if (action === "ban" && expiresAt) await ctx.tasks.schedule("unban", expiresAt, { userId });

  await postModLog(ctx, {
    caseNumber: record.caseNumber,
    action,
    targetId: userId,
    moderatorId,
    reason,
    expiresAt,
    durationMs,
    createdAt: record.createdAt,
  });
  await auditEscalation(guild.id, moderatorId, userId, member?.displayName ?? null, record, automatic);
  return { record, automatic, action };
}

function botCanAct(member: GuildMember, action: EscalationAction): boolean {
  if (action === "timeout") return member.moderatable;
  if (action === "kick") return member.kickable;
  return member.bannable;
}

const PAST: Record<EscalationAction, string> = { timeout: "timed out", kick: "kicked", ban: "banned" };

/** The line in Staff activity for a case no person took. Never throws: the case already stands. */
async function auditEscalation(
  guildId: string,
  botId: string,
  userId: string,
  name: string | null,
  record: InfractionRecord,
  automatic: AutomaticCase,
): Promise<void> {
  try {
    await prisma.modAudit.create({
      data: {
        guildId,
        actorId: botId,
        actorName: AUTOMOD_ACTOR_NAME,
        actorRole: "automod",
        kind: "action.take",
        targetUserId: userId,
        infractionId: record.id,
        summary: `Automatic escalation ${PAST[record.action as EscalationAction]} ${name ?? userId} (case #${record.caseNumber}): ${automatic.rule}, ${describeAutomatic(automatic)}`,
        after: JSON.stringify({ action: record.action, caseNumber: record.caseNumber, reason: record.reason, automatic }),
      },
    });
  } catch (error) {
    console.error("moderation: could not write the audit entry for an escalation:", error);
  }
}
