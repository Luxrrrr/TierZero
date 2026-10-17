import { prisma } from "@tier0/db";
import type { StatsDto } from "@tier0/core";
import { buildStatsExport, statsExportFilename } from "./csv.js";
import { refOf, resolveUsers } from "./names.js";
import { computeStats, type StatsRange } from "./stats-calc.js";
import { ok, type ModCtx, type Reply } from "./types.js";

async function statsFor(guildId: string, range: StatsRange, now: Date) {
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
  return computeStats({ infractions, notes, now, range });
}

/** GET /mod/stats?days=30, ?range=all or ?from=YYYY-MM-DD&to=YYYY-MM-DD -> StatsDto */
export async function modStats(ctx: ModCtx, range: StatsRange): Promise<Reply> {
  const stats = await statsFor(ctx.guild.id, range, new Date());
  const refs = await resolveUsers(ctx.client, ctx.guild, [
    ...stats.moderators.map((m) => m.userId),
    ...stats.topMembers.map((m) => m.userId),
  ]);

  const body: StatsDto = {
    days: stats.days,
    since: stats.since,
    until: stats.until,
    range: stats.range,
    bucket: stats.bucket,
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

/** GET /mod/stats/export with the same query as the stats -> CSV of the chart's points and each moderator's totals. */
export async function exportStats(ctx: ModCtx, range: StatsRange): Promise<Reply> {
  const now = new Date();
  const stats = await statsFor(ctx.guild.id, range, now);
  const refs = await resolveUsers(
    ctx.client,
    ctx.guild,
    stats.moderators.map((m) => m.userId),
  );
  return {
    status: 200,
    body: null,
    raw: {
      contentType: "text/csv; charset=utf-8",
      text: buildStatsExport(stats, (id) => refs.get(id)?.name ?? null),
      filename: statsExportFilename(ctx.guild.id, stats),
    },
  };
}
