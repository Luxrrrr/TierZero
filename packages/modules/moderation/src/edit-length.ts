import type { GuildMember } from "discord.js";
import type { ModuleContext } from "@tier0/core";
import type { ModerationSettings } from "./settings.js";
import { ActionRefused, checkBanDuration, checkTimeoutDuration, describeDiscordError } from "./action-rules.js";
import { NOT_IN_SERVER } from "./hierarchy.js";
import { guardForDashboard } from "./hierarchy-guard.js";
import { fetchBanOrNull, fetchMemberOrNull } from "./lookups.js";

export interface ChangeLengthInput {
  action: "timeout" | "ban";
  userId: string;
  targetName: string;
  /** The new length from now. Null is a permanent ban, and is not allowed for a timeout. */
  ms: number | null;
  reason: string | null;
  actorMember: GuildMember | null;
  actorIsInstanceOwner: boolean;
}

/**
 * Changes how long a timeout or ban that is still running lasts, in Discord as
 * well as on the record, and returns the new end (null for a permanent ban).
 * The new length counts from now, which is what Discord does for a timeout,
 * and what a moderator choosing "1 day" for a running ban means.
 *
 * The caller updates the record once this returns, so a refusal from Discord
 * leaves the record as it was.
 */
export async function changeLength(ctx: ModuleContext<ModerationSettings>, input: ChangeLengthInput): Promise<Date | null> {
  const { guild } = ctx;

  if (input.action === "timeout") {
    const ms = checkTimeoutDuration(input.ms);
    const member = await fetchMemberOrNull(guild, input.userId);
    if (!member) throw new ActionRefused(404, `${input.targetName} isn't in the server any more, so their timeout can't be changed.`);
    if (!input.actorMember && !input.actorIsInstanceOwner) throw new ActionRefused(403, NOT_IN_SERVER);
    const verdict = guardForDashboard(guild, input.actorMember, input.actorIsInstanceOwner, member, true);
    if (!verdict.allowed) throw new ActionRefused(403, verdict.reason);
    try {
      await member.timeout(ms, input.reason ?? undefined);
    } catch (error) {
      console.warn(`moderation: Discord refused a new timeout length on ${input.userId} in guild ${guild.id}: ${describeDiscordError(error)}`);
      throw new ActionRefused(502, "Discord didn't accept the new length, so nothing was changed. Check that the bot's role is above theirs.");
    }
    return new Date(Date.now() + ms);
  }

  const banMs = checkBanDuration(input.ms);
  if (!(await fetchBanOrNull(guild, input.userId))) {
    throw new ActionRefused(409, `${input.targetName} isn't banned any more, so the ban's length can't be changed.`);
  }
  // The lift is a scheduled task rather than a timer, so changing the length is changing that task.
  await ctx.tasks.cancel("unban", { userId: input.userId });
  if (banMs === null) return null;
  const endsAt = new Date(Date.now() + banMs);
  await ctx.tasks.schedule("unban", endsAt, { userId: input.userId });
  return endsAt;
}
