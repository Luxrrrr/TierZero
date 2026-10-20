import { AttachmentBuilder, ChannelType, RESTJSONErrorCodes, type Message, type TextChannel, type Webhook } from "discord.js";
import { type MessageEmbed } from "@tier0/core";
import { ticketReplyQuoteLine, type TicketActor, type TicketReplyFile } from "@tier0/shared-tickets";
import { prisma, type Ticket } from "@tier0/db";
import { noteActivity } from "./capture.js";
import { memberIdsIn } from "./channels.js";
import { channelOf, isThread, type TicketCtx } from "./context.js";
import { notifyTicket } from "./live.js";
import { resetAutoClose } from "./notice.js";
import { done, refused, type Outcome } from "./outcome.js";
import { attachmentsJson, attributedReply, replyEmbedPayloads, replyEmbedsJson, replyIdentity, replyMentions, splitReply } from "./records.js";
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

/** The message a reply answers, as the quote above it needs it. */
export interface ReplyReference {
  messageId: string;
  /** Who wrote it, as the conversation shows them. */
  name: string;
  /** What it says, already cut to one plain line. */
  snippet: string;
  link: string;
}

export interface SentReply {
  ticket: Ticket;
  message: Message;
  delivery: "webhook" | "bot";
}

/**
 * Posts a reply from the dashboard into the ticket and stores it as a
 * dashboard message. It can ping the people in the ticket and the type's staff
 * roles, and nobody else whatever the text says. Sent as the staff member, or
 * under the team's name when the settings say so; either way the stored row
 * keeps who really sent it.
 */
export async function sendReply(
  ctx: TicketCtx,
  ticket: Ticket,
  content: string,
  actor: TicketActor,
  files: readonly TicketReplyFile[] = [],
  embeds: readonly MessageEmbed[] = [],
  replyTo?: ReplyReference,
): Promise<Outcome<SentReply>> {
  if (ticket.status !== "open") return refused("alreadyClosed");
  const channel = await channelOf(ctx, ticket.channelId);
  if (!channel) return refused("channelMissing");

  const type = typeOfTicket(ctx.settings, ticket)?.type;
  const people = [ticket.openerId, ...(ticket.claimedById ? [ticket.claimedById] : []), ...memberIdsIn(ctx, channel)];
  // The line naming the sender may mention them, which must never ping them, so they are left out of the allowed users.
  const allowedMentions = replyMentions(people.filter((id) => id !== actor.userId), staffRolesOf(ctx.settings, type));
  const who = replyIdentity(ctx.settings.general?.replies, actor, ctx.client.user?.displayAvatarURL?.() ?? null);
  const now = new Date();
  const embedPayloads = replyEmbedPayloads(embeds, now);

  // A fresh set for each attempt, so the bot can still post the files itself when the webhook fails.
  const attachments = () => files.map((file) => new AttachmentBuilder(Buffer.from(file.data, "base64"), { name: file.name }));
  const parent = isThread(channel) ? channel.parent : channel;
  const hook = parent?.type === ChannelType.GuildText ? await webhookFor(ctx, parent) : null;
  let delivery: "webhook" | "bot" = "webhook";
  /** Each message posted and the part of the reply it holds, with the files and embeds on the first. */
  const posted: { message: Message; content: string }[] = [];
  if (hook) {
    // A webhook cannot make a real reply, so the first message opens with a small quote that links the one answered.
    const quote = replyTo ? ticketReplyQuoteLine(replyTo.name, replyTo.snippet, replyTo.link) : null;
    const room = quote === null ? REPLY_ROOM : REPLY_ROOM - quote.length - 1;
    for (const [index, part] of splitReply(content, room, who.staffLine).entries()) {
      const sent = await hook
        .send({
          content: index === 0 && quote !== null ? (part === "" ? quote : `${quote}\n${part}`) : part,
          ...(index === 0 && files.length > 0 ? { files: attachments() } : {}),
          ...(index === 0 && embedPayloads.length > 0 ? { embeds: embedPayloads } : {}),
          username: who.name,
          ...(who.avatarUrl ? { avatarURL: who.avatarUrl } : {}),
          allowedMentions,
          ...(isThread(channel) ? { threadId: channel.id } : {}),
        })
        .catch((error: unknown) => {
          if (errorCode(error) === RESTJSONErrorCodes.UnknownWebhook && parent) hooks.delete(parent.id);
          console.warn(`[tickets] webhook reply in ${channel.id} failed, sending as the bot:`, error);
          return null;
        });
      if (!sent) break;
      posted.push({ message: sent, content: part });
    }
  }
  if (posted.length === 0) {
    delivery = "bot";
    const { head, parts } = attributedReply(who.name, content, REPLY_ROOM, who.staffLine);
    for (const [index, part] of parts.entries()) {
      const sent = await channel
        .send({
          content: index === 0 ? head + part : part,
          allowedMentions: index === 0 && replyTo ? { ...allowedMentions, repliedUser: false } : allowedMentions,
          // The bot can make a real reply, which reads better than a quote and pings no one.
          ...(index === 0 && replyTo ? { reply: { messageReference: replyTo.messageId, failIfNotExists: false } } : {}),
          ...(index === 0 && files.length > 0 ? { files: attachments() } : {}),
          ...(index === 0 && embedPayloads.length > 0 ? { embeds: embedPayloads } : {}),
        })
        .catch((error: unknown) => {
          console.error(`[tickets] could not post a dashboard reply in ${channel.id}:`, error);
          return null;
        });
      if (!sent) break;
      posted.push({ message: sent, content: part });
    }
  }
  const message = posted[0]?.message;
  if (!message) return refused("channelMissing");

  const at = message.createdAt ?? new Date();
  if (ctx.settings.transcripts.store) {
    for (const [index, part] of posted.entries()) {
      const tail = who.staffLine !== null && endsWithLine(part.content, who.staffLine);
      await storeReply(ticket, part.message, {
        // The closing line is what Discord showed; the row keeps the text and says it was there.
        content: tail ? part.content.slice(0, part.content.length - who.staffLine!.length).replace(/\n$/, "") : part.content,
        actor,
        at: part.message.createdAt ?? at,
        // A webhook's message and the bot's own both carry Discord's APP tag.
        bot: true,
        sentAs: who.team ? JSON.stringify({ name: who.name, avatarUrl: who.avatarUrl, staffLine: tail, ...(tail ? { line: who.staffLine!.replace(/<@d+>/g, `@${actor.name}`) } : {}) }) : null,
        embeds: index === 0 && embeds.length > 0 ? replyEmbedsJson(embeds, now) : "[]",
        replyToId: index === 0 && replyTo ? replyTo.messageId : null,
      });
    }
  }
  await noteActivity(ticket.id, ticket.openerId, { id: actor.userId, bot: false }, at);
  await resetAutoClose(ctx, ticket);
  return done({ ticket, message, delivery });
}

/** The most one message of a reply holds. */
const REPLY_ROOM = 2000;

const endsWithLine = (content: string, line: string) => content === line || content.endsWith(`\n${line}`);

interface StoredReply {
  content: string;
  actor: TicketActor;
  at: Date;
  bot: boolean;
  /** JSON of what Discord showed as the sender, or null for the staff member themselves. */
  sentAs: string | null;
  embeds: string;
  /** The message this one answers, kept so the conversation and transcripts draw the quote as for a native reply. */
  replyToId: string | null;
}

async function storeReply(ticket: Ticket, message: Message, reply: StoredReply): Promise<void> {
  const messageId = message.id;
  // The files' addresses are Discord's, from the message as posted, like any other attachment in a ticket.
  const attachments = attachmentsJson(message.attachments?.values() ?? []);
  const { actor } = reply;
  const author = { authorId: actor.userId, authorName: actor.name, authorAvatar: actor.avatarUrl, authorIsStaff: true, authorBot: reply.bot };
  await prisma.ticketMessage.upsert({
    where: { ticketId_messageId: { ticketId: ticket.id, messageId } },
    create: {
      ticketId: ticket.id,
      messageId,
      ...author,
      content: reply.content,
      attachments,
      embeds: reply.embeds,
      sentAs: reply.sentAs,
      replyToId: reply.replyToId,
      createdAt: reply.at,
      source: "dashboard",
    },
    // The gateway may have stored the message first, as the webhook or the bot; this puts the real sender on it.
    update: { source: "dashboard", ...author, content: reply.content, attachments, embeds: reply.embeds, sentAs: reply.sentAs, replyToId: reply.replyToId },
  });
  notifyTicket(ticket.guildId, ticket.id, "message");
}
