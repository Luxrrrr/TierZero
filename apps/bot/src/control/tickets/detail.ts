import { PermissionFlagsBits, type GuildBasedChannel } from "discord.js";
import { prisma, type Ticket } from "@tier0/db";
import {
  readTicketAnswers,
  ticketPermissions,
  type TicketDetailDto,
  type TicketMemberDto,
  type TicketMessagesPage,
  type UserRef,
} from "@tier0/core";
import { refOf, resolveUsers } from "../mod/names.js";
import { accessTarget, eventDtos, messageDto, noteDto, summaryDto, withStoredName } from "./dto.js";
import { staffRolesOf, transcriptRemovalOf, typeOfTicket, type TicketSettings } from "./runtime.js";
import type { TicketEnv } from "./types.js";

/** Messages one page of `GET items/:id/messages` carries. A long ticket is read in a few pages; polling asks for what is new. */
export const MESSAGES_PAGE = 500;

/** A Discord member overwrite, as opposed to a role. discord.js numbers it 1. */
const MEMBER_OVERWRITE = 1;

/**
 * Whether the opener spoke last. The bot's own posts (the welcome message, a
 * claim notice) do not count, so a new ticket with only the welcome in it is
 * still waiting on staff.
 */
export async function awaitingStaffFor(rows: readonly Pick<Ticket, "id" | "openerId">[], botId: string | null): Promise<Set<number>> {
  if (rows.length === 0) return new Set();
  const latest = await prisma.ticketMessage.groupBy({
    by: ["ticketId"],
    where: { ticketId: { in: rows.map((row) => row.id) }, deletedAt: null, ...(botId ? { authorId: { not: botId } } : {}) },
    _max: { id: true },
  });
  const ids = latest.map((entry) => entry._max.id).filter((id): id is number => id !== null);
  if (ids.length === 0) return new Set();
  const authors = await prisma.ticketMessage.findMany({ where: { id: { in: ids } }, select: { ticketId: true, authorId: true } });
  const openers = new Map(rows.map((row) => [row.id, row.openerId]));
  return new Set(authors.filter((entry) => openers.get(entry.ticketId) === entry.authorId).map((entry) => entry.ticketId));
}

/**
 * People given the channel on their own, beside the opener. Roles are not
 * listed; the type's handlers come from settings. Staff of the type are left
 * out too: in a thread the bot adds them when it opens, and with the claim
 * lock the claimer gets an overwrite of their own, but neither was added.
 */
function addedMemberIds(env: Pick<TicketEnv, "guild" | "ctx">, channel: GuildBasedChannel | undefined, row: Ticket, botId: string | null): string[] {
  if (!channel) return [];
  const ids = new Set<string>();
  if (channel.isThread()) {
    for (const id of channel.members.cache.keys()) ids.add(id);
  } else if ("permissionOverwrites" in channel) {
    for (const overwrite of channel.permissionOverwrites.cache.values()) {
      if (overwrite.type === MEMBER_OVERWRITE && overwrite.allow.has(PermissionFlagsBits.ViewChannel)) ids.add(overwrite.id);
    }
  }
  ids.delete(row.openerId);
  if (row.claimedById) ids.delete(row.claimedById);
  if (botId) ids.delete(botId);
  const staff = new Set(staffRolesOf(env.ctx.settings, typeOfTicket(env.ctx.settings, row)?.type));
  return [...ids].filter((id) => !env.guild.members.cache.get(id)?.roles.cache.some((role) => staff.has(role.id)));
}

export async function ticketDetail(env: TicketEnv, row: Ticket): Promise<TicketDetailDto> {
  const { client, guild, access } = env;
  const botId = client.user?.id ?? null;
  const channel = guild.channels.cache.get(row.channelId);
  const added = addedMemberIds(env, channel, row, botId);

  const [events, notes, openerTickets, modRecord, awaiting, stored] = await Promise.all([
    prisma.ticketEvent.findMany({ where: { ticketId: row.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.ticketNote.findMany({ where: { ticketId: row.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    prisma.ticket.count({ where: { guildId: guild.id, openerId: row.openerId, id: { not: row.id } } }),
    Promise.all([
      prisma.infraction.findFirst({ where: { guildId: guild.id, userId: row.openerId }, select: { id: true } }),
      prisma.modNote.findFirst({ where: { guildId: guild.id, userId: row.openerId }, select: { id: true } }),
    ]),
    awaitingStaffFor([row], botId),
    prisma.ticketMessage.count({ where: { ticketId: row.id } }),
  ]);

  const ids = [row.openerId, ...(row.claimedById ? [row.claimedById] : []), ...(row.closedBy ? [row.closedBy] : []), ...added];
  const refs = await resolveUsers(client, guild, ids, { maxFetches: 25 });
  const opener = guild.members.cache.get(row.openerId);

  const members: TicketMemberDto[] = [
    { user: withStoredName(refs.get(row.openerId), row.openerId, row.openerName), access: "opener" },
    ...added.map((id): TicketMemberDto => ({ user: refOf(refs, id), access: "added" })),
  ];
  const closedByRef: UserRef | null = row.closedBy ? withStoredName(refs.get(row.closedBy), row.closedBy, row.closedByName) : null;

  return {
    ...summaryDto(row, refs, awaiting.has(row.id)),
    answers: readTicketAnswers(row.answers),
    closeReason: row.closeReason,
    closedBy: closedByRef ? { userId: closedByRef.userId, name: closedByRef.name ?? row.closedByName ?? closedByRef.userId } : null,
    firstResponseAt: row.firstResponseAt?.toISOString() ?? null,
    ratingComment: row.ratingComment,
    ratedAt: row.ratedAt?.toISOString() ?? null,
    reopenedCount: row.reopenedCount,
    closeRequestedAt: row.closeRequestedAt?.toISOString() ?? null,
    events: eventDtos(events),
    notes: notes.map(noteDto),
    members,
    channelExists: channel !== undefined,
    discordUrl: channel ? `https://discord.com/channels/${guild.id}/${row.channelId}` : null,
    openerJoinedAt: opener?.joinedAt?.toISOString() ?? null,
    openerTicketCount: openerTickets,
    openerHasModRecord: modRecord.some((found) => found !== null),
    permissions: ticketPermissions(access, accessTarget(row)),
    openerLeftAt: row.openerLeftAt?.toISOString() ?? null,
    parentChannelId: channel?.isThread() ? channel.parentId : null,
    parentChannelName: channel?.isThread() ? (channel.parent?.name ?? null) : null,
    transcript: { messages: stored, removal: transcriptRemovalOf(row, stored, env.ctx.settings.transcripts) },
  };
}


/** Changed rows one poll carries. More than this between two polls of one ticket is a reload's job. */
export const CHANGED_PAGE = 200;

/**
 * One page of stored messages after a cursor, which is a `TicketMessage` row
 * id. Rows are paged by id because ids only grow, so a poll never misses a
 * message that arrived in between; within a page they are put in the order
 * they were sent, since a message back-filled at close has a higher id than
 * its place in the conversation.
 *
 * An edit or a delete changes a row the reader already has, which the id
 * cursor cannot see, so `updatedSince` also returns the older rows edited or
 * deleted after that moment. The moment handed back is taken before reading,
 * so a change made while this page is read is picked up by the next poll.
 */
export async function messagesPage(
  row: Ticket,
  after: number | null,
  updatedSince: Date | null = null,
  transcripts?: Pick<TicketSettings["transcripts"], "store" | "retentionDays">,
): Promise<TicketMessagesPage> {
  const readAt = new Date();
  const [rows, changedRows] = await Promise.all([
    prisma.ticketMessage.findMany({
      where: { ticketId: row.id, ...(after !== null ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" },
      take: MESSAGES_PAGE + 1,
    }),
    updatedSince !== null && after !== null
      ? prisma.ticketMessage.findMany({
          where: {
            ticketId: row.id,
            id: { lte: after },
            OR: [{ editedAt: { gt: updatedSince } }, { deletedAt: { gt: updatedSince } }],
          },
          orderBy: { id: "asc" },
          take: CHANGED_PAGE,
        })
      : Promise.resolve([]),
  ]);
  const hasMore = rows.length > MESSAGES_PAGE;
  const page = hasMore ? rows.slice(0, MESSAGES_PAGE) : rows;
  const cursor = page.length > 0 ? String(page[page.length - 1]!.id) : null;
  const sorted = [...page].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
  const removal = after === null && page.length === 0 ? transcriptRemovalOf(row, 0, transcripts) : null;
  return {
    items: sorted.map(messageDto),
    cursor,
    hasMore,
    pruned: removal !== null,
    removal,
    changed: changedRows.map(messageDto),
    updatedSince: readAt.toISOString(),
  };
}
