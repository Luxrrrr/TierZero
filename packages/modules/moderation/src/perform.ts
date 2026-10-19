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
import { actorRoleFor, auditAction, type ActionAuditOptions } from "./action-audit.js";
import { botMayDelete, deleteAttachedMessages, deletionNotes, markDeleted, type DeletionReport } from "./delete-evidence.js";
import { deleteMessageSeconds } from "./duration.js";
import { escalateAfterWarning, type EscalationOutcome } from "./escalation.js";
import { guardAgainstMember, guardForDashboard } from "./hierarchy-guard.js";
import { countWarnings, deactivateOpen, deactivateOpenTimeouts, discardRecord, recordInfraction, saveEvidence, type InfractionRecord } from "./infractions.js";
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
  /**
   * Deletes the messages in `evidence` once the action has gone through. It only ever reaches those
   * messages, and only for a warning, timeout, kick or ban.
   */
  deleteMessages?: boolean;
  /** Leaves out the direct message about the action, for a caller that sends its own, such as an accepted appeal. */
  noDirectMessage?: boolean;
  /** How the actor is named in Staff activity, or that no entry is wanted. The performer writes it for every origin. */
  audit?: ActionAuditOptions;
}

export interface PerformOutcome {
  record: InfractionRecord;
  /** Worded for the dashboard. */
  notes: string[];
  /** The same notes by name, for a caller that words them from the server's settings. */
  noteKeys: OutcomeNote[];
  /** The case an escalation rule took straight after this warning, if one did. */
  escalation?: EscalationOutcome | null;
  /** What became of the attached messages, when the action was asked to delete them. */
  deletion?: DeletionReport | null;
}

type Ctx = ModuleContext<ModerationSettings>;

/**
 * Takes one moderation action: every check, the direct message, the call to
 * Discord, the record, the Staff activity entry, any scheduled reversal and the mod log post. The slash
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

  // Written before the member is told, so their message can carry the case number. An action Discord then
  // refuses has its case taken back, so the record never says something happened that did not.
  let pending: InfractionRecord | null = null;
  const writeRecord = (expiresAt: Date | null): Promise<InfractionRecord> =>
    recordInfraction({
      guildId: guild.id,
      userId: targetId,
      moderatorId: input.moderatorId,
      action,
      reason,
      expiresAt,
      evidence: input.evidence ?? [],
    });

  const deletes = input.deleteMessages === true && (action === "warn" || action === "timeout" || action === "kick" || action === "ban");
  const attached = input.evidence ?? [];

  const notify = async (expiresAt: Date | null, durationMs: number | null = null): Promise<DmOutcome> => {
    const decision = shouldMessage(action, targetMember !== null, settings.dmOnAction && !input.noDirectMessage);
    if (decision !== "send") return decision;
    const sent = await tryDirectMessage(
      ctx,
      targetId,
      { action, reason, expiresAt, durationMs, moderatorId: input.moderatorId },
      {
        caseNumber: pending?.caseNumber,
        createdAt: pending?.createdAt,
        // A message about to be deleted has no link worth opening, so the member is shown it as removed.
        evidence: deletes ? attached.map((message) => (botMayDelete(guild, message) ? { ...message, deleted: true } : message)) : input.evidence,
        moderatorDisplayName: input.actorMember?.displayName,
        warnings: action === "warn" ? await countWarnings(guild.id, targetId, settings.warnExpiry ?? null).catch(() => undefined) : undefined,
      },
    );
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
      if (pending) await discardRecord(pending.id);
      pending = null;
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
      pending = await writeRecord(null);
      dm = await notify(null);
      break;
    case "timeout": {
      const ms = timeoutMs!;
      expiresAt = new Date(Date.now() + ms);
      pending = await writeRecord(expiresAt);
      dm = await notify(expiresAt, ms);
      await discordCall(() => targetMember!.timeout(ms, reason ?? undefined));
      break;
    }
    case "timeout-clear":
      await discordCall(() => targetMember!.timeout(null, reason ?? undefined));
      await deactivateOpenTimeouts(guild.id, targetId);
      break;
    case "kick":
      pending = await writeRecord(null);
      dm = await notify(null);
      await discordCall(() => targetMember!.kick(reason ?? undefined));
      break;
    case "ban":
      expiresAt = banMs === null ? null : new Date(Date.now() + banMs);
      pending = await writeRecord(expiresAt);
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

  let record = pending ?? (await writeRecord(expiresAt));
  pending = record;

  // Only now that the action has gone through, so one Discord refused deletes nothing.
  let deletion: DeletionReport | null = null;
  if (deletes && attached.length > 0) {
    const by = { id: input.moderatorId, ...(input.actorMember?.displayName ? { name: input.actorMember.displayName } : {}) };
    deletion = await deleteAttachedMessages(guild, attached, by);
    if (deletion.deleted.length > 0 || deletion.alreadyGone.length > 0) {
      try {
        const evidence = await saveEvidence(record.id, markDeleted(attached, deletion, by));
        record = { ...record, evidence };
        pending = record;
      } catch (error) {
        console.error("moderation: could not mark the deleted messages on the case:", error);
      }
    }
  }

  // After the deletion, so the line can say how many messages went.
  if (!input.audit?.skip) {
    await auditAction({
      guildId: guild.id,
      actorId: input.moderatorId,
      actorName: input.audit?.actorName ?? input.actorMember?.displayName ?? input.moderatorId,
      actorRole: input.audit?.actorRole ?? (await actorRoleFor(guild.id, input.moderatorId, input.actorIsInstanceOwner)),
      targetId,
      targetName: input.audit?.targetName !== undefined ? input.audit.targetName : input.targetName,
      action,
      record,
      deletion,
    });
  }

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
  const notes = outcomeNotes(facts);
  // Counted once the warning is on the record, so it is among the warnings counted.
  const escalation = action === "warn" ? await escalateAfterWarning(ctx, targetId) : null;
  if (escalation) notes.push(escalationNote(escalation));
  if (deletion) notes.push(...deletionNotes(deletion));
  return { record, notes, noteKeys: outcomeNoteKeys(facts), escalation, deletion };
}

const ESCALATED: Record<EscalationOutcome["action"], string> = { timeout: "timed them out", kick: "kicked them", ban: "banned them" };

/** The dashboard's side note when a warning set off an escalation rule. */
export function escalationNote(outcome: Pick<EscalationOutcome, "action" | "automatic" | "record">): string {
  return `This warning reached the escalation rule "${outcome.automatic.rule}", which ${ESCALATED[outcome.action]} as case #${outcome.record.caseNumber}.`;
}
