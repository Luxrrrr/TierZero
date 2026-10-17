import { MessageType, type Collection, type Guild, type Message, type PartialMessage } from "discord.js";
import { prisma, type Ticket } from "@tier0/db";
import { openTicketIn, type OpenTicketEntry } from "./cache.js";
import { channelOf, memberRoleIds, type TicketChannel, type TicketCtx } from "./context.js";
import { attachmentsJson, componentsJson, embedsJson, isResponse, mentionsJson, reactionsJson, stickersJson, type ComponentLike, type MentionLookup } from "./records.js";
import { staffRolesOf, typeOfTicket } from "./resolve.js";

/**
 * Keeps `TicketMessage` in step with what is said in an open ticket, so the
 * transcript survives the channel and the dashboard can show the conversation
 * as it happens. Each write is one statement, since this runs for every
 * message in every ticket.
 */

const HISTORY_CAP = 500;

type Stored = Message | PartialMessage;

function authorName(message: Message): string {
  return message.member?.displayName || message.author.globalName || message.author.username;
}

function isStaffAuthor(ctx: TicketCtx, message: Message, ticket: { typeId: string | null; panelId: string | null }): boolean {
  if (message.author.bot) return message.author.id === ctx.client.user?.id;
  const roles = memberRoleIds(message.member);
  const staff = staffRolesOf(ctx.settings, typeOfTicket(ctx.settings, ticket)?.type);
  if (roles.some((id) => staff.includes(id))) return true;
  const permissions = message.member?.permissions;
  return !!permissions && (permissions.has("ManageGuild") || permissions.has("ManageChannels"));
}

/** Discord gives "#000000" for a member no role colours. */
const roleColor = (hex: string | undefined | null): string | null => (hex && hex !== "#000000" ? hex : null);

function mentionLookup(guild: Guild, message: Message): MentionLookup {
  return {
    user(id) {
      const member = message.mentions?.members?.get(id) ?? guild.members.cache.get(id);
      if (member) return { name: member.displayName, color: roleColor(member.displayHexColor) };
      const user = message.mentions?.users.get(id) ?? guild.client.users.cache.get(id);
      return user ? { name: user.globalName ?? user.username } : undefined;
    },
    role(id) {
      const role = guild.roles.cache.get(id);
      return role ? { name: role.name, color: roleColor(role.hexColor) } : undefined;
    },
    channel(id) {
      const channel = guild.channels.cache.get(id);
      return channel ? { name: channel.name } : undefined;
    },
  };
}

/**
 * The parts of a message that change when it is edited. Parts discord.js
 * normally fills are read defensively, since an update can arrive with less.
 */
function contentOf(guild: Guild, message: Message) {
  const embedTexts = message.embeds.flatMap((embed) => [embed.title ?? "", embed.description ?? "", ...embed.fields.map((field) => field.value)]);
  return {
    content: message.content ?? "",
    attachments: attachmentsJson(message.attachments.values()),
    embeds: embedsJson(message.embeds),
    components: componentsJson((message.components ?? []).map((row) => row.toJSON() as ComponentLike)),
    mentions: mentionsJson([message.content ?? "", ...embedTexts], mentionLookup(guild, message)),
  };
}

function rowOf(ctx: TicketCtx, message: Message, ticket: { id: number; typeId: string | null; panelId: string | null }, source: "discord" | "dashboard" = "discord") {
  return {
    ticketId: ticket.id,
    messageId: message.id,
    authorId: message.author.id,
    authorName: authorName(message),
    authorAvatar: message.author.displayAvatarURL(),
    authorIsStaff: isStaffAuthor(ctx, message, ticket),
    authorColor: roleColor(message.member?.displayHexColor),
    authorBot: message.author.bot || Boolean(message.webhookId),
    replyToId: message.type === MessageType.Reply ? (message.reference?.messageId ?? null) : null,
    ...contentOf(ctx.guild, message),
    stickers: stickersJson([...(message.stickers?.values() ?? [])].map((sticker) => ({ id: sticker.id, name: sticker.name, format: sticker.format }))),
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    source,
  };
}

/** Reactions as they stand. The bot does not watch reactions as they happen, so they are read once, when the ticket closes. */
function reactionsOf(message: Message): string {
  return reactionsJson(
    [...(message.reactions?.cache.values() ?? [])].map((reaction) => ({
      emoji: { id: reaction.emoji.id, name: reaction.emoji.name, animated: reaction.emoji.animated ?? false },
      count: reaction.count,
    })),
  );
}

/** Stores one message, leaving a stored copy alone: the copy may hold an edit count or a deletion the history does not. */
export async function storeMessage(
  ctx: TicketCtx,
  ticket: { id: number; typeId: string | null; panelId: string | null },
  message: Message,
  source: "discord" | "dashboard" = "discord",
): Promise<void> {
  if (!ctx.settings.transcripts.store) return;
  try {
    const data = rowOf(ctx, message, ticket, source);
    await prisma.ticketMessage.upsert({ where: { ticketId_messageId: { ticketId: ticket.id, messageId: message.id } }, create: data, update: {} });
  } catch (error) {
    console.error(`[tickets] could not store message ${message.id} of ticket ${ticket.id}:`, error);
  }
}

/**
 * The ticket's activity after a message from a person: when it last moved, how
 * many messages it has, and the first reply from someone other than the opener.
 * The first response is a conditional update, so two replies arriving together
 * cannot both set it.
 */
export async function noteActivity(ticketId: number, openerId: string, author: { id: string; bot: boolean }, at: Date): Promise<void> {
  await prisma.ticket.update({ where: { id: ticketId }, data: { lastActivityAt: at, messageCount: { increment: 1 } } }).catch(() => undefined);
  if (isResponse(author, openerId)) {
    await prisma.ticket.updateMany({ where: { id: ticketId, firstResponseAt: null }, data: { firstResponseAt: at, firstResponderId: author.id } });
  }
}

/** A new message in a server. Resolves to the open ticket it was in, or undefined when it was in none. */
export async function captureCreate(ctx: TicketCtx, message: Message): Promise<OpenTicketEntry | undefined> {
  const ticket = await openTicketIn(ctx.guild.id, message.channelId);
  if (!ticket) return undefined;
  await storeMessage(ctx, ticket, message);
  await noteActivity(ticket.id, ticket.openerId, message.author, message.createdAt);
  return ticket;
}

export async function captureUpdate(ctx: TicketCtx, after: Stored): Promise<void> {
  if (!ctx.settings.transcripts.store) return;
  const ticket = await openTicketIn(ctx.guild.id, after.channelId);
  if (!ticket || after.partial) return;
  // Discord also reports a link preview being filled in as an update, with no edit time; that is not an edit.
  const edited = after.editedAt !== null;
  const changed = await prisma.ticketMessage.updateMany({
    where: { ticketId: ticket.id, messageId: after.id },
    data: {
      ...contentOf(ctx.guild, after),
      ...(edited ? { editedAt: after.editedAt, edits: { increment: 1 } } : {}),
    },
  });
  if (changed.count === 0 && !after.author.bot) await storeMessage(ctx, ticket, after);
}

export async function captureDelete(ctx: TicketCtx, channelId: string, messageIds: string[]): Promise<void> {
  if (!ctx.settings.transcripts.store || messageIds.length === 0) return;
  const ticket = await openTicketIn(ctx.guild.id, channelId);
  if (!ticket) return;
  await prisma.ticketMessage.updateMany({
    where: { ticketId: ticket.id, messageId: { in: messageIds }, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}

/** Up to the last 500 messages in a channel, oldest first. */
export async function fetchHistory(channel: TicketChannel): Promise<Message[]> {
  const collected: Message[] = [];
  let before: string | undefined;
  while (collected.length < HISTORY_CAP) {
    const batch: Collection<string, Message> | null = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || batch.size === 0) break;
    collected.push(...batch.values());
    before = batch.last()?.id;
    if (batch.size < 100) break;
  }
  return collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

/**
 * Stores whatever the ticket's history has that was missed while the bot was
 * offline or before it was running this version. Resolves to the history it
 * read, so a transcript built without stored messages need not fetch it again.
 */
export async function backfill(ctx: TicketCtx, ticket: Ticket, channel: TicketChannel): Promise<Message[]> {
  const history = await fetchHistory(channel).catch(() => []);
  if (!ctx.settings.transcripts.store || history.length === 0) return history;
  const known = new Set(
    (await prisma.ticketMessage.findMany({ where: { ticketId: ticket.id }, select: { messageId: true } })).map((row) => row.messageId),
  );
  const missing = history.filter((message) => !known.has(message.id));
  const reacted = history.filter((message) => known.has(message.id) && (message.reactions?.cache.size ?? 0) > 0);
  if (missing.length > 0 || reacted.length > 0) {
    await prisma
      .$transaction([
        ...missing.map((message) =>
          prisma.ticketMessage.upsert({
            where: { ticketId_messageId: { ticketId: ticket.id, messageId: message.id } },
            create: { ...rowOf(ctx, message, ticket), reactions: reactionsOf(message) },
            update: {},
          }),
        ),
        ...reacted.map((message) =>
          prisma.ticketMessage.updateMany({ where: { ticketId: ticket.id, messageId: message.id }, data: { reactions: reactionsOf(message) } }),
        ),
      ])
      .catch((error: unknown) => console.error(`[tickets] could not back-fill ticket ${ticket.id}:`, error));
  }
  return history;
}

/** The messages a stored transcript is built from, oldest first, or null when none were stored. */
export async function storedMessages(ticketId: number) {
  const rows = await prisma.ticketMessage.findMany({ where: { ticketId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return rows.length > 0 ? rows : null;
}

/** Re-reads the channel a ticket was in, for the back-fill at close. */
export async function ticketChannel(ctx: TicketCtx, ticket: Ticket): Promise<TicketChannel | null> {
  return channelOf(ctx, ticket.channelId);
}

/** Deletes the stored messages of closed tickets that are past the retention period. The tickets stay. */
export async function pruneMessages(ctx: TicketCtx, now = new Date()): Promise<number> {
  const days = ctx.settings.transcripts.retentionDays;
  if (days <= 0) return 0;
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const due = { guildId: ctx.guild.id, status: "closed", closedAt: { lte: cutoff } };
  // Marked first, while the messages still say which tickets had any, so the transcript can tell retention from a manager's delete.
  await prisma.ticket.updateMany({ where: { ...due, messagesPrunedAt: null, messages: { some: {} } }, data: { messagesPrunedAt: now } });
  const result = await prisma.ticketMessage.deleteMany({ where: { ticket: due } });
  return result.count;
}
