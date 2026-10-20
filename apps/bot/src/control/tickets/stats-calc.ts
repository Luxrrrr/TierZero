import { LEGACY_TYPE_ID, medianOf, ticketListQuery, type TicketStatsGroup } from "@tier0/shared-tickets";

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * Ticket statistics as a pure function of the rows, so the arithmetic can be
 * tested without a database. The period starts at UTC midnight `days - 1`
 * days ago and runs to now, so a 7 day period always has seven days in it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface StatsTicket {
  typeId: string | null;
  typeName: string;
  openerId: string;
  status: string;
  openedAt: Date;
  closedAt: Date | null;
  closedBy: string | null;
  firstResponseAt: Date | null;
  rating: number | null;
  ratedAt: Date | null;
  /** Who answered first. Missing from rows read before it was kept. */
  firstResponderId?: string | null;
  /** Who had it claimed, which a rating is put down to. */
  claimedById?: string | null;
}

export interface StatsClaim {
  actorId: string | null;
  createdAt: Date;
}

export interface StatsInput {
  tickets: readonly StatsTicket[];
  /** `claimed` events of the tickets above. */
  claims: readonly StatsClaim[];
  now: Date;
  days: number;
  /** Current names of the configured types, which win over the name copied onto old tickets. */
  typeNames: ReadonlyMap<string, string>;
  /** The bot's own account, whose closes are inactivity and close requests timing out, not a handler's work. */
  botId: string | null;
}

export interface StatsResult extends TicketStatsGroup {
  days: number;
  since: string;
  openNow: number;
  ratingDistribution: [number, number, number, number, number];
  perDay: { date: string; opened: number; closed: number }[];
  byType: (TicketStatsGroup & { typeId: string | null; typeName: string; openNow: number; listQuery: string })[];
  byHandler: HandlerStats[];
  byHour: number[];
}

export interface HandlerStats {
  userId: string;
  claims: number;
  closes: number;
  firstResponses: number;
  medianFirstResponseMs: number | null;
  averageRating: number | null;
  ratingCount: number;
  /** The ticket list's query string for what they claimed, closed or answered first, every status. */
  listQuery: string;
}

const utcMidnight = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

interface Accumulator {
  opened: number;
  closed: number;
  firstResponses: number[];
  resolutions: number[];
  ratings: number[];
  openNow: number;
}

const emptyAccumulator = (): Accumulator => ({ opened: 0, closed: 0, firstResponses: [], resolutions: [], ratings: [], openNow: 0 });

function groupOf(acc: Accumulator): TicketStatsGroup {
  const ratingSum = acc.ratings.reduce((sum, value) => sum + value, 0);
  return {
    opened: acc.opened,
    closed: acc.closed,
    medianFirstResponseMs: medianOf(acc.firstResponses),
    medianResolutionMs: medianOf(acc.resolutions),
    averageRating: acc.ratings.length === 0 ? null : Math.round((ratingSum / acc.ratings.length) * 100) / 100,
    ratingCount: acc.ratings.length,
  };
}

export function computeTicketStats(input: StatsInput): StatsResult {
  const days = Math.max(1, Math.trunc(input.days));
  const nowMs = input.now.getTime();
  const sinceMs = utcMidnight(input.now) - (days - 1) * DAY_MS;
  const inPeriod = (date: Date | null): date is Date => date !== null && date.getTime() >= sinceMs && date.getTime() <= nowMs;

  const perDay = Array.from({ length: days }, (_, index) => ({
    date: new Date(sinceMs + index * DAY_MS).toISOString().slice(0, 10),
    opened: 0,
    closed: 0,
  }));
  const dayOf = (date: Date) => perDay[Math.floor((date.getTime() - sinceMs) / DAY_MS)];

  const total = emptyAccumulator();
  const byType = new Map<string, { typeId: string | null; typeName: string; acc: Accumulator }>();
  const handlers = new Map<string, { claims: number; closes: number; waits: number[]; ratings: number[] }>();
  const byHour = Array.from({ length: 24 }, () => 0);
  const ratingDistribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];

  const handler = (userId: string) => {
    let entry = handlers.get(userId);
    if (!entry) handlers.set(userId, (entry = { claims: 0, closes: 0, waits: [], ratings: [] }));
    return entry;
  };

  for (const ticket of input.tickets) {
    // A ticket from before types existed belongs to the type the upgrade made, so it groups with that type's new tickets.
    const typeKey = ticket.typeId ?? LEGACY_TYPE_ID;
    let type = byType.get(typeKey);
    if (!type) {
      const typeName = input.typeNames.get(typeKey) ?? ticket.typeName;
      byType.set(typeKey, (type = { typeId: typeKey, typeName, acc: emptyAccumulator() }));
    }
    const accs = [total, type.acc];

    if (ticket.status === "open") for (const acc of accs) acc.openNow++;

    if (inPeriod(ticket.openedAt)) {
      for (const acc of accs) acc.opened++;
      const day = dayOf(ticket.openedAt);
      if (day) day.opened++;
      byHour[ticket.openedAt.getUTCHours()]!++;
      if (ticket.firstResponseAt && ticket.firstResponseAt.getTime() >= ticket.openedAt.getTime()) {
        const waited = ticket.firstResponseAt.getTime() - ticket.openedAt.getTime();
        for (const acc of accs) acc.firstResponses.push(waited);
        const responder = ticket.firstResponderId;
        if (responder && SNOWFLAKE.test(responder) && responder !== input.botId) handler(responder).waits.push(waited);
      }
    }

    if (ticket.status === "closed" && inPeriod(ticket.closedAt)) {
      for (const acc of accs) acc.closed++;
      const day = dayOf(ticket.closedAt);
      if (day) day.closed++;
      const took = ticket.closedAt.getTime() - ticket.openedAt.getTime();
      if (took >= 0) for (const acc of accs) acc.resolutions.push(took);
      const closer = ticket.closedBy;
      // An automatic close is recorded under a name, not a member, and is nobody's work.
      if (closer && SNOWFLAKE.test(closer) && closer !== ticket.openerId && closer !== input.botId) handler(closer).closes++;
    }

    const rating = ticket.rating;
    if (rating !== null && Number.isInteger(rating) && rating >= 1 && rating <= 5 && inPeriod(ticket.ratedAt ?? ticket.closedAt)) {
      for (const acc of accs) acc.ratings.push(rating);
      ratingDistribution[rating - 1] = (ratingDistribution[rating - 1] ?? 0) + 1;
      const claimer = ticket.claimedById;
      if (claimer && SNOWFLAKE.test(claimer) && claimer !== input.botId) handler(claimer).ratings.push(rating);
    }
  }

  for (const claim of input.claims) {
    if (claim.actorId && claim.actorId !== input.botId && inPeriod(claim.createdAt)) handler(claim.actorId).claims++;
  }

  return {
    days,
    since: new Date(sinceMs).toISOString(),
    ...groupOf(total),
    openNow: total.openNow,
    ratingDistribution,
    perDay,
    byType: [...byType.values()]
      .map(({ typeId, typeName, acc }) => ({
        typeId,
        typeName,
        openNow: acc.openNow,
        ...groupOf(acc),
        listQuery: ticketListQuery({ status: "all", typeIds: typeId ? [typeId] : [] }),
      }))
      .sort((a, b) => b.opened - a.opened || b.openNow - a.openNow || a.typeName.localeCompare(b.typeName)),
    byHandler: [...handlers.entries()]
      .map(([userId, { claims, closes, waits, ratings }]) => ({
        userId,
        claims,
        closes,
        firstResponses: waits.length,
        medianFirstResponseMs: medianOf(waits),
        averageRating: ratings.length === 0 ? null : Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 100) / 100,
        ratingCount: ratings.length,
        listQuery: ticketListQuery({ status: "all", handlerId: userId }),
      }))
      .sort(
        (a, b) =>
          b.claims + b.closes + b.firstResponses - (a.claims + a.closes + a.firstResponses) || a.userId.localeCompare(b.userId),
      ),
    byHour,
  };
}
