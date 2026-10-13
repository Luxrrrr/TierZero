import type { ModuleContext, TaskPayload } from "@tier0/core";
import type { ModerationSettings } from "./settings.js";
import { banOutlivesTask, describeDiscordError, isAbsentBan } from "./action-rules.js";
import { deactivateOpen, latestOpenBan, recordInfraction } from "./infractions.js";
import { tryDirectMessage } from "./dm.js";
import { postModLog } from "./reply.js";

type Ctx = ModuleContext<ModerationSettings>;

const MINUTE = 60_000;

/** How long to wait after each failed attempt; the last step repeats until the time runs out. */
export const UNBAN_RETRY_DELAYS_MS = [1 * MINUTE, 5 * MINUTE, 15 * MINUTE, 60 * MINUTE];

/** A ban that still cannot be lifted this long after it should have been is left, and logged. */
export const UNBAN_GIVE_UP_AFTER_MS = 24 * 60 * MINUTE;

export const TEMP_BAN_EXPIRED = "Temporary ban expired";

/**
 * When to try again after a failed attempt, or null once a day has passed
 * since the first one. `attempt` counts the attempts made so far.
 */
export function nextUnbanAttempt(attempt: number, startedAt: number, now: number): Date | null {
  if (now - startedAt >= UNBAN_GIVE_UP_AFTER_MS) return null;
  const delay = UNBAN_RETRY_DELAYS_MS[Math.min(attempt, UNBAN_RETRY_DELAYS_MS.length - 1)]!;
  return new Date(now + delay);
}

const numberField = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Lifts a temporary ban and, only once Discord has agreed, records it, tells
 * the member and posts to the mod log. The scheduler removes a task's row
 * before running it, so a failure that is worth another try has to schedule
 * that try itself; anything that returns normally is finished with.
 */
export async function liftTemporaryBan(
  payload: TaskPayload,
  ctx: Ctx,
  now: () => number = Date.now,
): Promise<void> {
  const userId = payload.userId;
  if (typeof userId !== "string") return;
  const attempt = numberField(payload.attempt) ?? 0;
  const startedAt = numberField(payload.startedAt) ?? now();

  const retry = async (error: unknown): Promise<void> => {
    const detail = describeDiscordError(error);
    const at = nextUnbanAttempt(attempt, startedAt, now());
    if (!at) {
      console.error(
        `moderation: giving up on lifting the temporary ban of ${userId} in guild ${ctx.guild.id} after a day of failures: ${detail}`,
      );
      return;
    }
    console.warn(
      `moderation: could not lift the temporary ban of ${userId} in guild ${ctx.guild.id}, trying again at ${at.toISOString()}: ${detail}`,
    );
    await ctx.tasks.schedule("unban", at, { userId, attempt: attempt + 1, startedAt });
  };

  const open = await latestOpenBan(ctx.guild.id, userId);
  if (banOutlivesTask(open, new Date(now()))) return;

  let alreadyLifted = false;
  try {
    await ctx.guild.bans.fetch(userId);
  } catch (error) {
    // Only Discord saying there is no ban counts. A timeout or an outage must
    // not be read as the ban being gone, or the member stays banned for good.
    if (!isAbsentBan(error)) return retry(error);
    alreadyLifted = true;
  }

  if (!alreadyLifted) {
    try {
      await ctx.guild.members.unban(userId, TEMP_BAN_EXPIRED);
    } catch (error) {
      if (!isAbsentBan(error)) return retry(error);
      alreadyLifted = true;
    }
  }

  // Someone lifted it by hand elsewhere. Close the record so it stops reading
  // as a ban in force, but say nothing to anyone: nothing happened just now.
  const moderatorId = ctx.client.user?.id ?? userId;
  if (alreadyLifted && !open) return;
  await deactivateOpen(ctx.guild.id, userId, "ban");
  const record = await recordInfraction({
    guildId: ctx.guild.id,
    userId,
    moderatorId,
    action: "unban",
    reason: TEMP_BAN_EXPIRED,
  });
  if (alreadyLifted) return;

  if (ctx.settings.dmOnAction) {
    await tryDirectMessage(ctx, userId, {
      action: "unban",
      reason: TEMP_BAN_EXPIRED,
      expiresAt: null,
      moderatorId,
    });
  }

  await postModLog(ctx, {
    caseNumber: record.caseNumber,
    action: "unban",
    targetId: userId,
    moderatorId,
    reason: TEMP_BAN_EXPIRED,
    expiresAt: null,
  });
}
