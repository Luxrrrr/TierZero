import {
  isTicketEventKind,
  isTicketPriority,
  readTicketAnswers,
  readTicketDetail,
  ticketMessageFromRow,
  ticketPermissions,
  type TicketAccess,
  type TicketDetailDto,
  type TicketMemberDto,
  type TicketMessageDto,
  type UserRef,
} from "@tier0/core";
import { prisma, type Ticket, type TicketMessage } from "@tier0/db";
import { memberIdsIn, staffMemberIds } from "./channels.js";
import { channelOf, isThread, targetOf, type TicketCtx } from "./context.js";
import { ticketNumber, transcriptRemovalOf } from "./records.js";
import { typeOfTicket } from "./resolve.js";

/**
 * A ticket as the dashboard reads it. Names come from the members Discord has
 * cached, and at most a few are fetched, so a ticket with many people in it
 * costs a bounded number of calls.
 */

const FETCH_BUDGET = 5;

async function refsFor(ctx: TicketCtx, ids: readonly string[], known: Map<string, string>): Promise<Map<string, UserRef>> {
  const refs = new Map<string, UserRef>();
  let budget = FETCH_BUDGET;
  for (const id of new Set(ids)) {
    let member = ctx.guild.members.cache.get(id) ?? null;
    if (!member && budget > 0) {
      budget--;
      member = await ctx.guild.members.fetch(id).catch(() => null);
    }
    const user = member?.user ?? ctx.client.users.cache.get(id) ?? null;
    refs.set(id, {
      userId: id,
      name: member?.displayName ?? user?.globalName ?? user?.username ?? known.get(id) ?? null,
      avatarUrl: user?.displayAvatarURL() ?? null,
      inServer: member !== null,
    });
  }
  return refs;
}

export function messageDto(row: TicketMessage): TicketMessageDto {
  return ticketMessageFromRow(row);
}

/**
 * Everything the ticket view shows. `access` is the viewer's, for the
 * permissions the dashboard draws its buttons from; without it the list is
 * empty and the caller fills it in.
 */
export async function ticketDetail(ctx: TicketCtx, ticket: Ticket, access?: TicketAccess): Promise<TicketDetailDto> {
  const [events, notes, last, others, infractions, channel, stored] = await Promise.all([
    prisma.ticketEvent.findMany({ where: { ticketId: ticket.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.ticketNote.findMany({ where: { ticketId: ticket.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    prisma.ticketMessage.findFirst({ where: { ticketId: ticket.id, deletedAt: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    prisma.ticket.count({ where: { guildId: ticket.guildId, openerId: ticket.openerId, id: { not: ticket.id } } }),
    prisma.infraction.count({ where: { guildId: ticket.guildId, userId: ticket.openerId } }),
    // A closed ticket whose channel was not kept has none to look for.
    ticket.status === "open" || ticket.archived ? channelOf(ctx, ticket.channelId) : Promise.resolve(null),
    prisma.ticketMessage.count({ where: { ticketId: ticket.id } }),
  ]);

  // Staff of the type are let in by their roles, or by the claim lock, not added; only people added on their own are listed as added.
  const staff = staffMemberIds(ctx, typeOfTicket(ctx.settings, ticket)?.type);
  const added = channel
    ? memberIdsIn(ctx, channel).filter((id) => id !== ticket.openerId && id !== ticket.claimedById && !staff.has(id))
    : [];
  const known = new Map([[ticket.openerId, ticket.openerName]]);
  const refs = await refsFor(ctx, [ticket.openerId, ...(ticket.claimedById ? [ticket.claimedById] : []), ...added], known);
  const ref = (id: string) => refs.get(id) ?? { userId: id, name: known.get(id) ?? null, avatarUrl: null, inServer: false };

  const members: TicketMemberDto[] = [
    { user: ref(ticket.openerId), access: "opener" },
    ...(ticket.claimedById ? [{ user: ref(ticket.claimedById), access: "handler" as const }] : []),
    ...added.map((id) => ({ user: ref(id), access: "added" as const })),
  ];
  const answers = readTicketAnswers(ticket.answers);
  const opener = ctx.guild.members.cache.get(ticket.openerId);

  return {
    id: ticket.id,
    number: ticketNumber(ticket),
    channelId: ticket.channelId,
    channelName: channel?.name ?? ticket.channelName,
    status: ticket.status === "closed" ? "closed" : "open",
    archived: ticket.archived,
    mode: ticket.mode === "thread" ? "thread" : "channel",
    panelId: ticket.panelId,
    typeId: ticket.typeId,
    typeName: ticket.typeName,
    subject: ticket.subject ?? answers.find((answer) => answer.value !== "")?.value ?? null,
    opener: ref(ticket.openerId),
    claimedBy: ticket.claimedById ? ref(ticket.claimedById) : null,
    priority: isTicketPriority(ticket.priority) ? ticket.priority : "normal",
    openedAt: ticket.openedAt.toISOString(),
    closedAt: ticket.closedAt?.toISOString() ?? null,
    lastActivityAt: ticket.lastActivityAt.toISOString(),
    messageCount: ticket.messageCount,
    awaitingStaff: last !== null && last.authorId === ticket.openerId,
    rating: ticket.rating,
    answers,
    closeReason: ticket.closeReason,
    closedBy: ticket.closedBy ? { userId: ticket.closedBy, name: ticket.closedByName ?? ticket.closedBy } : null,
    firstResponseAt: ticket.firstResponseAt?.toISOString() ?? null,
    ratingComment: ticket.ratingComment,
    ratedAt: ticket.ratedAt?.toISOString() ?? null,
    reopenedCount: ticket.reopenedCount,
    closeRequestedAt: ticket.closeRequestedAt?.toISOString() ?? null,
    events: events.filter((event) => isTicketEventKind(event.kind)).map((event) => ({
      id: event.id,
      kind: event.kind as TicketDetailDto["events"][number]["kind"],
      actor: event.actorId ? { userId: event.actorId, name: event.actorName ?? event.actorId } : null,
      detail: readTicketDetail(event.detail),
      createdAt: event.createdAt.toISOString(),
    })),
    notes: notes.map((note) => ({
      id: note.id,
      author: { userId: note.authorId, name: note.authorName },
      body: note.body,
      createdAt: note.createdAt.toISOString(),
    })),
    members,
    channelExists: channel !== null,
    discordUrl: channel ? `https://discord.com/channels/${ticket.guildId}/${ticket.channelId}` : null,
    openerJoinedAt: opener?.joinedAt?.toISOString() ?? null,
    openerTicketCount: others,
    openerHasModRecord: infractions > 0,
    permissions: access ? ticketPermissions(access, targetOf(ticket)) : [],
    openerLeftAt: ticket.openerLeftAt?.toISOString() ?? null,
    parentChannelId: channel && isThread(channel) ? channel.parentId : null,
    transcript: { messages: stored, removal: transcriptRemovalOf(ticket, stored, ctx.settings.transcripts) },
  };
}
