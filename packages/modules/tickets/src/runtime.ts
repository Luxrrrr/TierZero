import type { EventHandlers, TaskHandler } from "@tier0/core";
import { prisma, type Ticket } from "@tier0/db";
import { forgetOpenTicket } from "./cache.js";
import { captureCreate, captureDelete, captureUpdate, pruneMessages } from "./capture.js";
import { closeTicket, deleteKept } from "./close.js";
import { channelOf, type TicketCtx } from "./context.js";
import { openedByStaff, recordEvent } from "./controls.js";
import { CLOSING_MESSAGE, OPENER_LEFT_MESSAGE, REMINDER_MESSAGE, closingValues } from "./messages.js";
import { autoCloseDue, inChannel, rescheduleAutoClose } from "./notice.js";
import { spokenDuration, ticketNumber } from "./records.js";
import { allTypes, effectiveAutoClose, typeOfTicket } from "./resolve.js";
import type { TicketSettings } from "./settings.js";
import { forgetWebhook } from "./webhooks.js";

/**
 * What the module does without anyone pressing anything: it keeps the record
 * of each open ticket as messages come and go, and runs the work it scheduled
 * for later. Scheduled work reads the settings again when it runs, because
 * they may have changed since it was scheduled.
 */

const DAY_MS = 86_400_000;

/** A ticket whose channel was deleted in Discord is closed, or no longer kept, so it stops showing as open. */
async function channelGone(ctx: TicketCtx, channelId: string): Promise<void> {
  forgetWebhook(channelId);
  const ticket = await prisma.ticket.findUnique({ where: { channelId } });
  if (!ticket || ticket.guildId !== ctx.guild.id) return;
  if (ticket.status === "open") {
    const closed = await prisma.ticket.updateMany({ where: { id: ticket.id, status: "open" }, data: { status: "closed", closedAt: new Date() } });
    forgetOpenTicket(ctx.guild.id, channelId);
    if (closed.count === 0) return;
    await Promise.all([
      ctx.tasks.cancel("autoclose", { channelId }),
      ctx.tasks.cancel("reminder", { ticketId: ticket.id }),
      ctx.tasks.cancel("closeRequest", { ticketId: ticket.id }),
    ]);
    await recordEvent(ticket.id, "closed", null, { reason: null });
  } else if (ticket.archived) {
    await prisma.ticket.update({ where: { id: ticket.id }, data: { archived: false } });
    await ctx.tasks.cancel("deleteArchived", { ticketId: ticket.id });
  }
}

const automatic = (ctx: TicketCtx) => ({ userId: "auto-close", name: ctx.settings.labels.autoCloseName });

/**
 * The opener left the server. Each of their open tickets is marked, and,
 * as General says, told so or closed. The mark is set once, in a conditional
 * update, so a member who leaves and rejoins and leaves again is not
 * announced twice.
 */
export async function openerLeft(ctx: TicketCtx, userId: string, name: string | null): Promise<void> {
  const mode = ctx.settings.general.openerLeaves;
  if (mode === "nothing") return;
  const open = await prisma.ticket.findMany({ where: { guildId: ctx.guild.id, openerId: userId, status: "open" } });
  for (const ticket of open) {
    // Staff who opened a ticket to talk to someone are not a member who needs help, so their leaving changes nothing.
    if (await openedByStaff(ticket.id)) continue;
    const marked = await prisma.ticket.updateMany({ where: { id: ticket.id, status: "open", openerLeftAt: null }, data: { openerLeftAt: new Date() } });
    if (marked.count === 0) continue;
    const closing = mode === "close";
    await recordEvent(ticket.id, "opener_left", null, { closed: closing });
    const announce = () =>
      inChannel(ctx, ticket)(
        ctx.settings.messages.openerLeft,
        { user: `<@${ticket.openerId}>`, username: name ?? ticket.openerName, number: ticketNumber(ticket), type: ticket.typeName },
        OPENER_LEFT_MESSAGE,
      );
    if (closing) await closeTicket(ctx, ticket, automatic(ctx), ctx.settings.labels.openerLeftReason, announce);
    else await announce();
  }
}

export const events: Partial<EventHandlers<TicketSettings>> = {
  // Every message in the server comes through here, so the check for a
  // ticket is an in-memory lookup; only a message in an open ticket costs a
  // write. A message from a person pushes the inactivity close back, in one
  // update of the pending task rather than a delete and an insert.
  async messageCreate(message, ctx) {
    const ticket = await captureCreate(ctx, message);
    if (!ticket) return;
    const autoClose = effectiveAutoClose(ctx.settings, typeOfTicket(ctx.settings, ticket)?.type);
    if (!autoClose.enabled) return;
    await ctx.tasks.reschedule("autoclose", new Date(Date.now() + autoClose.after), { channelId: message.channelId });
  },

  async messageUpdate(_before, after, ctx) {
    await captureUpdate(ctx, after);
  },

  async messageDelete(message, ctx) {
    await captureDelete(ctx, message.channelId, [message.id]);
  },

  async messageDeleteBulk(messages, channel, ctx) {
    await captureDelete(ctx, channel.id, [...messages.keys()]);
  },

  async channelDelete(channel, ctx) {
    await channelGone(ctx, channel.id);
  },

  async threadDelete(thread, ctx) {
    await channelGone(ctx, thread.id);
  },

  async memberLeave(member, ctx) {
    await openerLeft(ctx, member.id, member.displayName ?? member.user?.username ?? null);
  },
};

const ticketIdOf = (payload: Record<string, unknown>) => (typeof payload.ticketId === "number" ? payload.ticketId : null);

async function ticketOf(ctx: TicketCtx, payload: Record<string, unknown>) {
  const id = ticketIdOf(payload);
  const ticket = id === null ? null : await prisma.ticket.findUnique({ where: { id } });
  return ticket?.guildId === ctx.guild.id ? ticket : null;
}

/** When a kept channel is due to be deleted, by the days set now, or null when it is kept until staff delete it. */
function deleteKeptDue(settings: TicketSettings, ticket: Pick<Ticket, "closedAt">): Date | null {
  const days = settings.general.archiveDays;
  if (days <= 0 || !ticket.closedAt) return null;
  return new Date(ticket.closedAt.getTime() + days * DAY_MS);
}

export const tasks: Record<string, TaskHandler<TicketSettings>> = {
  /**
   * Closes an inactive ticket, if the settings still say it should be closed
   * by now. Auto-close switched off, the type set to never close, or a longer
   * time saved since, all leave it open; a longer time moves the close.
   */
  async autoclose(payload, ctx) {
    const channelId = payload.channelId;
    if (typeof channelId !== "string") return;
    const ticket = await prisma.ticket.findUnique({ where: { channelId } });
    if (!ticket || ticket.status !== "open" || ticket.guildId !== ctx.guild.id) return;
    const due = autoCloseDue(ctx.settings, ticket, 0);
    if (!due) return;
    if (due.getTime() > Date.now()) {
      await ctx.tasks.reschedule("autoclose", due, { channelId });
      return;
    }
    const closer = automatic(ctx);
    const autoClose = effectiveAutoClose(ctx.settings, typeOfTicket(ctx.settings, ticket)?.type);
    const reason = ctx.settings.labels.inactiveReason;
    const notice = async () => {
      const channel = await channelOf(ctx, channelId);
      if (channel) {
        await ctx.send(channel, ctx.settings.messages.closing, closingValues({ id: closer.userId, tag: closer.name }, ticket, reason), {
          fallback: CLOSING_MESSAGE,
          mentions: { users: [], roles: [] },
        });
      }
    };
    await closeTicket(ctx, ticket, closer, autoClose.notice ? reason : null, autoClose.notice ? notice : undefined);
  },

  /** Pings the handlers once when only the opener has spoken since the ticket opened. */
  async reminder(payload, ctx) {
    const ticket = await ticketOf(ctx, payload);
    if (!ticket || ticket.status !== "open" || ticket.firstResponseAt !== null || !ctx.settings.automation.reminder.enabled) return;
    const handlers = typeOfTicket(ctx.settings, ticket)?.type.handlers ?? [];
    await inChannel(ctx, ticket)(
      ctx.settings.automation.reminder.message,
      {
        user: `<@${ticket.openerId}>`,
        handlers: handlers.map((id) => `<@&${id}>`).join(" "),
        waited: spokenDuration(Date.now() - ticket.openedAt.getTime()),
        number: ticketNumber(ticket),
        type: ticket.typeName,
        ticket: `<#${ticket.channelId}>`,
      },
      REMINDER_MESSAGE,
      { roles: handlers },
    );
    await recordEvent(ticket.id, "reminder", null);
  },

  /** Closes a ticket whose opener did not answer a close request, unless a newer request replaced it. */
  async closeRequest(payload, ctx) {
    const ticket = await ticketOf(ctx, payload);
    if (!ticket || ticket.status !== "open" || !ticket.closeRequestedAt) return;
    if (typeof payload.requestedAt === "string" && ticket.closeRequestedAt.toISOString() !== payload.requestedAt) return;
    const closer = automatic(ctx);
    const reason = typeof payload.reason === "string" && payload.reason !== "" ? payload.reason : ctx.settings.labels.inactiveReason;
    await closeTicket(ctx, ticket, closer, reason, () =>
      inChannel(ctx, ticket)(ctx.settings.messages.closing, closingValues({ id: closer.userId, tag: closer.name }, ticket, reason), CLOSING_MESSAGE),
    );
  },

  /**
   * Deletes a kept channel once the days set for that have passed. The days
   * are read again when it runs, so setting 0 later keeps the channel, and a
   * longer time moves the deletion.
   */
  async deleteArchived(payload, ctx) {
    const ticket = await ticketOf(ctx, payload);
    if (!ticket || ticket.status !== "closed" || !ticket.archived) return;
    const due = deleteKeptDue(ctx.settings, ticket);
    if (!due) return;
    if (due.getTime() > Date.now()) {
      await ctx.tasks.schedule("deleteArchived", due, { ticketId: ticket.id });
      return;
    }
    await deleteKept(ctx, ticket, automatic(ctx));
  },

  /**
   * Deletes one closed ticket's stored messages once the retention period is
   * up. The period is read again when it runs, so shortening or switching it
   * off after the ticket closed is respected.
   */
  async prune(payload, ctx) {
    const ticket = await ticketOf(ctx, payload);
    const days = ctx.settings.transcripts.retentionDays;
    if (!ticket || ticket.status !== "closed" || !ticket.closedAt || days <= 0) return;
    const due = new Date(ticket.closedAt.getTime() + days * DAY_MS);
    if (due.getTime() > Date.now()) {
      await ctx.tasks.schedule("prune", due, { ticketId: ticket.id });
      return;
    }
    const removed = await prisma.ticketMessage.deleteMany({ where: { ticketId: ticket.id } });
    if (removed.count > 0) await prisma.ticket.update({ where: { id: ticket.id }, data: { messagesPrunedAt: new Date() } });
  },

  /** A daily pass for tickets closed before the retention period was set. */
  async pruneSweep(_payload, ctx) {
    if (ctx.settings.transcripts.retentionDays <= 0) return;
    await pruneMessages(ctx);
    await ctx.tasks.schedule("pruneSweep", new Date(Date.now() + DAY_MS));
  },
};

/** Keeps exactly one daily sweep queued while a retention period is set. */
export async function scheduleSweep(ctx: TicketCtx): Promise<void> {
  await ctx.tasks.cancel("pruneSweep");
  if (ctx.settings.transcripts.store && ctx.settings.transcripts.retentionDays > 0) {
    await ctx.tasks.schedule("pruneSweep", new Date(Date.now() + 60_000));
  }
}

/** What decides when tickets close for inactivity, so a save that changes none of it costs nothing. */
function autoCloseKey(settings: TicketSettings): string {
  const { enabled, after } = settings.automation.autoClose;
  const types = allTypes(settings).map(({ type }) => [type.id, type.overrides.autoClose, type.overrides.autoCloseAfter]);
  return JSON.stringify([enabled, after, types]);
}

/**
 * Brings the work already scheduled in line with settings that just changed:
 * every open ticket's inactivity close is moved, or dropped, to what the new
 * settings say counted from its last message, and kept channels are given the
 * deletion the new number of days asks for.
 */
export async function reconcileSchedules(ctx: TicketCtx, previous: TicketSettings): Promise<void> {
  if (autoCloseKey(previous) !== autoCloseKey(ctx.settings)) {
    const open = await prisma.ticket.findMany({
      where: { guildId: ctx.guild.id, status: "open" },
      select: { channelId: true, panelId: true, typeId: true, lastActivityAt: true },
    });
    for (const ticket of open) await rescheduleAutoClose(ctx, ticket);
  }
  if (previous.general.archiveDays !== ctx.settings.general.archiveDays) {
    const kept = await prisma.ticket.findMany({ where: { guildId: ctx.guild.id, status: "closed", archived: true }, select: { id: true, closedAt: true } });
    for (const ticket of kept) {
      await ctx.tasks.cancel("deleteArchived", { ticketId: ticket.id });
      const due = deleteKeptDue(ctx.settings, ticket);
      if (due) await ctx.tasks.schedule("deleteArchived", due, { ticketId: ticket.id });
    }
  }
}
