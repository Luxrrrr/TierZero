import { PermissionFlagsBits, type GuildMember } from "discord.js";
import type { EvidenceMessage, ModuleContext } from "@tier0/core";
import type { ModerationSettings } from "./settings.js";
import {
  ActionRefused,
  checkActorMayAct,
  checkBanDuration,
  checkDeleteDays,
  checkReason,
  checkTargetIdentity,
  checkTimeoutDuration,
  describeDiscordError,
  discordFailureCode,
  needsMember,
  notTimedOut,
  outcomeNoteKeys,
  outcomeNotes,
  refusal,
  shouldMessage,
  type ActionOrigin,
  type DmOutcome,
  type OutcomeNote,
} from "./action-rules.js";
import { deleteMessageSeconds } from "./duration.js";
import { guardAgainstMember, guardForDashboard } from "./hierarchy-guard.js";
import { deactivateOpen, deactivateOpenTimeouts, recordInfraction, type InfractionRecord } from "./infractions.js";
import type { ModerationAction } from "./modlog.js";
import { tryCorrectionMessage, tryDirectMessage } from "./dm.js";
import { fetchBanOrNull, fetchMemberOrNull } from "./lookups.js";
import { postModLog } from "./reply.js";
import { staffRoleOf } from "./staff.js";
import { DEFAULT_WORDING, refusalSentence } from "./texts.js";

export interface PerformInput {
  action: ModerationAction;
  targetId: string;
  /** How a refusal names the target, such as their username. */
  targetName: string;
  /** Stored on the record as the moderator. */
  moderatorId: string;
  reason: string | null;
  /** A timeout's length (required) or a ban's (null for permanent). Ignored otherwise. */
  durationMs: number | null;
  /**
   * Set when a duration was typed but could not be read. The refusal is raised
   * where a bad duration always has been, after the reason and, for a ban,
   * after the check for an existing ban.
   */
  unreadableDuration?: boolean;
  /** A ban's days of messages to delete; null takes the server's setting. */
  deleteDays: number | null;
  /** The person acting, as a member of this server, or null when they are not one. */
  actorMember: GuildMember | null;
  /** The person running this install, trusted to act on a server they have not joined. */
  actorIsInstanceOwner: boolean;
  origin: ActionOrigin;
  /** Copies of messages to keep with the case. Taken before the action, because a ban can delete the messages. */
  evidence?: EvidenceMessage[];
}

export interface PerformOutcome {
  record: InfractionRecord;
  /** Worded for the dashboard. */
  notes: string[];
  /** The same notes by name, for a caller that words them from the server's settings. */
  noteKeys: OutcomeNote[];
}

type Ctx = ModuleContext<ModerationSettings>;

/**
 * Takes one moderation action: every check, the direct message, the call to
 * Discord, the record, any scheduled reversal and the mod log post. The slash
 * commands and the dashboard both come through here, so an action behaves the
 * same whichever way it was asked for. Throws ActionRefused when it will not
 * go ahead; anything else thrown is a fault.
 */
export async function performAction(ctx: Ctx, input: PerformInput): Promise<PerformOutcome> {
  // Two actions on one member at once could both pass the checks against the
  // same state, such as two bans that each find no existing ban.
  const key = `${ctx.guild.id}:${input.targetId}`;
  if (inFlight.has(key)) throw refusal(409, "actionInProgress", {}, input.origin);
  inFlight.add(key);
  try {
    return await perform(ctx, input);
  } finally {
    inFlight.delete(key);
  }
}

const inFlight = new Set<string>();

const DISCORD_PERMISSION: Record<ModerationAction, bigint> = {
  warn: PermissionFlagsBits.ModerateMembers,
  timeout: PermissionFlagsBits.ModerateMembers,
  "timeout-clear": PermissionFlagsBits.ModerateMembers,
  kick: PermissionFlagsBits.KickMembers,
  ban: PermissionFlagsBits.BanMembers,
  unban: PermissionFlagsBits.BanMembers,
};

async function perform(ctx: Ctx, input: PerformInput): Promise<PerformOutcome> {
  const { guild, settings } = ctx;
  const { action, targetId, origin } = input;
  const dashboard = origin === "dashboard";
  // The dashboard keeps the plain wording; the owner's labels are for what is said in Discord.
  const words = dashboard ? DEFAULT_WORDING : settings.labels;

  checkTargetIdentity(targetId, input.moderatorId, ctx.client.user?.id ?? null, guild.ownerId);
  if (dashboard && !input.actorMember && !input.actorIsInstanceOwner) throw refusal(403, "notInServer", {}, origin);

  // Checked here and not only where the command or the dashboard route is
  // reached, because the slash commands' default visibility is a setting an
  // operator can widen.
  checkActorMayAct(
    {
      action,
      hasDiscordPermission: input.actorMember?.permissions.has(DISCORD_PERMISSION[action]) ?? false,
      staffRole: input.actorIsInstanceOwner ? "owner" : await staffRoleOf(guild.id, input.moderatorId),
      isInstanceOwner: input.actorIsInstanceOwner,
    },
    words.abilities,
  );

  const reason = checkReason(input.reason, settings);

  if (action === "ban" || action === "unban") {
    const existing = await fetchBanOrNull(guild, targetId);
    if (action === "ban" && existing) throw refusal(409, "alreadyBanned", { name: input.targetName }, origin);
    if (action === "unban" && !existing) throw refusal(409, "notBanned", { name: input.targetName }, origin);
  }

  if (input.unreadableDuration && (action === "timeout" || action === "ban")) {
    throw refusal(400, action === "timeout" ? "durationUnreadableTimeout" : "durationUnreadableBan", {}, origin);
  }
  const timeoutMs = action === "timeout" ? checkTimeoutDuration(input.durationMs) : null;
  const banMs = action === "ban" ? checkBanDuration(input.durationMs) : null;
  const deleteDays = action === "ban" ? checkDeleteDays(input.deleteDays, settings.deleteMessageDays) : 0;

  // A departed member has no roles left to weigh against the moderator's or
  // the bot's, so the hierarchy check only applies while they are still here.
  const targetMember = action === "unban" ? null : await fetchMemberOrNull(guild, targetId);
  if (!targetMember && needsMember(action, origin)) throw refusal(404, "notAMember", {}, origin);

  if (targetMember) {
    const requiresDiscordAction = action !== "warn";
    if (!dashboard && !input.actorMember) throw refusal(403, "notInServer", {}, origin);
    const verdict = dashboard
      ? guardForDashboard(guild, input.actorMember, input.actorIsInstanceOwner, targetMember, requiresDiscordAction)
      : guardAgainstMember(guild, input.actorMember!, targetMember, requiresDiscordAction);
    if (!verdict.allowed) throw refusal(403, verdict.code, {}, origin);
  }

  // Discord would refuse these, and the member must not be told otherwise first.
  if (targetMember && (action === "timeout" || action === "kick" || action === "ban")) {
    const allowed = action === "timeout" ? targetMember.moderatable : action === "kick" ? targetMember.kickable : targetMember.bannable;
    if (!allowed) throw refusal(403, "cannotActOn", { verb: words.verbs[action] }, origin);
  }

  if (dashboard && action === "timeout-clear" && targetMember && !targetMember.isCommunicationDisabled()) {
    throw new ActionRefused(409, notTimedOut(input.targetName));
  }

  const notify = async (expiresAt: Date | null, durationMs: number | null = null): Promise<DmOutcome> => {
    const decision = shouldMessage(action, targetMember !== null, settings.dmOnAction);
    if (decision !== "send") return decision;
    const sent = await tryDirectMessage(ctx, targetId, {
      action,
      reason,
      expiresAt,
      durationMs,
      moderatorId: input.moderatorId,
    });
    return sent ? "sent" : "failed";
  };

  let dm: DmOutcome = "off";

  const discordCall = async (call: () => Promise<unknown>): Promise<void> => {
    try {
      await call();
    } catch (error) {
      console.warn(
        `moderation: Discord refused ${action} on ${targetId} in guild ${guild.id}: ${describeDiscordError(error)}`,
      );
      const failed = action as Exclude<ModerationAction, "warn">;
      const { code, values } = discordFailureCode(failed, words.verbs);
      let correctionNote = "";
      let plainNote = "";
      // The member may already have been told it happened, so say that it did not.
      if (dm === "sent") {
        const corrected = await tryCorrectionMessage(ctx, targetId, action);
        correctionNote = ` ${corrected ? words.notes.correctionSent : words.notes.correctionFailed}`;
        plainNote = ` ${corrected ? DEFAULT_WORDING.notes.correctionSent : DEFAULT_WORDING.notes.correctionFailed}`;
        console.warn(`moderation: ${action} on ${targetId} in guild ${guild.id} failed after the member was messaged; correction ${corrected ? "sent" : "not delivered"}`);
      }
      const sentence = refusalSentence(code, { ...discordFailureCode(failed).values, correctionNote: plainNote }, origin);
      throw new ActionRefused(502, sentence, code, { ...values, correctionNote });
    }
  };

  let expiresAt: Date | null = null;

  // Each branch keeps the order the slash command has always used. A message
  // about a removal is sent first, while the bot still shares a server with
  // the member; a message about a reversal is sent once it has happened.
  switch (action) {
    case "warn":
      dm = await notify(null);
      break;
    case "timeout": {
      const ms = timeoutMs!;
      expiresAt = new Date(Date.now() + ms);
      dm = await notify(expiresAt, ms);
      await discordCall(() => targetMember!.timeout(ms, reason ?? undefined));
      break;
    }
    case "timeout-clear":
      await discordCall(() => targetMember!.timeout(null, reason ?? undefined));
      await deactivateOpenTimeouts(guild.id, targetId);
      break;
    case "kick":
      dm = await notify(null);
      await discordCall(() => targetMember!.kick(reason ?? undefined));
      break;
    case "ban":
      expiresAt = banMs === null ? null : new Date(Date.now() + banMs);
      dm = await notify(expiresAt, banMs);
      await discordCall(() =>
        guild.members.ban(targetId, {
          reason: reason ?? undefined,
          deleteMessageSeconds: deleteMessageSeconds(deleteDays),
        }),
      );
      // A reversal left over from an earlier temporary ban would otherwise
      // lift this one when it fires.
      await ctx.tasks.cancel("unban", { userId: targetId });
      break;
    case "unban":
      await discordCall(() => guild.members.unban(targetId, reason ?? undefined));
      // A ban issued for a fixed duration schedules its own reversal; lifting it
      // early must cancel that or the member gets banned again when it fires.
      await ctx.tasks.cancel("unban", { userId: targetId });
      await deactivateOpen(guild.id, targetId, "ban");
      break;
  }

  const record = await recordInfraction({
    guildId: guild.id,
    userId: targetId,
    moderatorId: input.moderatorId,
    action,
    reason,
    expiresAt,
    evidence: input.evidence ?? [],
  });

  if (action === "ban" && expiresAt) {
    await ctx.tasks.schedule("unban", expiresAt, { userId: targetId });
  }

  if (action === "timeout-clear" || action === "unban") dm = await notify(null);

  const modLog = await postModLog(ctx, {
    caseNumber: record.caseNumber,
    action,
    targetId,
    moderatorId: input.moderatorId,
    reason,
    expiresAt,
    durationMs: action === "timeout" ? timeoutMs : banMs,
    createdAt: record.createdAt,
  });

  const facts = { action, dm, modLog, targetInServer: action === "unban" || targetMember !== null };
  return { record, notes: outcomeNotes(facts), noteKeys: outcomeNoteKeys(facts) };
}
