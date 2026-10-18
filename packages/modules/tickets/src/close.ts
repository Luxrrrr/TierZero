import { AttachmentBuilder, PermissionFlagsBits, type GuildMember, type Message, type User } from "discord.js";
import { readTicketAnswers, readTicketDetail, ticketDashboardUrl, type ReplyValues, type TicketActor } from "@tier0/core";
import { prisma, type Ticket } from "@tier0/db";
import { forgetOpenTicket, rememberOpenTicket } from "./cache.js";
import { backfill, storedMessages } from "./capture.js";
import { lockClosed, memberIdsIn, unlockReopened } from "./channels.js";
import { channelOf, memberRoleIds, type TicketChannel, type TicketCtx } from "./context.js";
import { closedRows, openedByStaff, ratingRows, recordEvent } from "./controls.js";
import { closeReasonOf, priorityLabel, transcriptFileName, transcriptFileNames, transcriptTexts } from "./labels.js";
import {
  CLOSED_MESSAGE,
  CLOSED_SUMMARY_MESSAGE,
  RATING_MESSAGE,
  RATING_RATED_MESSAGE,
  REOPENED_MESSAGE,
  TRANSCRIPT_DM_MESSAGE,
  TRANSCRIPT_MESSAGE,
  appended,
  closingValues,
  starsOf,
  transcriptValues,
} from "./messages.js";
import { inChannel, nameOf, refOf, reload, resetAutoClose, ticketValues, type Announce } from "./notice.js";
import { done, refused, type Outcome } from "./outcome.js";
import { isSnowflake, spokenDuration, ticketNumber } from "./records.js";
import { accessSettingsOf, effectiveTranscriptChannel, ratingEnabled, staffRolesOf, typeOfTicket } from "./resolve.js";
import { renderStoredTranscriptText, renderTranscriptHtml, type StoredTranscriptTicket } from "./transcript-html.js";
import { renderTranscript } from "./transcript.js";

/**
 * Closing a ticket and everything that hangs off it: the transcript, the
 * summary, the rating request, and deleting or keeping the channel. Every step
 * tolerates the channel already being gone, since a close runs from a scheduled
 * task as well as from a person, and the two can race.
 */

/** Who closed a ticket. `userId` is not a member's id for an automatic close. */
export interface Closer {
  userId: string;
  name: string;
}

const DAY_MS = 86_400_000;

async function storedTicketOf(ctx: TicketCtx, ticket: Ticket): Promise<StoredTranscriptTicket> {
  const claimer = ticket.claimedById ? await ctx.guild.members.fetch(ticket.claimedById).catch(() => null) : null;
  return {
    ...ticket,
    guildName: ctx.guild.name,
    priorityLabel: priorityLabel(ctx.settings.labels, ticket.priority),
    claimedByName: claimer?.displayName ?? null,
    answers: readTicketAnswers(ticket.answers),
  };
}

/** The transcript as the web page the dashboard downloads, or null when the messages are not stored. */
export async function transcriptHtml(ctx: TicketCtx, ticket: Ticket): Promise<string | null> {
  const stored = await storedMessages(ticket.id);
  if (!stored) return null;
  return renderTranscriptHtml(await storedTicketOf(ctx, ticket), stored, { texts: transcriptTexts(ctx.settings.labels) });
}

/** The transcript file's text: from the stored messages when there are any, else from the channel's history. */
export async function transcriptText(ctx: TicketCtx, ticket: Ticket, history: readonly Message[] = []): Promise<string> {
  const stored = await storedMessages(ticket.id);
  const texts = transcriptTexts(ctx.settings.labels);
  if (stored) return renderStoredTranscriptText(await storedTicketOf(ctx, ticket), stored, texts);
  return renderTranscript(
    {
      guildName: ctx.guild.name,
      channelName: ticket.channelName || "ticket",
      ticketId: ticketNumber(ticket),
      openerTag: ticket.openerName || ticket.openerId,
      subject: ticket.subject,
      openedAt: ticket.openedAt.getTime(),
      closedAt: (ticket.closedAt ?? new Date()).getTime(),
      closedByTag: ticket.closedByName ?? ticket.closedBy ?? "",
    },
    history.map((message) => ({
      authorTag: message.author?.tag ?? ctx.settings.labels.transcript.unknownAuthor,
      authorId: message.author?.id ?? ctx.settings.labels.transcript.unknownAuthorId,
      timestamp: message.createdTimestamp,
      content: message.content || null,
      attachmentUrls: [...message.attachments.values()].map((attachment) => attachment.url),
    })),
    texts,
  );
}

function fileOf(ctx: TicketCtx, ticket: Ticket, text: string): AttachmentBuilder {
  return new AttachmentBuilder(Buffer.from(text, "utf8"), { name: transcriptFileName(ctx.settings.labels, ticketNumber(ticket)) });
}

async function logChannel(ctx: TicketCtx, ticket: Ticket) {
  const id = effectiveTranscriptChannel(ctx.settings, typeOfTicket(ctx.settings, ticket)?.type);
  if (!id) return null;
  const channel = ctx.guild.channels.cache.get(id);
  if (!channel?.isTextBased()) {
    console.warn(`[tickets] log channel ${id} is missing or not text-based (guild ${ctx.guild.id})`);
    return null;
  }
  return channel;
}

/** What the transcript, summary and rating posts can say about a closed ticket. */
function closedValues(ticket: Ticket, closer: Closer, ticketUrl: string): ReplyValues {
  return {
    number: ticketNumber(ticket),
    type: ticket.typeName,
    user: `<@${ticket.openerId}>`,
    subject: ticket.subject ?? "",
    closedBy: nameOf(closer),
    claimedBy: ticket.claimedById ? `<@${ticket.claimedById}>` : "",
    reason: ticket.closeReason ?? "",
    messages: ticket.messageCount,
    duration: spokenDuration((ticket.closedAt ?? new Date()).getTime() - ticket.openedAt.getTime()),
    priority: ticket.priority,
    ticketUrl,
  };
}

/** Sends what the settings ask for once a ticket is closed. Each part fails on its own. */
async function afterClose(ctx: TicketCtx, ticket: Ticket, closer: Closer, history: readonly Message[], channel: TicketChannel | null): Promise<string[]> {
  const notes: string[] = [];
  const { transcripts } = ctx.settings;
  const type = typeOfTicket(ctx.settings, ticket)?.type;
  const ticketUrl = transcripts.summary ? ticketDashboardUrl(await ctx.dashboardUrl(), ctx.guild.id, ticket.id) : "";
  const values = { ...closedValues(ticket, closer, ticketUrl), priority: priorityLabel(ctx.settings.labels, ticket.priority) };
  let cachedText: string | undefined;
  const textOf = async () => (cachedText ??= await transcriptText(ctx, ticket, history));
  const log = transcripts.postFile || transcripts.summary ? await logChannel(ctx, ticket) : null;

  if (transcripts.postFile) {
    if (!log) {
      notes.push("No log channel is set, so the transcript file was not posted.");
    } else {
      const tag = { id: closer.userId, tag: closer.name };
      const posted = await ctx.send(log, transcripts.message, transcriptValues(ticket, tag, ticket.channelName || "ticket"), {
        fallback: TRANSCRIPT_MESSAGE,
        files: [fileOf(ctx, ticket, await textOf())],
        // The subject is the opener's own words, so whatever the owner moves into the text must not ping.
        mentions: { users: [], roles: [] },
      });
      if (!posted) notes.push("The transcript file could not be posted in the log channel.");
    }
  }

  if (transcripts.summary && log) {
    const posted = await ctx.send(log, transcripts.summaryMessage, values, { fallback: CLOSED_SUMMARY_MESSAGE, mentions: { users: [], roles: [] } });
    if (!posted) notes.push("The closed ticket summary could not be posted in the log channel.");
  }

  // A ticket staff opened has no member who asked for help, so nobody is asked how it went.
  const rating = ratingEnabled(ctx.settings, type) && !(await openedByStaff(ticket.id));
  const opener = transcripts.sendTo !== "nobody" || rating ? await ctx.client.users.fetch(ticket.openerId).catch(() => null) : null;
  const recipients = await recipientsOf(ctx, ticket, channel, opener);

  // The opener's rating request travels in their transcript message, so there is one message to open and the buttons sit under the file.
  let askedWithTranscript = false;
  if (recipients.length > 0) {
    const files = await transcriptFiles(ctx, ticket, transcripts.format, textOf);
    let missed = 0;
    for (const person of recipients) {
      const together = rating && person.id === ticket.openerId;
      const sent = await ctx.send(person, together ? appended(transcripts.dmMessage, ctx.settings.ratings.message) : transcripts.dmMessage, values, {
        fallback: together ? appended(TRANSCRIPT_DM_MESSAGE, RATING_MESSAGE) : TRANSCRIPT_DM_MESSAGE,
        files,
        ...(together ? { rows: ratingRows(ctx.guild.id, ticket.id) } : {}),
      });
      if (sent && together) askedWithTranscript = true;
      if (!sent) missed++;
    }
    if (missed > 0) {
      notes.push(`The transcript could not be sent to ${missed === 1 ? "1 member" : `${missed} members`}. They may not accept direct messages from this server.`);
    }
  }

  if (rating && !askedWithTranscript) {
    const sent = opener
      ? await ctx.send(opener, ctx.settings.ratings.message, values, { fallback: RATING_MESSAGE, rows: ratingRows(ctx.guild.id, ticket.id) })
      : null;
    if (!sent) notes.push("The rating request could not be sent to the opener. They may not accept direct messages from this server.");
  }
  return notes;
}

/**
 * Who gets the transcript by direct message. The opener always does when the
 * setting names anyone; "everyone" adds the members put in the ticket, minus
 * staff and bots, from the events as well as the channel so a deleted channel
 * does not lose them.
 */
async function recipientsOf(ctx: TicketCtx, ticket: Ticket, channel: TicketChannel | null, opener: User | null): Promise<User[]> {
  const { sendTo } = ctx.settings.transcripts;
  if (sendTo === "nobody") return [];
  const people: User[] = opener && !opener.bot ? [opener] : [];
  if (sendTo === "opener") return people;

  const events = await prisma.ticketEvent.findMany({
    where: { ticketId: ticket.id, kind: { in: ["member_added", "member_removed"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const added = new Set<string>();
  for (const event of events) {
    const id = readTicketDetail(event.detail).userId;
    if (typeof id !== "string") continue;
    if (event.kind === "member_added") added.add(id);
    else added.delete(id);
  }
  if (channel) for (const id of memberIdsIn(ctx, channel)) added.add(id);
  added.delete(ticket.openerId);

  for (const id of added) {
    const member = await ctx.guild.members.fetch(id).catch(() => null);
    if (member && isStaffMember(ctx, ticket, member)) continue;
    const person = member?.user ?? (await ctx.client.users.fetch(id).catch(() => null));
    if (person && !person.bot) people.push(person);
  }
  return people;
}

/** A handler, observer or admin of the ticket's type, or someone who can manage channels or the server. */
function isStaffMember(ctx: TicketCtx, ticket: Ticket, member: GuildMember): boolean {
  if (member.id === ticket.claimedById) return true;
  const type = typeOfTicket(ctx.settings, ticket)?.type;
  const roles = new Set([...staffRolesOf(ctx.settings, type), ...(type?.opening.observers ?? [])]);
  if (memberRoleIds(member).some((id) => roles.has(id))) return true;
  const permissions = member.permissions;
  return !!permissions && (permissions.has(PermissionFlagsBits.ManageGuild) || permissions.has(PermissionFlagsBits.ManageChannels));
}

/** The files a member is sent: the web page, the text file or both. Text stands in when the messages were not stored. */
async function transcriptFiles(ctx: TicketCtx, ticket: Ticket, format: string, textOf: () => Promise<string>): Promise<AttachmentBuilder[]> {
  const names = transcriptFileNames(ctx.settings.labels, ticketNumber(ticket));
  const page = format === "text" ? null : await transcriptHtml(ctx, ticket);
  const files: AttachmentBuilder[] = [];
  if (page !== null) files.push(new AttachmentBuilder(Buffer.from(page, "utf8"), { name: names.html }));
  if (page === null || format === "both") files.push(new AttachmentBuilder(Buffer.from(await textOf(), "utf8"), { name: names.text }));
  return files;
}

/**
 * Edits the message a rating was picked on, in place: the buttons come off and
 * the rating is shown under the text that was there. Never throws, since the
 * rating is already saved and a message that is gone changes nothing.
 */
export async function showRated(ctx: TicketCtx, message: Message, ticket: Ticket, rating: number): Promise<void> {
  const closer = { userId: ticket.closedBy ?? "", name: ticket.closedByName ?? "" };
  const values = { ...closedValues(ticket, closer, ""), priority: priorityLabel(ctx.settings.labels, ticket.priority), rating, stars: starsOf(rating) };
  // A rating that came with the transcript has that message's text above its own.
  const together = (message.attachments?.size ?? 0) > 0;
  const request = together ? appended(ctx.settings.transcripts.dmMessage, ctx.settings.ratings.message) : ctx.settings.ratings.message;
  const starting = together ? appended(TRANSCRIPT_DM_MESSAGE, RATING_MESSAGE) : RATING_MESSAGE;
  await ctx.edit(message, appended(request, ctx.settings.ratings.rated), values, { fallback: appended(starting, RATING_RATED_MESSAGE) });
}

/**
 * Closes an open ticket. The row is marked closed first, in one conditional
 * update, so a person and the inactivity close cannot both close it and post
 * everything twice; whichever comes second is told it is already closed.
 * `announce` posts the closing message, and only runs for the one that won.
 *
 * A kept channel is marked kept in that same update, so a crash before it is
 * locked leaves a ticket that can still be reopened or deleted, not one that
 * looks deleted while its channel is open to the opener.
 */
export async function closeTicket(
  ctx: TicketCtx,
  ticket: Ticket,
  closer: Closer,
  reason: string | null,
  announce?: () => Promise<unknown>,
): Promise<Outcome<Ticket>> {
  const closedAt = new Date();
  const channel = await channelOf(ctx, ticket.channelId);
  const keep = ctx.settings.general.closeBehaviour === "archive" && channel !== null;
  const claimed = await prisma.ticket.updateMany({
    where: { id: ticket.id, status: "open" },
    data: {
      status: "closed",
      closedAt,
      closedBy: closer.userId,
      closedByName: closer.name,
      closeReason: reason,
      closeRequestedAt: null,
      archived: keep,
    },
  });
  if (claimed.count === 0) return refused("alreadyClosed");
  if (announce) await announce();

  forgetOpenTicket(ctx.guild.id, ticket.channelId);
  await Promise.all([
    ctx.tasks.cancel("autoclose", { channelId: ticket.channelId }),
    ctx.tasks.cancel("reminder", { ticketId: ticket.id }),
    ctx.tasks.cancel("closeRequest", { ticketId: ticket.id }),
  ]);
  await recordEvent(ticket.id, "closed", isSnowflake(closer.userId) ? refOf(closer) : null, { reason });

  const history = channel ? await backfill(ctx, ticket, channel) : [];
  const closed = (await reload(ticket.id)) ?? { ...ticket, status: "closed", closedAt, closedBy: closer.userId, closedByName: closer.name, closeReason: reason };
  const notes = await afterClose(ctx, closed, closer, history, channel);

  if (keep) {
    await archive(ctx, closed, channel, closer, reason);
  } else if (channel) {
    await channel.delete(closeReasonOf(ctx.settings.labels, closer.name)).catch((error: unknown) => {
      console.error(`[tickets] failed to delete ticket channel ${ticket.channelId}:`, error);
      notes.push("The ticket's channel could not be deleted. Delete it in Discord, or check the bot has Manage Channels.");
    });
  }

  const { store, retentionDays } = ctx.settings.transcripts;
  if (store && retentionDays > 0) await ctx.tasks.schedule("prune", new Date(closedAt.getTime() + retentionDays * DAY_MS), { ticketId: ticket.id });
  return done((await reload(ticket.id)) ?? closed, notes);
}

async function archive(ctx: TicketCtx, ticket: Ticket, channel: TicketChannel, closer: Closer, reason: string | null): Promise<void> {
  await lockClosed(ctx, channel, ticket.openerId);
  const reopen = accessSettingsOf(ctx.settings).reopen === true;
  const posted = await ctx.send(
    channel,
    ctx.settings.messages.closed,
    { ...closingValues({ id: closer.userId, tag: closer.name }, ticket, reason), user: `<@${ticket.openerId}>`, type: ticket.typeName },
    { fallback: CLOSED_MESSAGE, rows: closedRows(ctx.settings, ticket.id, reopen), mentions: { users: [], roles: [] } },
  );
  if (!posted) console.warn(`[tickets] could not post the closed notice in ${channel.id}`);
  const days = ctx.settings.general.archiveDays;
  if (days > 0) await ctx.tasks.schedule("deleteArchived", new Date(Date.now() + days * DAY_MS), { ticketId: ticket.id });
}

/** Deletes the channel of a closed ticket that was kept. The ticket and its stored messages stay. */
export async function deleteKept(ctx: TicketCtx, ticket: Ticket, by: Closer): Promise<Outcome<Ticket>> {
  if (ticket.status !== "closed") return refused("notClosed");
  const channel = await channelOf(ctx, ticket.channelId);
  await ctx.tasks.cancel("deleteArchived", { ticketId: ticket.id });
  await prisma.ticket.update({ where: { id: ticket.id }, data: { archived: false } });
  if (channel) await channel.delete(closeReasonOf(ctx.settings.labels, by.name)).catch(() => undefined);
  return done((await reload(ticket.id)) ?? ticket);
}

/**
 * Opens a closed ticket again in the channel that was kept for it. Like
 * closing, the row changes first in one conditional update.
 */
export async function reopenTicketIn(ctx: TicketCtx, ticket: Ticket, actor: TicketActor, announce?: Announce): Promise<Outcome<Ticket>> {
  if (ticket.status === "open") return refused("notClosed");
  if (!ticket.archived) return refused("cannotReopen");
  if (accessSettingsOf(ctx.settings).reopen !== true) return refused("reopenOff");
  const channel = await channelOf(ctx, ticket.channelId);
  if (!channel) {
    await prisma.ticket.update({ where: { id: ticket.id }, data: { archived: false } });
    return refused("cannotReopen");
  }

  const changed = await prisma.ticket.updateMany({
    where: { id: ticket.id, status: "closed", archived: true },
    data: {
      status: "open",
      archived: false,
      closedAt: null,
      closedBy: null,
      closedByName: null,
      closeReason: null,
      lastActivityAt: new Date(),
      reopenedCount: { increment: 1 },
    },
  });
  if (changed.count === 0) return refused("notClosed");

  const type = typeOfTicket(ctx.settings, ticket)?.type;
  await unlockReopened(ctx, channel, ticket.openerId, type);
  await Promise.all([ctx.tasks.cancel("deleteArchived", { ticketId: ticket.id }), ctx.tasks.cancel("prune", { ticketId: ticket.id })]);
  rememberOpenTicket(ctx.guild.id, ticket.channelId, { id: ticket.id, openerId: ticket.openerId, typeId: ticket.typeId, panelId: ticket.panelId });
  await recordEvent(ticket.id, "reopened", refOf(actor));
  const reopened = (await reload(ticket.id)) ?? ticket;
  await (announce ?? inChannel(ctx, reopened))(ctx.settings.messages.reopened, ticketValues(reopened, actor), REOPENED_MESSAGE);
  await resetAutoClose(ctx, reopened);
  return done(reopened);
}
