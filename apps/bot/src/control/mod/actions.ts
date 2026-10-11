import {
  canTakeAction,
  isModActionKind,
  type ActionContextDto,
  type ActionResult,
  type Actor,
  type ModActionKind,
  type ModuleContext,
} from "@tier0/core";
import { prisma } from "@tier0/db";
import {
  ActionRefused,
  actionContext,
  commandForAction,
  commandSwitchedOff,
  disabledActions,
  fetchMemberOrNull,
  performAction,
  readRequestFields,
  type ModerationSettings,
} from "@tier0/module-moderation";
import type { GuildState } from "../../runtime/guild-state.js";
import { infractionDto, isSnowflake } from "./dto.js";
import { createLimiter } from "./limiter.js";
import { refOf, resolveUsers } from "./names.js";
import { forbidden, ok, refuse, type ModCtx, type Reply } from "./types.js";

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
    const [actorMember, names] = await Promise.all([
      fetchMemberOrNull(ctx.guild, actor.userId),
      resolveUsers(ctx.client, ctx.guild, [targetId]),
    ]);

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
    });

    const refs = await resolveUsers(ctx.client, ctx.guild, [targetId, actor.userId]);
    const removed = action === "kick" || action === "ban";
    // A name looked up a moment ago may still say the member is here.
    const ref = (id: string) => {
      const found = refOf(refs, id);
      return removed && id === targetId ? { ...found, inServer: false } : found;
    };
    const infraction = infractionDto({ ...record, voidedAt: null, voidedBy: null, voidReason: null }, ref);
    const body: ActionResult = { caseNumber: record.caseNumber, infraction, notes };
    return ok(body);
  } catch (error) {
    if (error instanceof ActionRefused) return refusal(error);
    throw error;
  }
}
