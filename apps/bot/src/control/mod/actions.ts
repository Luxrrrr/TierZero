import {
  canEditInfraction,
  canTakeAction,
  isInForce,
  isModActionKind,
  readEvidence,
  type EvidenceMessage,
  type ActionContextDto,
  type ActionTargetDto,
  parseEvidenceRefs,
  type ActionResult,
  type Actor,
  type ModActionKind,
  type ModuleContext,
} from "@tier0/core";
import { prisma } from "@tier0/db";
import {
  ActionRefused,
  actionContext,
  blockedActions,
  commandForAction,
  changeLength,
  commandSwitchedOff,
  disabledActions,
  fetchBanOrNull,
  fetchMemberOrNull,
  performAction,
  presetDtos,
  readRequestFields,
  recentFor,
  resolveEvidence,
  type ModerationSettings,
} from "@tier0/module-moderation";
import type { GuildState } from "../../runtime/guild-state.js";
import { writeAudit } from "./audit.js";
import { checkVoidReason, describeCase, infractionDto, infractionSnapshot, isSnowflake, joinWords } from "./dto.js";
import { createLimiter } from "./limiter.js";
import { refOf, resolveUsers } from "./names.js";
import { forbidden, notFound, ok, refuse, type ModCtx, type Reply } from "./types.js";

/**
 * Moderation actions taken from the dashboard. The work itself is the
 * moderation module's performer, the same one behind the slash commands; this
 * file only decides who may ask, and translates between HTTP and the module.
 * The infraction the performer writes is the record of the action, so no
 * audit row is added here.
 */

const MODULE_ID = "moderation";

export const ACTIONS_PER_MINUTE = 20;
const limiter = createLimiter({ limit: ACTIONS_PER_MINUTE, windowMs: 60_000 });

export const MODULE_OFF =
  "Turn on the Moderation feature to take actions from here, because it decides the mod log channel, the direct message and the defaults.";
export const SETTINGS_UNREADABLE =
  "The Moderation settings for this server could not be read. Open them in the dashboard and save them again.";
export const UNKNOWN_ACTION = "Choose an action: warn, timeout, timeout-clear, kick, ban or unban.";

const PERMISSION_TEXT: Record<ModActionKind, string> = {
  warn: "warn members",
  timeout: "time members out",
  "timeout-clear": "clear timeouts",
  kick: "kick members",
  ban: "ban members",
  unban: "lift bans",
};

type ModerationContext = ModuleContext<ModerationSettings>;

const ACTION_PAST: Record<ModActionKind, string> = {
  warn: "Warned",
  timeout: "Timed out",
  "timeout-clear": "Cleared the timeout of",
  kick: "Kicked",
  ban: "Banned",
  unban: "Unbanned",
};

const clipReason = (text: string): string => (text.length > 120 ? `${text.slice(0, 117)}...` : text);
/** The moderation module's context for this server, or null when its stored settings fail validation. */
async function moderationContext(ctx: ModCtx, state: GuildState): Promise<ModerationContext | null> {
  const moduleCtx = await state.context(ctx.guild, MODULE_ID);
  return moduleCtx as unknown as ModerationContext | null;
}

const refusal = (error: ActionRefused): Reply => ({ status: error.status, body: { error: error.message } });

/**
 * Commands an operator has switched off on the Commands page. The same rows
 * hide the slash commands, so an action switched off there is switched off here.
 */
async function switchedOffCommands(guildId: string, names?: string[]): Promise<string[]> {
  const rows = await prisma.commandOverride.findMany({
    where: { guildId, enabled: false, ...(names ? { command: { in: names } } : {}) },
    select: { command: true },
  });
  return rows.map((row) => row.command);
}

export async function actionContextFor(ctx: ModCtx, state: GuildState): Promise<Reply> {
  const moduleCtx = await moderationContext(ctx, state);
  if (!moduleCtx) return refuse(409, SETTINGS_UNREADABLE);
  const moduleEnabled = await state.isEnabled(ctx.guild.id, MODULE_ID);
  const body: ActionContextDto = {
    moduleEnabled,
    ...actionContext(moduleCtx.settings),
    reasonPresets: presetDtos(moduleCtx.settings.reasonPresets),
    disabledActions: disabledActions(await switchedOffCommands(ctx.guild.id)),
  };
  return ok(body);
}

export async function takeAction(
  ctx: ModCtx,
  state: GuildState,
  targetId: string,
  actor: Actor,
  payload: Record<string, unknown>,
): Promise<Reply> {
  const action = payload.action;
  if (!isModActionKind(action)) return refuse(400, UNKNOWN_ACTION);
  if (!isSnowflake(targetId)) return refuse(400, "That is not a valid Discord user id.");
  if (!canTakeAction(actor.role, action)) return forbidden(PERMISSION_TEXT[action]);

  if (!(await state.isEnabled(ctx.guild.id, MODULE_ID))) return refuse(409, MODULE_OFF);
  const moduleCtx = await moderationContext(ctx, state);
  if (!moduleCtx) return refuse(409, SETTINGS_UNREADABLE);
  if ((await switchedOffCommands(ctx.guild.id, [commandForAction(action)])).length > 0) {
    return refuse(409, commandSwitchedOff(action));
  }

  const taken = limiter.take(`${ctx.guild.id}:${actor.userId}`);
  if (!taken.ok) {
    return refuse(
      429,
      `You are taking actions too quickly. Try again in ${Math.ceil(taken.retryAfterMs / 1000)} seconds.`,
    );
  }

  try {
    const fields = readRequestFields(action, payload);
    const evidenceRefs = parseEvidenceRefs(payload.evidence);
    if (!evidenceRefs.ok) return refuse(400, evidenceRefs.error);
    const [actorMember, names] = await Promise.all([
      fetchMemberOrNull(ctx.guild, actor.userId),
      resolveUsers(ctx.client, ctx.guild, [targetId]),
    ]);

    // Copied before the action runs: a ban can delete the member's recent messages.
    const evidence = await resolveEvidence(ctx.guild, targetId, evidenceRefs.refs, { member: actorMember, isOwner: actor.role === "owner" });

    const { record, notes } = await performAction(moduleCtx, {
      action,
      targetId,
      targetName: refOf(names, targetId).name ?? "That user",
      moderatorId: actor.userId,
      reason: fields.reason,
      durationMs: fields.durationMs,
      deleteDays: fields.deleteDays,
      actorMember,
      actorIsInstanceOwner: actor.role === "owner",
      origin: "dashboard",
      evidence,
    });

    const refs = await resolveUsers(ctx.client, ctx.guild, [targetId, actor.userId]);
    const removed = action === "kick" || action === "ban";
    // A name looked up a moment ago may still say the member is here.
    const ref = (id: string) => {
      const found = refOf(refs, id);
      return removed && id === targetId ? { ...found, inServer: false } : found;
    };
    const infraction = infractionDto({ ...record, voidedAt: null, voidedBy: null, voidReason: null }, ref, ctx.warnExpiryMs ?? null);
    const body: ActionResult = { caseNumber: record.caseNumber, infraction, notes };

    // The case is the record of the action, and the audit trail is the record of who took it from the
    // dashboard, owner included. A failure to write the entry must not undo an action that already happened.
    await writeAudit({
      guildId: ctx.guild.id,
      actor,
      kind: "action.take",
      summary: `${ACTION_PAST[action]} ${refOf(refs, targetId).name ?? targetId} (case #${record.caseNumber})${record.reason ? `: ${clipReason(record.reason)}` : ""}`,
      targetUserId: targetId,
      infractionId: record.id,
      after: { action, caseNumber: record.caseNumber, reason: record.reason },
    }).catch((error: unknown) => console.error("mod: could not write the audit entry for an action:", error));

    return ok(body);
  } catch (error) {
    if (error instanceof ActionRefused) return refusal(error);
    throw error;
  }
}

/**
 * GET /mod/members/:id/standing -> ActionTargetDto. What Discord says about the member now, and which actions the
 * bot would refuse this viewer, by the rules `performAction` applies. The dashboard names the viewer from the session.
 */
export async function actionTarget(ctx: ModCtx, targetId: string, viewerId: string | null, isOwner: boolean): Promise<Reply> {
  if (!isSnowflake(targetId)) return refuse(400, "That is not a valid Discord user id.");
  if (!viewerId || !isSnowflake(viewerId)) return refuse(400, "The request did not say who is asking.");
  try {
    const [actor, target] = await Promise.all([fetchMemberOrNull(ctx.guild, viewerId), fetchMemberOrNull(ctx.guild, targetId)]);
    // A failed ban lookup leaves the dashboard to go by the record, rather than failing the whole menu.
    const banned = target ? false : await fetchBanOrNull(ctx.guild, targetId).then((ban) => ban !== null, () => null);
    const until = target?.communicationDisabledUntil ?? null;
    const body: ActionTargetDto = {
      inServer: target !== null,
      banned,
      timedOutUntil: until && until.getTime() > Date.now() ? until.toISOString() : null,
      blocked: blockedActions({
        targetId,
        actorId: viewerId,
        botId: ctx.client.user?.id ?? null,
        ownerId: ctx.guild.ownerId,
        actor: actor ? { topRole: actor.roles.highest.position, isServerOwner: actor.id === ctx.guild.ownerId } : null,
        actorIsInstanceOwner: isOwner,
        target: target
          ? { topRole: target.roles.highest.position, moderatable: target.moderatable, kickable: target.kickable, bannable: target.bannable }
          : null,
        botTopRole: ctx.guild.members.me?.roles.highest.position ?? 0,
      }),
    };
    return ok(body);
  } catch (error) {
    if (error instanceof ActionRefused) return refusal(error);
    throw error;
  }
}

/** GET /mod/members/:id/messages -> what the bot remembers of the member's latest messages that the viewer can read. */
export async function memberMessages(ctx: ModCtx, userId: string, viewerId: string | null, isOwner: boolean): Promise<Reply> {
  if (!isSnowflake(userId)) return refuse(400, "That is not a valid Discord user id.");
  const member = viewerId ? await fetchMemberOrNull(ctx.guild, viewerId) : null;
  return ok({ messages: await recentFor(ctx.guild, userId, { member, isOwner }) });
}

/**
 * PATCH /mod/infractions/:id -> changes what a case says: its reason, how long a running timeout or ban
 * lasts, and which messages are attached. Each part is optional and left alone when it is missing.
 * The old and new case go into one audit entry, so Staff activity shows exactly what changed.
 */
export async function editInfraction(
  ctx: ModCtx,
  state: GuildState,
  id: number,
  actor: Actor,
  payload: Record<string, unknown>,
): Promise<Reply> {
  const seen = await prisma.infraction.findFirst({ where: { id, guildId: ctx.guild.id } });
  if (!seen) return notFound("That case");
  if (!canEditInfraction(actor.role, seen.moderatorId === actor.userId)) {
    return forbidden("edit this case. Moderators can only edit their own");
  }
  if (seen.voidedAt) return refuse(409, "That case was removed from the record. Restore it before editing.");

  const data: { reason?: string; expiresAt?: Date | null; evidence?: string } = {};
  const changes: string[] = [];

  if (payload.reason !== undefined) {
    const checked = checkVoidReason(payload.reason);
    if (!checked.ok) return refuse(400, checked.error);
    if (checked.value !== seen.reason) {
      data.reason = checked.value;
      changes.push("the reason");
    }
  }

  const moduleCtx = (await state.context(ctx.guild, MODULE_ID)) as unknown as ModerationContext | null;

  try {
    if (payload.durationMs !== undefined) {
      if (seen.action !== "timeout" && seen.action !== "ban") return refuse(400, "Only a timeout or a ban has a length to change.");
      if (!isInForce({ action: seen.action, active: seen.active, expiresAt: seen.expiresAt, removed: false })) {
        return refuse(409, `That ${seen.action} has already ended, so its length can't change.`);
      }
      if (!canTakeAction(actor.role, seen.action)) return forbidden(seen.action === "ban" ? "change a ban" : "change a timeout");
      const wanted = payload.durationMs;
      if (wanted !== null && typeof wanted !== "number") return refuse(400, "The length must be a number of milliseconds, or empty for a permanent ban.");
      if (!moduleCtx) return refuse(409, SETTINGS_UNREADABLE);
      const [actorMember, names] = await Promise.all([
        fetchMemberOrNull(ctx.guild, actor.userId),
        resolveUsers(ctx.client, ctx.guild, [seen.userId]),
      ]);
      const endsAt = await changeLength(moduleCtx, {
        action: seen.action,
        userId: seen.userId,
        targetName: refOf(names, seen.userId).name ?? "That member",
        ms: wanted,
        reason: seen.reason,
        actorMember,
        actorIsInstanceOwner: actor.role === "owner",
      });
      data.expiresAt = endsAt;
      changes.push("the length");
    }

    if (payload.evidence !== undefined) {
      const refs = parseEvidenceRefs(payload.evidence);
      if (!refs.ok) return refuse(400, refs.error);
      const current = readEvidence(seen.evidence);
      const actorMember = await fetchMemberOrNull(ctx.guild, actor.userId);
      const next: EvidenceMessage[] = [];
      for (const ref of refs.refs) {
        const existing = current.find((m) => m.id === ref.messageId);
        if (existing) {
          // A message already attached keeps the text it was saved with. Only which version is flagged can change.
          const count = existing.versions?.length ?? 0;
          const { flagged: _old, ...rest } = existing;
          next.push(ref.version !== undefined && ref.version < count - 1 ? { ...rest, flagged: ref.version } : rest);
        } else {
          next.push(...(await resolveEvidence(ctx.guild, seen.userId, [ref], { member: actorMember, isOwner: actor.role === "owner" })));
        }
      }
      const serialized = JSON.stringify(next);
      if (serialized !== seen.evidence) {
        data.evidence = serialized;
        changes.push("the attached messages");
      }
    }
  } catch (error) {
    if (error instanceof ActionRefused) return refusal(error);
    throw error;
  }

  // Saving what is already there is not an edit, so it leaves no mark and no audit entry.
  if (changes.length === 0) return ok(await presentCase(ctx, seen));

  const target = (await resolveUsers(ctx.client, ctx.guild, [seen.userId])).get(seen.userId);
  const described = describeCase(seen, target ?? { userId: seen.userId, name: null, avatarUrl: null, inServer: false });

  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.infraction.updateMany({
      where: { id, guildId: ctx.guild.id, voidedAt: null },
      data: { ...data, editedAt: new Date(), editedBy: actor.userId },
    });
    if (changed.count === 0) return null;
    const row = await tx.infraction.findUniqueOrThrow({ where: { id } });
    await writeAudit(
      {
        guildId: ctx.guild.id,
        actor,
        kind: "infraction.edit",
        summary: `Edited ${joinWords(changes)} on ${described}`,
        targetUserId: seen.userId,
        infractionId: id,
        before: infractionSnapshot(seen),
        after: infractionSnapshot(row),
      },
      tx,
    );
    return row;
  });
  if (!updated) return refuse(409, "That case was removed from the record. Restore it before editing.");
  return ok(await presentCase(ctx, updated));
}

async function presentCase(ctx: ModCtx, row: NonNullable<Awaited<ReturnType<typeof prisma.infraction.findFirst>>>) {
  const ids = [row.userId, row.moderatorId, ...(row.editedBy ? [row.editedBy] : [])];
  const refs = await resolveUsers(ctx.client, ctx.guild, ids);
  return infractionDto(row, (userId) => refOf(refs, userId), ctx.warnExpiryMs ?? null);
}
