import { MessageFlags, type ChatInputCommandInteraction, type MessageComponentInteraction, type ModalSubmitInteraction } from "discord.js";
import { LEGACY_TYPE_ID } from "@tier0/core";
import { prisma, type Ticket } from "@tier0/db";
import { closeTicket, reopenTicketIn } from "./close.js";
import { actorOf, isStaffOf, may, memberRoleIds, refuse, type Answerable, type DiscordPerson, type TicketCtx } from "./context.js";
import { reasonForm } from "./controls.js";
import { CLOSING_MESSAGE, closingValues } from "./messages.js";
import { asReply } from "./notice.js";
import { done, refused, type Outcome } from "./outcome.js";
import type { TicketType } from "./panels.js";
import { withoutPings } from "./records.js";
import { accessSettingsOf, effectiveLimit, mayOpen, typeOfTicket } from "./resolve.js";

/**
 * The parts of the Discord handlers that the slash commands and the buttons
 * share: who may close or reopen a ticket, and closing one in front of the
 * people in it.
 */

export type Actor = Answerable & DiscordPerson;

/** Answers with the refusal an operation came back with, or does nothing when it went through. */
export async function answer<T>(ctx: TicketCtx, interaction: Answerable, outcome: Outcome<T>): Promise<boolean> {
  if (outcome.ok) return true;
  await refuse(ctx, interaction, outcome.refusal.key, outcome.refusal.values);
  return false;
}

/**
 * Acknowledges an interaction without saying anything, for an operation that
 * posts its own message in the channel, such as a close request with buttons.
 */
export async function settle(interaction: ChatInputCommandInteraction | MessageComponentInteraction | ModalSubmitInteraction): Promise<void> {
  if (interaction.replied || interaction.deferred) return;
  if (interaction.isMessageComponent()) {
    await interaction.deferUpdate().catch(() => undefined);
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);
  await interaction.deleteReply().catch(() => undefined);
}

/** Whether this person may close the ticket, telling them why not when they may not. */
export async function mayClose(ctx: TicketCtx, interaction: Actor, ticket: Ticket): Promise<boolean> {
  if (may(ctx.settings, interaction, "close", ticket)) return true;
  if (interaction.user.id === ticket.openerId) {
    const type = typeOfTicket(ctx.settings, ticket)?.type;
    if (type?.rules.openerCanClose === false) {
      await refuse(ctx, interaction, "staffOnlyClose", { type: ticket.typeName || type.name });
      return false;
    }
    return true;
  }
  await refuse(ctx, interaction, "cannotClose");
  return false;
}

/** Whether a close from this interaction has to ask for a reason first. */
export function needsReason(ctx: TicketCtx, ticket: Ticket, reason: string | null): boolean {
  return reason === null && typeOfTicket(ctx.settings, ticket)?.type.rules.requireReason === true;
}

export async function askReason(ctx: TicketCtx, interaction: ChatInputCommandInteraction | MessageComponentInteraction, ticket: Ticket): Promise<void> {
  await interaction.showModal(reasonForm(ctx.settings, ticket.id));
}

/** Closes, answering with the closing message once the close has gone through, or with why it did not. */
export async function closeFrom(ctx: TicketCtx, interaction: Actor, ticket: Ticket, reason: string | null): Promise<void> {
  // A public answer cannot be given a mention allowlist, and the opener may have typed the reason, so it is made unable to ping.
  const shown = reason === null ? null : withoutPings(reason);
  const outcome = await closeTicket(ctx, ticket, { userId: interaction.user.id, name: interaction.user.tag }, reason, () =>
    ctx.reply(interaction, ctx.settings.messages.closing, closingValues(interaction.user, ticket, shown), {
      fallback: CLOSING_MESSAGE,
      ephemeral: false,
    }),
  );
  if (!(await answer(ctx, interaction, outcome))) return;
  if (outcome.ok && outcome.notes.length > 0) console.warn(`[tickets] ticket ${ticket.id} closed with notes: ${outcome.notes.join(" ")}`);
}

/**
 * Reopens from Discord. Staff may whenever reopening is on; the opener may
 * too unless the type leaves that to staff.
 */
export async function reopenFrom(ctx: TicketCtx, interaction: Actor, ticket: Ticket | null): Promise<void> {
  if (!ticket) {
    await refuse(ctx, interaction, "notATicket");
    return;
  }
  if (ticket.status === "open") return void (await refuse(ctx, interaction, "notClosed"));
  if (!ticket.archived) return void (await refuse(ctx, interaction, "cannotReopen"));
  if (!accessSettingsOf(ctx.settings).reopen) return void (await refuse(ctx, interaction, "reopenOff"));
  const staff = may(ctx.settings, interaction, "reopen", ticket);
  if (!staff) {
    if (interaction.user.id !== ticket.openerId) return void (await refuse(ctx, interaction, isStaffOf(ctx.settings, interaction, ticket) ? "reopenOff" : "notStaff"));
    const type = typeOfTicket(ctx.settings, ticket)?.type;
    if (type?.rules.reopenNeedsStaff) return void (await refuse(ctx, interaction, "reopenNeedsStaff"));
    if (type) {
      const allowed = await openerMayReopen(ctx, interaction, ticket, type);
      if (!allowed.ok) return void (await refuse(ctx, interaction, allowed.refusal.key, allowed.refusal.values));
    }
  }
  await answer(ctx, interaction, await reopenTicketIn(ctx, ticket, actorOf(interaction.user, interaction.member), asReply(ctx, ticket, interaction)));
}

/**
 * The rules an opener meets when opening a ticket hold when they reopen one
 * themselves: the blocklist, the roles that may open the type, and how many of
 * its tickets they may have open. The wait between tickets does not apply,
 * since reopening brings back a ticket rather than starting a new one.
 */
export async function openerMayReopen(ctx: TicketCtx, person: DiscordPerson, ticket: Ticket, type: TicketType): Promise<Outcome<null>> {
  const allowed = mayOpen(ctx.settings, type, { id: person.user.id, roleIds: memberRoleIds(person.member) });
  if (!allowed.allowed) return refused(allowed.code, { type: type.name });
  const limit = effectiveLimit(ctx.settings, type);
  const openCount = await prisma.ticket.count({
    where: { guildId: ctx.guild.id, openerId: ticket.openerId, status: "open", OR: [{ typeId: type.id }, ...(type.id === LEGACY_TYPE_ID ? [{ typeId: null }] : [])] },
  });
  if (openCount >= limit) return refused(limit === 1 ? "limitOne" : "limitMany", { openCount, limit });
  return done(null);
}
