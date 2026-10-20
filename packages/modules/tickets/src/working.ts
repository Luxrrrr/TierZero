import { ChannelType } from "discord.js";
import { TICKET_NOTE_MAX, type TicketActor, type TicketPriority } from "@tier0/shared-tickets";
import { prisma, type Ticket } from "@tier0/db";
import { rememberOpenTicket } from "./cache.js";
import { addMember, applyClaimLock, categoryFor, refreshTopic, releaseClaimLock, removeMember, swapRoles, swapThreadHandlers } from "./channels.js";
import { channelOf, isThread, type TicketCtx } from "./context.js";
import { closeRequestRows, recordEvent } from "./controls.js";
import { priorityLabel } from "./labels.js";
import {
  ADDED_MESSAGE,
  CLAIMED_MESSAGE,
  CLOSE_REQUEST_MESSAGE,
  KEPT_OPEN_MESSAGE,
  PRIORITY_MESSAGE,
  REMOVED_MESSAGE,
  RENAMED_MESSAGE,
  TRANSFERRED_MESSAGE,
  UNCLAIMED_MESSAGE,
} from "./messages.js";
import { ticketChannelName } from "./naming.js";
import { inChannel, nameOf, refOf, refreshControls, reload, rescheduleAutoClose, ticketValues, type Announce } from "./notice.js";
import { done, refused, type Outcome } from "./outcome.js";
import { atLeastAMinute, relativeTime, ticketNumber } from "./records.js";
import { findType, pingRolesOf, typeOfTicket } from "./resolve.js";
import { storeMessage } from "./capture.js";
import { notifyTicketOf } from "./controls.js";

/**
 * Changes staff make to an open ticket. None of these check who is asking:
 * the slash commands, the buttons and the control API each do that first, by
 * the same rules in core. They check the ticket's state, write the row in one
 * statement that only succeeds from the state they read, record the change on
 * the timeline and tell the ticket.
 */

const announceOf = (ctx: TicketCtx, ticket: Ticket, announce?: Announce) => announce ?? inChannel(ctx, ticket);

export async function claim(ctx: TicketCtx, ticket: Ticket, actor: TicketActor, announce?: Announce): Promise<Outcome<Ticket>> {
  if (ticket.status !== "open") return refused("alreadyClosed");
  const type = typeOfTicket(ctx.settings, ticket)?.type;
  if (type?.rules.claim === false) return refused("claimOff", { type: ticket.typeName });
  if (ticket.claimedById === actor.userId) return refused("alreadyClaimed", { claimedBy: `<@${actor.userId}>` });

  const changed = await prisma.ticket.updateMany({
    where: { id: ticket.id, status: "open", claimedById: ticket.claimedById },
    data: { claimedById: actor.userId, claimedAt: new Date() },
  });
  if (changed.count === 0) {
    const now = await reload(ticket.id);
    return refused("alreadyClaimed", { claimedBy: now?.claimedById ? `<@${now.claimedById}>` : "" });
  }
  await recordEvent(ticket.id, "claimed", refOf(actor));
  const claimed = (await reload(ticket.id)) ?? ticket;
  const channel = await channelOf(ctx, ticket.channelId);
  if (channel) {
    if (ticket.claimedById) await releaseClaimLock(ctx, channel, undefined, ticket.claimedById, ticket.openerId);
    await applyClaimLock(ctx, channel, type, actor.userId);
  }
  await refreshControls(ctx, claimed);
  await announceOf(ctx, claimed, announce)(ctx.settings.messages.claimed, ticketValues(claimed, actor), CLAIMED_MESSAGE);
  return done(claimed);
}

export async function unclaim(ctx: TicketCtx, ticket: Ticket, actor: TicketActor, announce?: Announce): Promise<Outcome<Ticket>> {
  if (ticket.status !== "open") return refused("alreadyClosed");
  if (ticket.claimedById === null) return refused("notClaimed");
  const changed = await prisma.ticket.updateMany({
    where: { id: ticket.id, status: "open", claimedById: ticket.claimedById },
    data: { claimedById: null, claimedAt: null },
  });
  if (changed.count === 0) return refused("notClaimed");
  await recordEvent(ticket.id, "unclaimed", refOf(actor));
  const unclaimed = (await reload(ticket.id)) ?? ticket;
  const channel = await channelOf(ctx, ticket.channelId);
  if (channel) await releaseClaimLock(ctx, channel, typeOfTicket(ctx.settings, ticket)?.type, ticket.claimedById, ticket.openerId);
  await refreshControls(ctx, unclaimed);
  await announceOf(ctx, unclaimed, announce)(ctx.settings.messages.unclaimed, ticketValues(unclaimed, actor), UNCLAIMED_MESSAGE);
  return done(unclaimed);
}

export async function setPriority(
  ctx: TicketCtx,
  ticket: Ticket,
  priority: TicketPriority,
  actor: TicketActor,
  announce?: Announce,
): Promise<Outcome<Ticket>> {
  if (ticket.status !== "open") return refused("alreadyClosed");
  if (ticket.priority === priority) return done(ticket);
  const written = await prisma.ticket.updateMany({ where: { id: ticket.id, status: "open" }, data: { priority } });
  if (written.count === 0) return refused("alreadyClosed");
  await recordEvent(ticket.id, "priority", refOf(actor), { from: ticket.priority, to: priority });
  const changed = (await reload(ticket.id)) ?? ticket;
  const channel = await channelOf(ctx, ticket.channelId);
  if (channel) refreshTopic(ctx, channel, changed);
  const labels = ctx.settings.labels;
  await announceOf(ctx, changed, announce)(
    ctx.settings.messages.priority,
    { ...ticketValues(changed, actor), priority: priorityLabel(labels, priority), previous: priorityLabel(labels, ticket.priority) },
    PRIORITY_MESSAGE,
  );
  return done(changed);
}

/** An internal note. Notes are never sent to Discord, so it can be added to a closed ticket too. */
export async function addNote(ticket: Ticket, body: string, actor: TicketActor): Promise<Outcome<Ticket>> {
  const text = body.replace(/\r\n?/g, "\n").trim().slice(0, TICKET_NOTE_MAX);
  if (text === "") return done(ticket);
  await prisma.ticketNote.create({ data: { ticketId: ticket.id, authorId: actor.userId, authorName: actor.name, body: text } });
  notifyTicketOf(ticket.id, "detail");
  return done(ticket);
}

async function memberOf(ctx: TicketCtx, userId: string) {
  return ctx.guild.members.cache.get(userId) ?? (await ctx.guild.members.fetch(userId).catch(() => null));
}

export async function changeMember(
  ctx: TicketCtx,
  ticket: Ticket,
  change: { userId: string; action: "add" | "remove" },
  actor: TicketActor,
  announce?: Announce,
): Promise<Outcome<Ticket>> {
  if (ticket.status !== "open") return refused("alreadyClosed");
  const channel = await channelOf(ctx, ticket.channelId);
  if (!channel) return refused("channelMissing");
  const adding = change.action === "add";
  const member = await memberOf(ctx, change.userId);
  if (adding && !member) return refused("memberMissing");
  const name = member?.displayName ?? change.userId;
  if (adding) {
    if (!(await addMember(channel, change.userId))) return refused("channelMissing");
  } else {
    await removeMember(channel, change.userId);
  }
  await recordEvent(ticket.id, adding ? "member_added" : "member_removed", refOf(actor), { userId: change.userId, name });
  await announceOf(ctx, ticket, announce)(
    adding ? ctx.settings.messages.added : ctx.settings.messages.removed,
    { member: `<@${change.userId}>`, staff: nameOf(actor), number: ticket.id },
    adding ? ADDED_MESSAGE : REMOVED_MESSAGE,
  );
  return done(ticket);
}

/**
 * Moves a ticket to another type: its handlers, observers and category become
 * the new type's, the claim is dropped since the old handlers no longer work
 * it, and the new handlers are pinged.
 */
export async function transfer(
  ctx: TicketCtx,
  ticket: Ticket,
  typeId: string,
  actor: TicketActor,
  announce?: Announce,
): Promise<Outcome<Ticket>> {
  if (ticket.status !== "open") return refused("alreadyClosed");
  const target = findType(ctx.settings, null, typeId);
  if (!target) return refused("typeNotFound");
  const previous = typeOfTicket(ctx.settings, ticket);
  if (previous?.type.id === target.type.id) return refused("sameType", { type: target.type.name });

  const channel = await channelOf(ctx, ticket.channelId);
  const category = categoryFor(ctx, target.type);
  if (channel && !isThread(channel) && !category.ok && target.type.opening.mode === "channel") return refused(category.code);

  const changed = await prisma.ticket.updateMany({
    where: { id: ticket.id, status: "open" },
    data: { typeId: target.type.id, panelId: target.panel.id, typeName: target.type.name, claimedById: null, claimedAt: null },
  });
  if (changed.count === 0) return refused("alreadyClosed");

  if (channel && isThread(channel)) {
    await swapThreadHandlers(ctx, channel, previous?.type, target.type, ticket.openerId);
  } else if (channel) {
    await releaseClaimLock(ctx, channel, previous?.type, ticket.claimedById, ticket.openerId);
    await swapRoles(ctx, channel, previous?.type, target.type);
    if (category.ok && channel.parentId !== category.id && ctx.guild.channels.cache.get(category.id)?.type === ChannelType.GuildCategory) {
      await channel.setParent(category.id, { lockPermissions: false }).catch((error: unknown) => console.warn(`[tickets] could not move ${channel.id}:`, error));
    }
  }
  rememberOpenTicket(ctx.guild.id, ticket.channelId, { id: ticket.id, openerId: ticket.openerId, typeId: target.type.id, panelId: target.panel.id });
  await recordEvent(ticket.id, "transferred", refOf(actor), {
    fromTypeId: ticket.typeId,
    fromTypeName: ticket.typeName,
    toTypeId: target.type.id,
    toTypeName: target.type.name,
  });
  const moved = (await reload(ticket.id)) ?? ticket;
  if (channel) refreshTopic(ctx, channel, moved);
  await refreshControls(ctx, moved);
  // The new type may close inactive tickets after a different time, or never.
  await rescheduleAutoClose(ctx, moved);
  const handlers = target.type.handlers;
  await announceOf(ctx, moved, announce)(
    ctx.settings.messages.transferred,
    {
      ...ticketValues(moved, actor),
      type: target.type.name,
      previousType: ticket.typeName,
      handlers: handlers.map((id) => `<@&${id}>`).join(" "),
    },
    TRANSFERRED_MESSAGE,
    { roles: [...new Set([...handlers, ...pingRolesOf(target.type)])] },
  );
  return done(moved);
}

/**
 * Discord makes a third rename of a channel in ten minutes wait, and discord.js
 * waits with it rather than failing. A rename that has not gone through by
 * then is reported as waiting, and recorded whenever it does go through.
 */
const RENAME_WAIT_MS = 8_000;

export async function rename(
  ctx: TicketCtx,
  ticket: Ticket,
  wanted: string,
  actor: TicketActor,
  announce?: Announce,
  waitMs = RENAME_WAIT_MS,
): Promise<Outcome<Ticket>> {
  if (ticket.status !== "open") return refused("alreadyClosed");
  const channel = await channelOf(ctx, ticket.channelId);
  if (!channel) return refused("channelMissing");
  const name = ticketChannelName(ticket.openerName || "member", wanted.replace(/[{}]/g, ""), { type: ticket.typeName, number: ticketNumber(ticket) });
  const previous = channel.name;
  const pending = channel.setName(name).then(
    () => true,
    () => false,
  );
  const first = await Promise.race([pending, new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), waitMs).unref())]);
  if (first === false) return refused("renameFailed");
  if (first === "waiting") {
    void pending
      .then((renamed) => (renamed ? recordRename(ctx, ticket, previous, name, actor, inChannel(ctx, ticket)) : undefined))
      .catch((error: unknown) => console.warn(`[tickets] could not record the late rename of ${ticket.channelId}:`, error));
    return refused("renameQueued");
  }
  return recordRename(ctx, ticket, previous, name, actor, announceOf(ctx, ticket, announce));
}

async function recordRename(ctx: TicketCtx, ticket: Ticket, previous: string, name: string, actor: TicketActor, announce: Announce): Promise<Outcome<Ticket>> {
  const written = await prisma.ticket.updateMany({ where: { id: ticket.id, status: "open" }, data: { channelName: name } });
  if (written.count === 0) return refused("alreadyClosed");
  await recordEvent(ticket.id, "rename", refOf(actor), { from: previous, to: name });
  const changed = (await reload(ticket.id)) ?? ticket;
  await announce(ctx.settings.messages.renamed, { ...ticketValues(changed, actor), name, previous }, RENAMED_MESSAGE);
  return done(changed);
}

/** The reason closes the sentence, so it only gets a full stop when it has no punctuation of its own. */
export function closeRequestEnding(reason: string | null): string {
  const text = reason?.trim();
  if (!text) return ".";
  return /[.!?]$/.test(text) ? `: ${text}` : `: ${text}.`;
}

/**
 * Asks the opener whether the ticket can close. They answer with the buttons
 * under the request; if they do not, it closes once the timeout passes.
 */
export async function requestClose(ctx: TicketCtx, ticket: Ticket, reason: string | null, actor: TicketActor): Promise<Outcome<Ticket>> {
  if (ticket.status !== "open") return refused("alreadyClosed");
  const channel = await channelOf(ctx, ticket.channelId);
  if (!channel) return refused("channelMissing");
  const requestedAt = new Date();
  const deadline = new Date(requestedAt.getTime() + atLeastAMinute(ctx.settings.general.closeRequestTimeout));
  const written = await prisma.ticket.updateMany({ where: { id: ticket.id, status: "open" }, data: { closeRequestedAt: requestedAt } });
  if (written.count === 0) return refused("alreadyClosed");
  await recordEvent(ticket.id, "close_requested", refOf(actor), { reason });
  await ctx.tasks.cancel("closeRequest", { ticketId: ticket.id });
  await ctx.tasks.schedule("closeRequest", deadline, { ticketId: ticket.id, requestedAt: requestedAt.toISOString(), reason: reason ?? "" });
  const requested = (await reload(ticket.id)) ?? ticket;
  const sent = await ctx.send(
    channel,
    ctx.settings.messages.closeRequest,
    {
      ...ticketValues(requested, actor),
      reason: reason ?? "",
      ending: closeRequestEnding(reason),
      deadline: relativeTime(deadline),
    },
    { fallback: CLOSE_REQUEST_MESSAGE, rows: closeRequestRows(ctx.settings, ticket.id), mentions: { users: [ticket.openerId], roles: [] } },
  );
  if (sent) await storeMessage(ctx, requested, sent);
  return done(requested);
}

/** The opener's Keep open: the request is withdrawn and the ticket carries on. */
export async function keepOpen(ctx: TicketCtx, ticket: Ticket, actor: TicketActor, announce?: Announce): Promise<Outcome<Ticket>> {
  if (ticket.status !== "open") return refused("alreadyClosed");
  const written = await prisma.ticket.updateMany({ where: { id: ticket.id, status: "open" }, data: { closeRequestedAt: null } });
  if (written.count === 0) return refused("alreadyClosed");
  await ctx.tasks.cancel("closeRequest", { ticketId: ticket.id });
  notifyTicketOf(ticket.id, "detail");
  const kept = (await reload(ticket.id)) ?? ticket;
  await announceOf(ctx, kept, announce)(ctx.settings.messages.keptOpen, ticketValues(kept, actor), KEPT_OPEN_MESSAGE);
  return done(kept);
}

/** The opener's rating of a closed ticket. Only the first one counts. */
export async function rate(ticket: Ticket, rating: number, userId: string): Promise<Outcome<Ticket>> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return refused("alreadyRated");
  const changed = await prisma.ticket.updateMany({ where: { id: ticket.id, openerId: userId, rating: null }, data: { rating, ratedAt: new Date() } });
  if (changed.count === 0) return refused("alreadyRated");
  await recordEvent(ticket.id, "rated", { userId, name: ticket.openerName || userId }, { rating });
  return done((await reload(ticket.id)) ?? ticket);
}

export async function rateComment(ticket: Ticket, comment: string, userId: string): Promise<void> {
  const text = comment.trim().slice(0, 1000);
  if (text === "" || ticket.openerId !== userId) return;
  await prisma.ticket.updateMany({ where: { id: ticket.id, openerId: userId, ratingComment: null }, data: { ratingComment: text } });
  notifyTicketOf(ticket.id, "detail");
}
