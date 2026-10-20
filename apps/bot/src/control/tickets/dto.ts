import type { Ticket, TicketEvent, TicketMessage, TicketNote } from "@tier0/db";
import {
  type UserRef,
} from "@tier0/shared-moderation";
import {
  isTicketEventKind,
  isTicketPriority,
  readTicketDetail,
  ticketMessageFromRow,
  type TicketAccessTarget,
  type TicketEventDto,
  type TicketMessageDto,
  type TicketNoteDto,
  type TicketSummaryDto,
} from "@tier0/shared-tickets";

/** Row to reply shapes. Nothing here reaches Discord; names are looked up by the caller and passed in. */

/** A looked-up person, falling back to the name stored on the row when Discord did not answer. */
export function withStoredName(ref: UserRef | undefined, userId: string, stored: string | null | undefined): UserRef {
  const base = ref ?? { userId, name: null, avatarUrl: null, inServer: false };
  return base.name === null && stored ? { ...base, name: stored } : base;
}

export function accessTarget(row: Pick<Ticket, "typeId" | "status" | "archived" | "claimedById">): TicketAccessTarget {
  return { typeId: row.typeId, status: row.status, archived: row.archived, claimedById: row.claimedById };
}

export function summaryDto(row: Ticket, refs: Map<string, UserRef>, awaitingStaff: boolean): TicketSummaryDto {
  return {
    id: row.id,
    number: row.number ?? row.id,
    channelId: row.channelId,
    channelName: row.channelName,
    status: row.status === "closed" ? "closed" : "open",
    archived: row.archived,
    mode: row.mode === "thread" ? "thread" : "channel",
    panelId: row.panelId,
    typeId: row.typeId,
    typeName: row.typeName,
    subject: row.subject,
    opener: withStoredName(refs.get(row.openerId), row.openerId, row.openerName),
    claimedBy: row.claimedById ? withStoredName(refs.get(row.claimedById), row.claimedById, null) : null,
    priority: isTicketPriority(row.priority) ? row.priority : "normal",
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    lastActivityAt: row.lastActivityAt.toISOString(),
    messageCount: row.messageCount,
    awaitingStaff: row.status === "open" && awaitingStaff,
    rating: row.rating,
  };
}

export function messageDto(row: TicketMessage): TicketMessageDto {
  return ticketMessageFromRow(row);
}

/** Events of a kind this version does not know are left out rather than shown as something they are not. */
export function eventDtos(rows: readonly TicketEvent[]): TicketEventDto[] {
  const out: TicketEventDto[] = [];
  for (const row of rows) {
    if (!isTicketEventKind(row.kind)) continue;
    out.push({
      id: row.id,
      kind: row.kind,
      actor: row.actorId ? { userId: row.actorId, name: row.actorName ?? row.actorId } : null,
      detail: readTicketDetail(row.detail),
      createdAt: row.createdAt.toISOString(),
    });
  }
  return out;
}

export function noteDto(row: TicketNote): TicketNoteDto {
  return {
    id: row.id,
    author: { userId: row.authorId, name: row.authorName },
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Ticket ids in the path are positive whole numbers; anything else is refused before the database is asked. */
export function ticketIdOf(value: string | undefined): number | null {
  if (value === undefined || !/^\d{1,9}$/.test(value)) return null;
  const id = Number(value);
  return id > 0 ? id : null;
}
