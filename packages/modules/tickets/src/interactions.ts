import { MessageFlags, type MessageComponentInteraction, type ModalSubmitInteraction } from "discord.js";
import { readTicketDetail, type ComponentHandler, type ModalHandler } from "@tier0/core";
import { prisma, type Ticket } from "@tier0/db";
import { deleteKept } from "./close.js";
import { actorOf, isStaffOf, may, refuse, type TicketCtx } from "./context.js";
import { formOf, ratingCommentForm } from "./controls.js";
import { RATING_THANKS_MESSAGE } from "./messages.js";
import { asReply } from "./notice.js";
import { checkOpen, openTicket } from "./open.js";
import { answer, askReason, closeFrom, mayClose, needsReason, reopenFrom, settle } from "./people.js";
import { ticketNumber } from "./records.js";
import { answersOf, findType, legacyButtonType, openTargetOf, type PanelType } from "./resolve.js";
import type { TicketSettings } from "./settings.js";
import { claim, keepOpen, rate, rateComment, unclaim } from "./working.js";

/**
 * The buttons, the panel menu and the forms the module puts in Discord. A
 * ticket button carries the ticket's number; the panel's carry the panel and
 * the type; the rating buttons, which arrive by direct message, start with the
 * server's id.
 */

type Components = Record<string, ComponentHandler<TicketSettings>>;
type Modals = Record<string, ModalHandler<TicketSettings>>;

/** The type a panel button or form names, or the one an old panel's single button became. */
function targetOf(ctx: TicketCtx, rest: string): PanelType | undefined {
  const target = openTargetOf(rest);
  return target ? findType(ctx.settings, target.panelId, target.typeId) : legacyButtonType(ctx.settings);
}

async function ticketById(ctx: TicketCtx, rest: string): Promise<Ticket | null> {
  const id = Number(rest.split(":").at(-1));
  if (!Number.isInteger(id)) return null;
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  return ticket?.guildId === ctx.guild.id ? ticket : null;
}

/** A ticket button, read from the channel it was pressed in, as the Close button always was. */
async function ticketHere(ctx: TicketCtx, interaction: MessageComponentInteraction | ModalSubmitInteraction, rest: string): Promise<Ticket | null> {
  const here = interaction.channelId ? await prisma.ticket.findUnique({ where: { channelId: interaction.channelId } }) : null;
  return here?.guildId === ctx.guild.id ? here : ticketById(ctx, rest);
}

async function startOpening(ctx: TicketCtx, interaction: MessageComponentInteraction, target: PanelType | undefined): Promise<void> {
  if (!target) return refuse(ctx, interaction, "typeMissing");
  if (target.type.form.length === 0) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await openTicket(ctx, interaction, target, []);
    return;
  }
  // Checked before the form too, so nobody fills one in only to be refused.
  if (!(await answer(ctx, interaction, await checkOpen(ctx, interaction, target)))) return;
  await interaction.showModal(formOf(target, ctx.settings.labels.modalTitle));
}

/** Clears what a member picked in the panel menu, so the same option can be picked again. */
function resetMenu(interaction: MessageComponentInteraction): void {
  const components = interaction.message.components.map((row) => row.toJSON());
  void interaction.message.edit({ components }).catch(() => undefined);
}

async function lastRequestReason(ticketId: number): Promise<string | null> {
  const event = await prisma.ticketEvent.findFirst({ where: { ticketId, kind: "close_requested" }, orderBy: { id: "desc" } });
  const reason = readTicketDetail(event?.detail).reason;
  return typeof reason === "string" && reason !== "" ? reason : null;
}

/** Takes the buttons off a message once they have been answered. */
function clearButtons(interaction: MessageComponentInteraction | ModalSubmitInteraction): void {
  if (interaction.message) void interaction.message.edit({ components: [] }).catch(() => undefined);
}

export const components: Components = {
  async open(interaction, { rest, ctx }) {
    await startOpening(ctx, interaction, targetOf(ctx, rest));
  },

  async pick(interaction, { rest, ctx }) {
    const typeId = interaction.isStringSelectMenu() ? interaction.values[0] : undefined;
    await startOpening(ctx, interaction, typeId ? findType(ctx.settings, rest, typeId) : undefined);
    resetMenu(interaction);
  },

  async close(interaction, { rest, ctx }) {
    const ticket = await ticketHere(ctx, interaction, rest);
    if (!ticket || ticket.status !== "open") return refuse(ctx, interaction, "alreadyClosed");
    if (!(await mayClose(ctx, interaction, ticket))) return;
    if (needsReason(ctx, ticket, null)) return askReason(ctx, interaction, ticket);
    await closeFrom(ctx, interaction, ticket, null);
  },

  async claim(interaction, { rest, ctx }) {
    const ticket = await ticketById(ctx, rest);
    if (!ticket || ticket.status !== "open") return refuse(ctx, interaction, "alreadyClosed");
    if (!isStaffOf(ctx.settings, interaction, ticket)) return refuse(ctx, interaction, "notStaff");
    if (ticket.claimedById && !may(ctx.settings, interaction, "claim", ticket)) {
      return refuse(ctx, interaction, "alreadyClaimed", { claimedBy: `<@${ticket.claimedById}>` });
    }
    await answer(ctx, interaction, await claim(ctx, ticket, actorOf(interaction.user, interaction.member), asReply(ctx, ticket, interaction)));
  },

  async unclaim(interaction, { rest, ctx }) {
    const ticket = await ticketById(ctx, rest);
    if (!ticket || ticket.status !== "open") return refuse(ctx, interaction, "alreadyClosed");
    if (!isStaffOf(ctx.settings, interaction, ticket)) return refuse(ctx, interaction, "notStaff");
    if (ticket.claimedById === null) return refuse(ctx, interaction, "notClaimed");
    if (!may(ctx.settings, interaction, "unclaim", ticket)) return refuse(ctx, interaction, "notYourClaim", { claimedBy: `<@${ticket.claimedById}>` });
    await answer(ctx, interaction, await unclaim(ctx, ticket, actorOf(interaction.user, interaction.member), asReply(ctx, ticket, interaction)));
  },

  async confirmClose(interaction, { rest, ctx }) {
    const ticket = await ticketById(ctx, rest);
    if (!ticket || ticket.status !== "open") return refuse(ctx, interaction, "alreadyClosed");
    if (interaction.user.id !== ticket.openerId) return refuse(ctx, interaction, "notOpener");
    clearButtons(interaction);
    await closeFrom(ctx, interaction, ticket, await lastRequestReason(ticket.id));
  },

  async keepOpen(interaction, { rest, ctx }) {
    const ticket = await ticketById(ctx, rest);
    if (!ticket || ticket.status !== "open") return refuse(ctx, interaction, "alreadyClosed");
    if (interaction.user.id !== ticket.openerId) return refuse(ctx, interaction, "notOpener");
    clearButtons(interaction);
    await answer(ctx, interaction, await keepOpen(ctx, ticket, actorOf(interaction.user, interaction.member), asReply(ctx, ticket, interaction)));
  },

  async reopen(interaction, { rest, ctx }) {
    await reopenFrom(ctx, interaction, await ticketById(ctx, rest));
  },

  async delete(interaction, { rest, ctx }) {
    const ticket = await ticketById(ctx, rest);
    if (!ticket) return refuse(ctx, interaction, "notATicket");
    if (ticket.status === "open") return refuse(ctx, interaction, "notClosed");
    if (!isStaffOf(ctx.settings, interaction, ticket)) return refuse(ctx, interaction, "notStaff");
    await settle(interaction);
    await deleteKept(ctx, ticket, { userId: interaction.user.id, name: interaction.user.tag });
  },

  async rate(interaction, { rest, ctx }) {
    const [, ticketId, value] = rest.split(":");
    const ticket = await ticketById(ctx, ticketId ?? "");
    if (!ticket) return refuse(ctx, interaction, "notATicket");
    if (interaction.user.id !== ticket.openerId) return refuse(ctx, interaction, "notOpener");
    if (!(await answer(ctx, interaction, await rate(ticket, Number(value), interaction.user.id)))) return;
    await interaction.showModal(ratingCommentForm(ctx.settings, ctx.guild.id, ticket.id));
  },
};

export const modals: Modals = {
  async subject(interaction, { rest, ctx }) {
    const target = targetOf(ctx, rest);
    if (!target) return refuse(ctx, interaction, "typeMissing");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const values = target.type.form.map((_question, index) => interaction.fields.getTextInputValue(`q${index}`));
    await openTicket(ctx, interaction, target, answersOf(target.type.form, values));
  },

  async closeReason(interaction, { rest, ctx }) {
    const ticket = await ticketHere(ctx, interaction, rest);
    if (!ticket || ticket.status !== "open") return refuse(ctx, interaction, "alreadyClosed");
    if (!(await mayClose(ctx, interaction, ticket))) return;
    const reason = interaction.fields.getTextInputValue("reason").trim() || null;
    await closeFrom(ctx, interaction, ticket, reason);
  },

  async rateComment(interaction, { rest, ctx }) {
    const ticket = await ticketById(ctx, rest);
    if (!ticket || interaction.user.id !== ticket.openerId) return refuse(ctx, interaction, "notOpener");
    await rateComment(ticket, interaction.fields.getTextInputValue("comment"), interaction.user.id);
    clearButtons(interaction);
    await ctx.reply(interaction, ctx.settings.ratings.thanks, { rating: ticket.rating ?? "", number: ticketNumber(ticket) }, { fallback: RATING_THANKS_MESSAGE });
  },
};

/** The rating buttons and their form arrive by direct message. */
export const DIRECT_MESSAGE_ACTIONS = ["rate", "rateComment"];
