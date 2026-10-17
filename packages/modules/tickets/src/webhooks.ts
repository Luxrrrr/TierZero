import { AttachmentBuilder, ChannelType, RESTJSONErrorCodes, type Message, type TextChannel, type Webhook } from "discord.js";
import type { TicketActor, TicketReplyFile } from "@tier0/core";
import { prisma, type Ticket } from "@tier0/db";
import { noteActivity } from "./capture.js";
import { memberIdsIn } from "./channels.js";
import { channelOf, isThread, type TicketCtx } from "./context.js";
import { resetAutoClose } from "./notice.js";
import { done, refused, type Outcome } from "./outcome.js";
import { attachmentsJson, attributedReply, replyMentions } from "./records.js";
import { staffRolesOf, typeOfTicket } from "./resolve.js";

/**
 * Dashboard replies, posted under the staff member's name and avatar through
 * one webhook per channel. A private thread posts through its parent's. The
 * webhooks are looked up or made when first needed and kept in memory; without
 * Manage Webhooks the reply goes out as the bot with the name on top instead.
 */

const WEBHOOK_NAME = "Ticket replies";
/** How long a channel the bot could not make a webhook in is left alone before it tries again. */
const RETRY_MS = 5 * 60_000;

const hooks = new Map<string, Webhook | { failedAt: number }>();

const isWebhook = (entry: Webhook | { failedAt: number } | undefined): entry is Webhook => !!entry && "send" in entry;

function errorCode(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "number" ? error.code : undefined;
}

async function webhookFor(ctx: TicketCtx, channel: TextChannel): Promise<Webhook | null> {
  const known = hooks.get(channel.id);
  if (isWebhook(known)) return known;
  if (known && Date.now() - known.failedAt < RETRY_MS) return null;
  try {
    const existing = (await channel.fetchWebhooks()).find((hook) => hook.owner?.id === ctx.client.user?.id && hook.name === WEBHOOK_NAME);
    const hook = existing ?? (await channel.createWebhook({ name: WEBHOOK_NAME, reason: "Dashboard replies to tickets" }));
    hooks.set(channel.id, hook);
    return hook;
  } catch (error) {
    if (errorCode(error) !== RESTJSONErrorCodes.MissingPermissions) console.warn(`[tickets] could not get a webhook in ${channel.id}:`, error);
    hooks.set(channel.id, { failedAt: Date.now() });
    return null;
  }
}

/** Forgets a channel's webhook, for a test or a channel that was deleted. */
export function forgetWebhook(channelId?: string): void {
  if (channelId === undefined) hooks.clear();
  else hooks.delete(channelId);
}

export interface SentReply {
  ticket: Ticket;
  message: Message;
  delivery: "webhook" | "bot";
}

/**
 * Posts a reply from the dashboard into the ticket and stores it as a
 * dashboard message. It can ping the people in the ticket and the type's staff
 * roles, and nobody else whatever the text says.
 */
export async function sendReply(
  ctx: TicketCtx,
  ticket: Ticket,
  content: string,
  actor: TicketActor,
  files: readonly TicketReplyFile[] = [],
): Promise<Outcome<SentReply>> {
  if (ticket.status !== "open") return refused("alreadyClosed");
  const channel = await channelOf(ctx, ticket.channelId);
  if (!channel) return refused("channelMissing");

  const type = typeOfTicket(ctx.settings, ticket)?.type;
  const people = [ticket.openerId, ...(ticket.claimedById ? [ticket.claimedById] : []), ...memberIdsIn(ctx, channel)];
  const allowedMentions = replyMentions(people, staffRolesOf(ctx.settings, type));

  // A fresh set for each attempt, so the bot can still post the files itself when the webhook fails.
  const attachments = () => files.map((file) => new AttachmentBuilder(Buffer.from(file.data, "base64"), { name: file.name }));
  const parent = isThread(channel) ? channel.parent : channel;
  const hook = parent?.type === ChannelType.GuildText ? await webhookFor(ctx, parent) : null;
  let message: Message | null = null;
  let delivery: "webhook" | "bot" = "webhook";
  /** Each message posted and the part of the reply it holds. */
  const posted: { message: Message; content: string }[] = [];
  if (hook) {
    message = await hook
      .send({
        content,
        ...(files.length > 0 ? { files: attachments() } : {}),
        username: actor.name.slice(0, 80) || "Staff",
        ...(actor.avatarUrl ? { avatarURL: actor.avatarUrl } : {}),
        allowedMentions,
        ...(isThread(channel) ? { threadId: channel.id } : {}),
      })
      .catch((error: unknown) => {
        if (errorCode(error) === RESTJSONErrorCodes.UnknownWebhook && parent) hooks.delete(parent.id);
        console.warn(`[tickets] webhook reply in ${channel.id} failed, sending as the bot:`, error);
        return null;
      });
  }
  if (message) {
    posted.push({ message, content });
  } else {
    delivery = "bot";
    const { head, parts } = attributedReply(actor.name, content);
    for (const [index, part] of parts.entries()) {
      const sent = await channel
        .send({ content: index === 0 ? head + part : part, allowedMentions, ...(index === 0 && files.length > 0 ? { files: attachments() } : {}) })
        .catch((error: unknown) => {
          console.error(`[tickets] could not post a dashboard reply in ${channel.id}:`, error);
          return null;
        });
      if (!sent) break;
      posted.push({ message: sent, content: part });
    }
    message = posted[0]?.message ?? null;
  }
  if (!message) return refused("channelMissing");

  const at = message.createdAt ?? new Date();
  if (ctx.settings.transcripts.store) {
    for (const part of posted) await storeReply(ticket, part.message, part.content, actor, part.message.createdAt ?? at, delivery === "webhook");
  }
  await noteActivity(ticket.id, ticket.openerId, { id: actor.userId, bot: false }, at);
  await resetAutoClose(ctx, ticket);
  return done({ ticket, message, delivery });
}

/** `viaWebhook`: Discord shows a webhook's message with an APP tag, so the transcript does too. */
async function storeReply(ticket: Ticket, message: Message, content: string, actor: TicketActor, at: Date, viaWebhook: boolean): Promise<void> {
  const messageId = message.id;
  // The files' addresses are Discord's, from the message as posted, like any other attachment in a ticket.
  const attachments = attachmentsJson(message.attachments?.values() ?? []);
  await prisma.ticketMessage.upsert({
    where: { ticketId_messageId: { ticketId: ticket.id, messageId } },
    create: {
      ticketId: ticket.id,
      messageId,
      authorId: actor.userId,
      authorName: actor.name,
      authorAvatar: actor.avatarUrl,
      authorIsStaff: true,
      authorBot: viaWebhook,
      content,
      attachments,
      embeds: "[]",
      createdAt: at,
      source: "dashboard",
    },
    update: { source: "dashboard", authorId: actor.userId, authorName: actor.name, authorAvatar: actor.avatarUrl, authorIsStaff: true, authorBot: viaWebhook, attachments },
  });
}
