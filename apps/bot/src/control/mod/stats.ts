import { prisma } from "@tier0/db";
import type { StatsDto } from "@tier0/core";
import { refOf, resolveUsers } from "./names.js";
import { computeStats } from "./stats-calc.js";
import { ok, type ModCtx, type Reply } from "./types.js";

/** GET /mod/stats?days=30 -> StatsDto */
export async function modStats(ctx: ModCtx, days: number): Promise<Reply> {
  const guildId = ctx.guild.id;
  const now = new Date();

  // Whole-history rows are needed for members with a record, active cases, the
  // repeat rate and the comparison period (and to know whether anything
  // predates the range at all), so only the columns the arithmetic reads are fetched.
  const [infractions, notes] = await Promise.all([
    prisma.infraction.findMany({
      where: { guildId },
      select: {
        userId: true,
        moderatorId: true,
        action: true,
        createdAt: true,
        expiresAt: true,
        active: true,
        voidedAt: true,
        reason: true,
      },
    }),
    prisma.modNote.findMany({
      where: { guildId },
      select: { authorId: true, createdAt: true },
    }),
  ]);

  const stats = computeStats({ infractions, notes, now, days });
  const refs = await resolveUsers(ctx.client, ctx.guild, [
    ...stats.moderators.map((m) => m.userId),
    ...stats.topMembers.map((m) => m.userId),
  ]);

  const body: StatsDto = {
    days: stats.days,
    since: stats.since,
    totals: stats.totals,
    previous: stats.previous,
    perDay: stats.perDay,
    byAction: stats.byAction,
    moderators: stats.moderators.map(({ userId, ...rest }) => ({ user: refOf(refs, userId), ...rest })),
    topMembers: stats.topMembers.map(({ userId, count }) => ({ user: refOf(refs, userId), count })),
    byHour: stats.byHour,
    repeatRate: stats.repeatRate,
    automod: stats.automod,
  };
  return ok(body);
}
