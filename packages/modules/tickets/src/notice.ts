import type { Message } from "discord.js";
import type { MessageBody, ReplyValues, TicketActor } from "@tier0/core";
import { prisma, type Ticket } from "@tier0/db";
import { storeMessage } from "./capture.js";
import { channelOf, type Answerable, type TicketCtx } from "./context.js";
import { ticketRows } from "./controls.js";
import { isSnowflake, ticketNumber } from "./records.js";
import { effectiveAutoClose, typeOfTicket } from "./resolve.js";
import { welcomeBody, welcomeFallback, welcomeValuesOf } from "./welcome.js";

/**
 * How a change to a ticket is told to the people in it. From Discord the
 * notice is the public answer to the button or command, as `/ticket add`
 * always was; from the dashboard it is posted in the channel.
 */

export interface Mentions {
  users?: string[];
  roles?: string[];
}

export type Announce = (body: MessageBody, values: ReplyValues, fallback: MessageBody, mentions?: Mentions) => Promise<Message | null>;

/** Posts in the ticket's channel. Pings only what `mentions` lists, nobody by default. */
export function inChannel(ctx: TicketCtx, ticket: Ticket): Announce {
  return async (body, values, fallback, mentions) => {
    const channel = await channelOf(ctx, ticket.channelId);
    if (!channel) return null;
    const sent = await ctx.send(channel, body, values, {
      fallback,
      mentions: { users: mentions?.users ?? [], roles: mentions?.roles ?? [] },
    });
    if (sent) await storeMessage(ctx, ticket, sent);
    return sent;
  };
}

/** Answers the interaction in public with the notice. */
export function asReply(ctx: TicketCtx, ticket: Ticket, interaction: Answerable): Announce {
  return async (body, values, fallback) => {
    const ok = await ctx.reply(interaction, body, values, { fallback, ephemeral: false });
    if (!ok) return null;
    const sent = await interaction.fetchReply().catch(() => null);
    if (sent) await storeMessage(ctx, ticket, sent);
    return sent;
  };
}

/** A person as a message names them: a mention for a member, the name for the automatic close. */
export const nameOf = (actor: { userId: string; name: string }) => (isSnowflake(actor.userId) ? `<@${actor.userId}>` : actor.name);

/** The values every notice about a ticket can use. */
export function ticketValues(ticket: Ticket, actor: { userId: string; name: string }): ReplyValues {
  return { user: `<@${ticket.openerId}>`, staff: nameOf(actor), number: ticketNumber(ticket), type: ticket.typeName };
}

export const refOf = (actor: TicketActor | { userId: string; name: string } | null) => (actor ? { userId: actor.userId, name: actor.name } : null);

/**
 * Fills the first message in again and puts the buttons that match the ticket
 * under it, so Claim turns into Unclaim and `{claimedBy}` names who has it.
 */
export async function refreshControls(ctx: TicketCtx, ticket: Ticket): Promise<void> {
  if (!ticket.controlsMessageId) return;
  const type = typeOfTicket(ctx.settings, ticket)?.type;
  const channel = await channelOf(ctx, ticket.channelId);
  const message = await channel?.messages.fetch(ticket.controlsMessageId).catch(() => null);
  if (!message) return;
  if (!type) {
    await message.edit({ components: ticketRows(ctx.settings, ticket, undefined) }).catch(() => undefined);
    return;
  }
  const values = welcomeValuesOf(ctx.settings, type, ticket);
  await ctx.edit(message, welcomeBody(type, ticket, values), values, {
    fallback: welcomeFallback(type, ticket, values),
    rows: ticketRows(ctx.settings, ticket, type),
  });
}

/** Moves the inactivity close back to a full window from now, when the ticket's type closes inactive tickets. */
export async function resetAutoClose(ctx: TicketCtx, ticket: Pick<Ticket, "channelId" | "panelId" | "typeId">): Promise<void> {
  const autoClose = effectiveAutoClose(ctx.settings, typeOfTicket(ctx.settings, ticket)?.type);
  if (autoClose.enabled) await ctx.tasks.reschedule("autoclose", new Date(Date.now() + autoClose.after), { channelId: ticket.channelId });
  else await ctx.tasks.cancel("autoclose", { channelId: ticket.channelId });
}

/** How long a close that was due at once is put off, so saving a shorter time does not close a pile of tickets in the same second. */
const AUTO_CLOSE_GRACE_MS = 60_000;

/**
 * When an open ticket should close for inactivity under the settings as they
 * are now, counted from its last message, or null when it should not. Pure,
 * so the rule can be tested on its own.
 */
export function autoCloseDue(
  settings: Parameters<typeof effectiveAutoClose>[0],
  ticket: Pick<Ticket, "panelId" | "typeId" | "lastActivityAt">,
  now = Date.now(),
): Date | null {
  const autoClose = effectiveAutoClose(settings, typeOfTicket(settings, ticket)?.type);
  if (!autoClose.enabled) return null;
  return new Date(Math.max(ticket.lastActivityAt.getTime() + autoClose.after, now + AUTO_CLOSE_GRACE_MS));
}

/**
 * Puts the inactivity close where the current settings say, without counting
 * the wait again from now: used after the settings change and after a move to
 * another type, neither of which is activity in the ticket.
 */
export async function rescheduleAutoClose(ctx: TicketCtx, ticket: Pick<Ticket, "channelId" | "panelId" | "typeId" | "lastActivityAt">): Promise<void> {
  const due = autoCloseDue(ctx.settings, ticket);
  if (due) await ctx.tasks.reschedule("autoclose", due, { channelId: ticket.channelId });
  else await ctx.tasks.cancel("autoclose", { channelId: ticket.channelId });
}

export async function reload(ticketId: number): Promise<Ticket | null> {
  return prisma.ticket.findUnique({ where: { id: ticketId } });
}
