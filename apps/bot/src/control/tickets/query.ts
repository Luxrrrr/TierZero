import type { Prisma } from "@tier0/db";
import { LEGACY_TYPE_ID, type TicketAccess, type TicketListFilters, type TicketSort } from "@tier0/shared-tickets";

/**
 * The ticket list's filters as a database query, kept free of the handlers so
 * the access rule can be tested on its own. A handler's view is narrowed in
 * the query itself, so paging and totals never count a ticket they cannot open.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Tickets of these types. A ticket from before types existed has no type id and counts as the legacy type. */
function typeWhere(typeIds: readonly string[]): Prisma.TicketWhereInput {
  const either: Prisma.TicketWhereInput[] = [{ typeId: { in: [...typeIds] } }];
  if (typeIds.includes(LEGACY_TYPE_ID)) either.push({ typeId: null });
  return { OR: either };
}

/**
 * What a viewer may see at all. Managers and admin roles see every ticket,
 * including those of a type that has since been removed; a handler sees the
 * types they handle and nothing else. No level sees nothing.
 */
export function viewerScope(access: TicketAccess): Prisma.TicketWhereInput | null {
  if (access.level === null) return null;
  if (access.level === "handler") return typeWhere(access.handledTypeIds);
  return {};
}

/** Whole ticket number, with or without a leading #. */
const NUMBER = /^#?(\d{1,9})$/;

export function searchWhere(q: string): Prisma.TicketWhereInput | null {
  const text = q.trim();
  if (text === "") return null;
  const either: Prisma.TicketWhereInput[] = [
    { subject: { contains: text } },
    { openerName: { contains: text } },
    { channelName: { contains: text } },
    { messages: { some: { content: { contains: text } } } },
  ];
  // People type the number they see, which is counted per server; a row without one shows its id.
  const number = NUMBER.exec(text);
  if (number?.[1]) either.push({ number: Number(number[1]) }, { number: null, id: Number(number[1]) });
  return { OR: either };
}

export function listWhere(guildId: string, filters: TicketListFilters, access: TicketAccess): Prisma.TicketWhereInput | null {
  const scope = viewerScope(access);
  if (scope === null) return null;
  const and: Prisma.TicketWhereInput[] = [{ guildId }, scope];

  if (filters.status !== "all") and.push({ status: filters.status });
  if (filters.typeIds.length > 0) and.push(typeWhere(filters.typeIds));
  if (filters.priority) and.push({ priority: filters.priority });
  if (filters.claimed === "me") and.push({ claimedById: access.userId });
  if (filters.claimed === "unclaimed") and.push({ claimedById: null });
  if (filters.openerId) and.push({ openerId: filters.openerId });
  if (filters.rating !== null) and.push({ rating: filters.rating });
  if (filters.handlerId) {
    and.push({ OR: [{ claimedById: filters.handlerId }, { closedBy: filters.handlerId }, { firstResponderId: filters.handlerId }] });
  }
  if (filters.from) and.push({ openedAt: { gte: new Date(`${filters.from}T00:00:00.000Z`) } });
  if (filters.to) and.push({ openedAt: { lt: new Date(Date.parse(`${filters.to}T00:00:00.000Z`) + DAY_MS) } });
  const search = searchWhere(filters.q);
  if (search) and.push(search);
  if (filters.afterId) and.push({ id: { gt: filters.afterId } });
  return { AND: and };
}

export function listOrder(sort: TicketSort): Prisma.TicketOrderByWithRelationInput[] {
  switch (sort) {
    case "newest":
      return [{ openedAt: "desc" }, { id: "desc" }];
    case "oldest":
      return [{ openedAt: "asc" }, { id: "asc" }];
    default:
      return [{ lastActivityAt: "desc" }, { id: "desc" }];
  }
}
