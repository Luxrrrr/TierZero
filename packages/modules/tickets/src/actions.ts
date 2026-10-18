import {
  readTicketReply,
  ticketMessageFromRow,
  ticketReplySnippet,
  type MessageEmbed,
  type ModuleContext,
  type TicketAccess,
  type TicketActionResult,
  type TicketActor,
  type TicketHealthFacts,
  type TicketPanelPostResult,
  type TicketPanelStatusDto,
  type TicketPriority,
  type TicketReplyFile,
  type TicketReplyResult,
  readTicketAttachments,
  readTicketEmbeds,
} from "@tier0/core";
import { prisma, type Ticket } from "@tier0/db";
import { closeTicket, reopenTicketIn } from "./close.js";
import { messageDto, ticketDetail } from "./detail.js";
import { healthFacts, panelStatusList, postPanelMessage } from "./panel-post.js";
import { CLOSING_MESSAGE, closingValues } from "./messages.js";
import { inChannel } from "./notice.js";
import { TicketActionError, actionError, type Outcome } from "./outcome.js";
import { attachmentsJson, replyEmbedsJson } from "./records.js";
import { findPanel, typeOfTicket } from "./resolve.js";
import type { TicketSettings } from "./settings.js";
import { sendReply, type ReplyReference } from "./webhooks.js";
import { addNote, changeMember, claim, rename, requestClose, setPriority, transfer, unclaim } from "./working.js";

/**
 * What the control API calls for the dashboard's ticket workspace. These do
 * not check who is asking; the caller has already done that with
 * `ticketAccess` and `canTicket`. They check the ticket's state, make the
 * change the same way the slash commands do, and throw a `TicketActionError`
 * with a dashboard sentence and a code when they refuse.
 *
 * `options.access` is the viewer's access, used only to fill the returned
 * ticket's `permissions`; left out, that list is empty.
 */

export type TicketCtx = ModuleContext<TicketSettings>;

export interface TicketActionOptions {
  access?: TicketAccess;
}

async function ticketIn(ctx: TicketCtx, ticketId: number): Promise<Ticket> {
  const ticket = Number.isInteger(ticketId) ? await prisma.ticket.findUnique({ where: { id: ticketId } }) : null;
  if (!ticket || ticket.guildId !== ctx.guild.id) throw new TicketActionError("That ticket doesn't exist in this server.", "notFound");
  return ticket;
}

async function resultOf(ctx: TicketCtx, outcome: Outcome<Ticket>, options: TicketActionOptions | undefined): Promise<TicketActionResult> {
  if (!outcome.ok) throw actionError(outcome.refusal);
  return { ticket: await ticketDetail(ctx, outcome.value, options?.access), notes: outcome.notes };
}

export async function claimTicket(ctx: TicketCtx, ticketId: number, actor: TicketActor, options?: TicketActionOptions): Promise<TicketActionResult> {
  return resultOf(ctx, await claim(ctx, await ticketIn(ctx, ticketId), actor), options);
}

export async function unclaimTicket(ctx: TicketCtx, ticketId: number, actor: TicketActor, options?: TicketActionOptions): Promise<TicketActionResult> {
  return resultOf(ctx, await unclaim(ctx, await ticketIn(ctx, ticketId), actor), options);
}

export async function setTicketPriority(
  ctx: TicketCtx,
  ticketId: number,
  priority: TicketPriority,
  actor: TicketActor,
  options?: TicketActionOptions,
): Promise<TicketActionResult> {
  return resultOf(ctx, await setPriority(ctx, await ticketIn(ctx, ticketId), priority, actor), options);
}

export async function addTicketNote(
  ctx: TicketCtx,
  ticketId: number,
  body: string,
  actor: TicketActor,
  options?: TicketActionOptions,
): Promise<TicketActionResult> {
  if (body.trim() === "") throw new TicketActionError("Write the note before saving it.", "invalid");
  return resultOf(ctx, await addNote(await ticketIn(ctx, ticketId), body, actor), options);
}

export async function changeTicketMember(
  ctx: TicketCtx,
  ticketId: number,
  change: { userId: string; action: "add" | "remove"; name?: string },
  actor: TicketActor,
  options?: TicketActionOptions,
): Promise<TicketActionResult> {
  const ticket = await ticketIn(ctx, ticketId);
  const userId = change.userId === "" && change.name ? await memberNamed(ctx, change.name) : change.userId;
  if (change.action === "remove" && userId === ticket.openerId) throw actionError({ key: "cannotRemoveOpener" });
  return resultOf(ctx, await changeMember(ctx, ticket, { userId, action: change.action }, actor), options);
}

/** How many members a name is looked up among. */
const NAME_SEARCH = 10;

/**
 * The one member a typed name means: an exact match on their name in the
 * server, their display name or their username, or the only member Discord
 * finds for it. Refused, saying why, when there is none or several.
 */
export async function memberNamed(ctx: TicketCtx, typed: string): Promise<string> {
  const name = typed.trim().replace(/^@/, "");
  const wanted = name.toLowerCase();
  const found = await ctx.guild.members.search({ query: name, limit: NAME_SEARCH }).catch(() => null);
  const members = found ? [...found.values()] : [...ctx.guild.members.cache.values()].filter((member) => member.user.username.toLowerCase().startsWith(wanted));
  const exact = members.filter((member) =>
    [member.displayName, member.user.globalName, member.user.username].some((value) => typeof value === "string" && value.toLowerCase() === wanted),
  );
  const pick = exact.length === 1 ? exact[0] : exact.length === 0 && members.length === 1 ? members[0] : undefined;
  if (pick) return pick.id;
  if (members.length === 0) throw new TicketActionError(`Nobody in this server is called ${name}. Check the spelling, or search for them.`, "invalid");
  throw new TicketActionError(`More than one member is called ${name}. Search for them and pick the right one.`, "invalid");
}

export async function renameTicket(ctx: TicketCtx, ticketId: number, name: string, actor: TicketActor, options?: TicketActionOptions): Promise<TicketActionResult> {
  return resultOf(ctx, await rename(ctx, await ticketIn(ctx, ticketId), name, actor), options);
}

/** Asks the opener whether the ticket can close, as `/ticket request-close` does. */
export async function requestTicketClose(
  ctx: TicketCtx,
  ticketId: number,
  request: { reason: string | null },
  actor: TicketActor,
  options?: TicketActionOptions,
): Promise<TicketActionResult> {
  return resultOf(ctx, await requestClose(ctx, await ticketIn(ctx, ticketId), request.reason, actor), options);
}

export async function transferTicket(
  ctx: TicketCtx,
  ticketId: number,
  target: { typeId: string },
  actor: TicketActor,
  options?: TicketActionOptions,
): Promise<TicketActionResult> {
  return resultOf(ctx, await transfer(ctx, await ticketIn(ctx, ticketId), target.typeId, actor), options);
}

/** Closes from the dashboard. The closing message is posted in the ticket first, as the Close button does. */
export async function closeTicketAs(
  ctx: TicketCtx,
  ticketId: number,
  close: { reason?: string | null },
  actor: TicketActor,
  options?: TicketActionOptions,
): Promise<TicketActionResult> {
  const ticket = await ticketIn(ctx, ticketId);
  if (ticket.status !== "open") throw new TicketActionError("This ticket is already closed.", "conflict");
  const reason = close.reason?.trim() || null;
  if (reason === null && typeOfTicket(ctx.settings, ticket)?.type.rules.requireReason === true) {
    throw new TicketActionError(`${ticket.typeName || "These"} tickets need a reason to close. Write one and try again.`, "invalid");
  }
  const announce = () => inChannel(ctx, ticket)(ctx.settings.messages.closing, closingValues({ id: actor.userId }, ticket, reason), CLOSING_MESSAGE);
  return resultOf(ctx, await closeTicket(ctx, ticket, { userId: actor.userId, name: actor.name }, reason, announce), options);
}

export async function reopenTicket(ctx: TicketCtx, ticketId: number, actor: TicketActor, options?: TicketActionOptions): Promise<TicketActionResult> {
  return resultOf(ctx, await reopenTicketIn(ctx, await ticketIn(ctx, ticketId), actor), options);
}

/**
 * Posts a dashboard reply. The text and embeds are checked again here, so a
 * caller that skipped `readTicketReply` still cannot send an empty or
 * oversized message, or an embed Discord would refuse.
 */
export async function replyToTicket(
  ctx: TicketCtx,
  ticketId: number,
  content: string,
  actor: TicketActor,
  files: readonly TicketReplyFile[] = [],
  embeds: readonly MessageEmbed[] = [],
  replyToMessageId?: string,
): Promise<TicketReplyResult> {
  const read = readTicketReply({ content, files, embeds, replyToMessageId });
  if (!read.ok) throw new TicketActionError(read.error, "invalid");
  const target = await ticketIn(ctx, ticketId);
  const replyTo = read.value.replyToMessageId === undefined ? undefined : await replyReference(ctx, target, read.value.replyToMessageId);
  const outcome = await sendReply(ctx, target, read.value.content, actor, read.value.files ?? [], read.value.embeds ?? [], replyTo);
  if (!outcome.ok) throw actionError(outcome.refusal);
  const { ticket, message, delivery } = outcome.value;
  const row = await prisma.ticketMessage.findUnique({ where: { ticketId_messageId: { ticketId: ticket.id, messageId: message.id } } });
  return {
    delivery,
    message: row
      ? messageDto(row)
      : {
          id: 0,
          messageId: message.id,
          author: { userId: actor.userId, name: actor.name, avatarUrl: actor.avatarUrl, isStaff: true },
          content: read.value.content,
          attachments: readTicketAttachments(attachmentsJson(message.attachments?.values() ?? [])),
          embeds: readTicketEmbeds(replyEmbedsJson(read.value.embeds ?? [])),
          replyTo: replyTo?.messageId ?? null,
          createdAt: (message.createdAt ?? new Date()).toISOString(),
          editedAt: null,
          deletedAt: null,
          edits: 0,
          source: "dashboard",
        },
  };
}

/**
 * The message a reply answers, read from the stored copy so the quote says what
 * the conversation shows. Only a message of this ticket that is still there can
 * be answered; a deleted one has nothing to link to.
 */
async function replyReference(ctx: TicketCtx, ticket: Ticket, messageId: string): Promise<ReplyReference> {
  const row = await prisma.ticketMessage.findUnique({ where: { ticketId_messageId: { ticketId: ticket.id, messageId } } });
  if (!row) throw new TicketActionError("That message is not in this ticket any more. Reload the conversation and pick another.", "invalid");
  if (row.deletedAt) throw new TicketActionError("That message was deleted in Discord, so it cannot be replied to.", "invalid");
  const message = ticketMessageFromRow(row);
  return {
    messageId,
    name: message.author.name,
    snippet: ticketReplySnippet(message),
    link: `https://discord.com/channels/${ctx.guild.id}/${ticket.channelId}/${messageId}`,
  };
}

/** Posts the panel, or edits it in place when it is already posted in its channel. */
export async function postPanel(ctx: TicketCtx, panelId: string, _actor: TicketActor): Promise<TicketPanelPostResult> {
  const panel = findPanel(ctx.settings, panelId);
  if (!panel) throw actionError({ key: "panelMissing" });
  const outcome = await postPanelMessage(ctx, panel);
  if (!outcome.ok) throw actionError(outcome.refusal);
  return outcome.value;
}

/** Each panel's state in Discord. `fresh` asks Discord again rather than trusting what was learned in the last minute. */
export async function panelStatuses(ctx: TicketCtx, options: { fresh?: boolean } = {}): Promise<TicketPanelStatusDto[]> {
  return panelStatusList(ctx, options);
}

export async function ticketHealthFacts(ctx: TicketCtx): Promise<TicketHealthFacts> {
  return healthFacts(ctx);
}

/** The ticket as the workspace reads it, or null when it is not in this server. */
export async function getTicketDetail(ctx: TicketCtx, ticketId: number, access?: TicketAccess) {
  const ticket = Number.isInteger(ticketId) ? await prisma.ticket.findUnique({ where: { id: ticketId } }) : null;
  if (!ticket || ticket.guildId !== ctx.guild.id) return null;
  return ticketDetail(ctx, ticket, access);
}
