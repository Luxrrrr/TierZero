import { TICKET_STATS_PERIODS, type TicketStatsDto, type TicketStatsPeriod } from "@tier0/core";

/**
 * The arithmetic behind the ticket Stats tab, apart from React so the tests
 * can import it directly.
 */

export const DEFAULT_STATS_PERIOD: TicketStatsPeriod = 30;

export function parseStatsPeriod(raw: string | string[] | undefined): TicketStatsPeriod {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return (TICKET_STATS_PERIODS as readonly number[]).includes(value) ? (value as TicketStatsPeriod) : DEFAULT_STATS_PERIOD;
}

export interface RatingBar {
  stars: number;
  count: number;
  /** Of all ratings in the period, 0 to 100. */
  percent: number;
}

/** Five stars first, the way a reader scans a rating breakdown. */
export function ratingBars(distribution: TicketStatsDto["ratingDistribution"]): RatingBar[] {
  const total = distribution.reduce((sum, count) => sum + count, 0);
  return [5, 4, 3, 2, 1].map((stars) => {
    const count = distribution[stars - 1] ?? 0;
    return { stars, count, percent: total === 0 ? 0 : Math.round((count / total) * 100) };
  });
}

export function averageText(average: number | null): string {
  return average === null ? "No ratings" : average.toFixed(1);
}

/** A sentence for a screen reader in place of the per-day chart's shape. */
export function dayChartSummary(perDay: TicketStatsDto["perDay"]): string {
  const opened = perDay.reduce((sum, day) => sum + day.opened, 0);
  const closed = perDay.reduce((sum, day) => sum + day.closed, 0);
  if (opened === 0 && closed === 0) return "No tickets were opened or closed in this period.";
  const busiest = perDay.reduce((best, day) => (day.opened > best.opened ? day : best), perDay[0]!);
  return `${opened} opened and ${closed} closed. The most opened on one day was ${busiest.opened}, on ${busiest.date}.`;
}

/** Tickets closed for every one opened, as a word a non-specialist reads at a glance. */
export function backlogText(opened: number, closed: number): string {
  if (opened === 0 && closed === 0) return "Nothing came in";
  if (closed >= opened) return "Keeping up";
  const behind = opened - closed;
  return `${behind} more opened than closed`;
}

export function isQuietPeriod(stats: Pick<TicketStatsDto, "opened" | "closed" | "openNow">): boolean {
  return stats.opened === 0 && stats.closed === 0 && stats.openNow === 0;
}

/**
 * The inbox filtered to a Stats row's tickets, all statuses, from the query
 * the bot worked out for that row. Null when the bot sent none, or one that
 * is not a plain query string.
 */
export function statsListHref(guildId: string, listQuery: string | undefined): string | null {
  if (!listQuery || /[\s#/?]/.test(listQuery.replace(/^\?/, ""))) return null;
  const query = listQuery.replace(/^\?/, "");
  return query ? `/guilds/${guildId}/tickets?${query}` : `/guilds/${guildId}/tickets`;
}
