import type { GuildMember } from "discord.js";
import type { ModuleContext } from "@tier0/core";
import type { ModerationSettings } from "./settings.js";
import {
  ACTION_IN_PROGRESS,
  ActionRefused,
  BOT_RANK_DASHBOARD,
  NOT_A_MEMBER,
  alreadyBanned,
  checkBanDuration,
  checkDeleteDays,
  checkReason,
  checkTargetIdentity,
  checkTimeoutDuration,
  describeDiscordError,
  discordFailure,
  needsMember,
  notBanned,
  notTimedOut,
  outcomeNotes,
  shouldMessage,
  type ActionOrigin,
  type DmOutcome,
} from "./action-rules.js";
import { deleteMessageSeconds } from "./duration.js";
import { NOT_IN_SERVER } from "./hierarchy.js";
import { guardAgainstMember, guardForDashboard } from "./hierarchy-guard.js";
import { deactivateOpen, recordInfraction, type InfractionRecord } from "./infractions.js";
import { formatDirectMessage, type ModerationAction } from "./modlog.js";
import { tryDirectMessage } from "./dm.js";
import { fetchBanOrNull, fetchMemberOrNull } from "./lookups.js";
import { postModLog } from "./reply.js";

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
   * The refusal to give when the duration was typed but could not be read.
   * It is raised where a bad duration always has been, after the reason and,
   * for a ban, after the check for an existing ban.
   */
  unreadableDuration?: string;
  /** A ban's days of messages to delete; null takes the server's setting. */
  deleteDays: number | null;
  /** The person acting, as a member of this server, or null when they are not one. */
  actorMember: GuildMember | null;
  /** The person running this install, trusted to act on a server they have not joined. */
  actorIsInstanceOwner: boolean;
  origin: ActionOrigin;
}

export interface PerformOutcome {
  record: InfractionRecord;
  notes: string[];
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
  if (inFlight.has(key)) throw new ActionRefused(409, ACTION_IN_PROGRESS);
  inFlight.add(key);
  try {
    return await perform(ctx, input);
  } finally {
    inFlight.delete(key);
  }
}

const inFlight = new Set<string>();

async function perform(ctx: Ctx, input: PerformInput): Promise<PerformOutcome> {
  const { guild, settings } = ctx;
  const { action, targetId, origin } = input;
  const dashboard = origin === "dashboard";

  if (dashboard) {
    checkTargetIdentity(targetId, input.moderatorId, ctx.client.user?.id ?? null);
    if (!input.actorMember && !input.actorIsInstanceOwner) throw new ActionRefused(403, NOT_IN_SERVER);
  }

  const reason = checkReason(input.reason, settings);

  if (action === "ban" || action === "unban") {
    const existing = await fetchBanOrNull(guild, targetId);
    if (action === "ban" && existing) throw new ActionRefused(409, alreadyBanned(input.targetName, origin));
    if (action === "unban" && !existing) throw new ActionRefused(409, notBanned(input.targetName));
  }

  if (input.unreadableDuration !== undefined && (action === "timeout" || action === "ban")) {
    throw new ActionRefused(400, input.unreadableDuration);
  }
  const timeoutMs = action === "timeout" ? checkTimeoutDuration(input.durationMs) : null;
  const banMs = action === "ban" ? checkBanDuration(input.durationMs) : null;
  const deleteDays = action === "ban" ? checkDeleteDays(input.deleteDays, settings.deleteMessageDays) : 0;

  // A departed member has no roles left to weigh against the moderator's or
  // the bot's, so the hierarchy check only applies while they are still here.
  const targetMember = action === "unban" ? null : await fetchMemberOrNull(guild, targetId);
  if (!targetMember && needsMember(action, origin)) throw new ActionRefused(404, NOT_A_MEMBER);

  if (targetMember) {
    const requiresDiscordAction = action !== "warn";
    if (!dashboard && !input.actorMember) throw new ActionRefused(403, NOT_IN_SERVER);
    const verdict = dashboard
      ? guardForDashboard(guild, input.actorMember, input.actorIsInstanceOwner, targetMember, requiresDiscordAction)
      : guardAgainstMember(guild, input.actorMember!, targetMember, requiresDiscordAction);
    if (!verdict.allowed) {
      const message = dashboard && verdict.rule === "bot-rank" ? BOT_RANK_DASHBOARD : verdict.reason;
      throw new ActionRefused(403, message);
    }
  }

  if (dashboard && action === "timeout-clear" && targetMember && !targetMember.isCommunicationDisabled()) {
    throw new ActionRefused(409, notTimedOut(input.targetName));
  }

  const notify = async (expiresAt: Date | null): Promise<DmOutcome> => {
    const decision = shouldMessage(action, origin, targetMember !== null, settings.dmOnAction);
    if (decision !== "send") return decision;
    const sent = await tryDirectMessage(
      ctx.client,
      targetId,
      formatDirectMessage(guild.name, { action, reason, expiresAt }),
    );
    return sent ? "sent" : "failed";
  };

  const discordCall = async (call: () => Promise<unknown>): Promise<void> => {
    try {
      await call();
    } catch (error) {
      console.warn(
        `moderation: Discord refused ${action} on ${targetId} in guild ${guild.id}: ${describeDiscordError(error)}`,
      );
      throw new ActionRefused(502, discordFailure(action as Exclude<ModerationAction, "warn">, origin));
    }
  };

  let dm: DmOutcome = "off";
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
      dm = await notify(expiresAt);
      await discordCall(() => targetMember!.timeout(ms, reason ?? undefined));
      break;
    }
    case "timeout-clear":
      await discordCall(() => targetMember!.timeout(null, reason ?? undefined));
      await deactivateOpen(guild.id, targetId, "timeout");
      break;
    case "kick":
      dm = await notify(null);
      await discordCall(() => targetMember!.kick(reason ?? undefined));
      break;
    case "ban":
      expiresAt = banMs === null ? null : new Date(Date.now() + banMs);
      dm = await notify(expiresAt);
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
  });

  return {
    record,
    notes: outcomeNotes({ action, dm, modLog, targetInServer: action === "unban" || targetMember !== null }),
  };
}
