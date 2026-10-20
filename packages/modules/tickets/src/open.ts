import { randomUUID } from "node:crypto";
import { ChannelType, ThreadAutoArchiveDuration, type MessageComponentInteraction, type ModalSubmitInteraction, type PrivateThreadChannel } from "discord.js";
import type { MessageBody } from "@tier0/core";
import { LEGACY_TYPE_ID, type TicketAnswer } from "@tier0/shared-tickets";
import { prisma, type Ticket } from "@tier0/db";
import { rememberOpenTicket } from "./cache.js";
import { notifyTicket } from "./live.js";
import { storeMessage } from "./capture.js";
import { addMissingThreadStaff, addThreadStaff, categoryFor, overwriteSteps, topicFor } from "./channels.js";
import { actorOf, isThread, memberRoleIds, refuse, type DiscordPerson, type TicketChannel, type TicketCtx } from "./context.js";
import { recordEvent, ticketRows } from "./controls.js";
import { nextOpening, withinHours } from "./hours.js";
import { CREATED_MESSAGE, OUTSIDE_HOURS_MESSAGE } from "./messages.js";
import { ticketChannelName } from "./naming.js";
import { resetAutoClose } from "./notice.js";
import { done, refused, type Outcome } from "./outcome.js";
import { atLeastAMinute, relativeTime, ticketNumber } from "./records.js";
import { cooldownUntil, effectiveChannelName, effectiveLimit, mayOpen, pingRolesOf, subjectOf, type PanelType } from "./resolve.js";
import { welcomeBody, welcomeFallback, welcomeValuesOf } from "./welcome.js";

/**
 * Opening a ticket: the checks a member must pass, run once when they pick a
 * type and again when they send its form, then the channel or thread, the row
 * and the first message.
 */

/** A ticket with no type was opened before types existed and belongs to the one the upgrade created. */
const typeIdsOf = (typeId: string) => (typeId === LEGACY_TYPE_ID ? [{ typeId }, { typeId: null }] : [{ typeId }]);

/** Everything that can stop this member opening this type, in the order a member should hear about it. */
export async function checkOpen(ctx: TicketCtx, person: DiscordPerson, { panel, type }: PanelType): Promise<Outcome<null>> {
  const allowed = mayOpen(ctx.settings, type, { id: person.user.id, roleIds: memberRoleIds(person.member) });
  if (!allowed.allowed) return refused(allowed.code, { type: type.name });

  const limit = effectiveLimit(ctx.settings, type);
  const openCount = await prisma.ticket.count({
    where: { guildId: ctx.guild.id, openerId: person.user.id, status: "open", OR: typeIdsOf(type.id) },
  });
  if (openCount >= limit) return refused(limit === 1 ? "limitOne" : "limitMany", { openCount, limit });

  const cooldown = await prisma.ticketCooldown.findUnique({
    where: { guildId_userId_typeId: { guildId: ctx.guild.id, userId: person.user.id, typeId: type.id } },
  });
  if (cooldown && cooldown.until.getTime() > Date.now()) return refused("cooldown", { type: type.name, available: relativeTime(cooldown.until) });

  if (type.opening.mode === "thread") {
    const parent = panel.channel ? ctx.guild.channels.cache.get(panel.channel) : undefined;
    if (parent?.type !== ChannelType.GuildText) return refused("createFailed");
    return done(null);
  }
  const category = categoryFor(ctx, type);
  if (!category.ok) return refused(category.code);
  return done(null);
}

/**
 * One open at a time per member in a server. A double click, or a form sent
 * twice, waits for the first to finish and then hears that the limit is
 * reached, instead of both passing the checks before either row exists.
 */
const opening = new Map<string, Promise<unknown>>();

export async function oneAtATime<T>(key: string, run: () => Promise<T>): Promise<T> {
  const before = opening.get(key) ?? Promise.resolve();
  const turn = before.then(run, run);
  const settled = turn.catch(() => undefined);
  opening.set(key, settled);
  try {
    return await turn;
  } finally {
    if (opening.get(key) === settled) opening.delete(key);
  }
}

/**
 * Takes the member's slot for this type in one statement: the row goes in
 * only while they are under the limit and out of the cooldown. The channel id
 * is a placeholder until the channel exists. Resolves to null when the slot
 * was taken in the meantime.
 */
async function claimSlot(
  ctx: TicketCtx,
  { panel, type }: PanelType,
  opener: { id: string; username: string },
  fields: { subject: string | null; answers: TicketAnswer[] },
): Promise<Ticket | null> {
  const placeholder = `pending-${randomUUID()}`;
  const now = Date.now();
  const legacy = type.id === LEGACY_TYPE_ID ? 1 : 0;
  // The number is taken in the same statement, so two tickets opening together in one server cannot get the same one.
  const inserted = await prisma.$executeRaw`
    INSERT INTO "Ticket" ("guildId", "number", "channelId", "openerId", "subject", "status", "openedAt", "typeId", "panelId", "typeName", "answers",
      "priority", "lastActivityAt", "mode", "archived", "channelName", "openerName", "messageCount", "reopenedCount")
    SELECT ${ctx.guild.id}, (SELECT COALESCE(MAX("number"), 0) + 1 FROM "Ticket" WHERE "guildId" = ${ctx.guild.id}), ${placeholder}, ${opener.id},
      ${fields.subject}, 'open', ${now}, ${type.id}, ${panel.id}, ${type.name},
      ${JSON.stringify(fields.answers)}, 'normal', ${now}, ${type.opening.mode}, 0, '', ${opener.username}, 0, 0
    WHERE (SELECT COUNT(*) FROM "Ticket" WHERE "guildId" = ${ctx.guild.id} AND "openerId" = ${opener.id} AND "status" = 'open'
        AND ("typeId" = ${type.id} OR (${legacy} = 1 AND "typeId" IS NULL))) < ${effectiveLimit(ctx.settings, type)}
      AND NOT EXISTS (SELECT 1 FROM "TicketCooldown" WHERE "guildId" = ${ctx.guild.id} AND "userId" = ${opener.id}
        AND "typeId" = ${type.id} AND "until" > ${now})`;
  if (inserted === 0) return null;
  return prisma.ticket.findUnique({ where: { channelId: placeholder } });
}

type Opener = (MessageComponentInteraction | ModalSubmitInteraction) & DiscordPerson;

/**
 * `staffLater` leaves the handlers out of a new thread for the caller to bring in
 * once the first message, which mentions their roles, is posted. See addMissingThreadStaff.
 */
export async function createChannel(
  ctx: TicketCtx,
  { panel, type }: PanelType,
  opener: { user: { id: string } },
  name: string,
  topic: string,
  options: { staffLater?: boolean } = {},
): Promise<TicketChannel | null> {
  if (type.opening.mode === "thread") {
    const parent = panel.channel ? ctx.guild.channels.cache.get(panel.channel) : undefined;
    if (parent?.type !== ChannelType.GuildText) return null;
    const thread = (await parent.threads.create({
      name,
      type: ChannelType.PrivateThread,
      invitable: false,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    })) as PrivateThreadChannel;
    await thread.members.add(opener.user.id);
    if (!options.staffLater) await addThreadStaff(ctx, thread, type);
    return thread;
  }
  const category = categoryFor(ctx, type);
  if (!category.ok) return null;
  const steps = overwriteSteps(ctx, type, opener.user.id);
  for (const [index, permissionOverwrites] of steps.entries()) {
    try {
      const channel = await ctx.guild.channels.create({ name, type: ChannelType.GuildText, parent: category.id, permissionOverwrites, topic });
      if (index > 0) {
        console.warn(
          `[tickets] guild ${ctx.guild.id}: Discord refused the full permissions for a ticket channel, so it was created with fewer. Give the bot's role Manage Roles, Manage Channels and Manage Messages, and check the category's own permissions.`,
        );
      }
      return channel;
    } catch (error) {
      const refused = typeof error === "object" && error !== null && (error as { code?: unknown }).code === 50013;
      if (!refused || index === steps.length - 1) throw error;
    }
  }
  return null;
}

/**
 * Opens a ticket whose form, if any, has been answered. The interaction is
 * already deferred. The checks run again here, one open at a time per member,
 * and the row claims the slot before the channel is made, so the limit and
 * the cooldown hold however fast someone clicks.
 */
export async function openTicket(ctx: TicketCtx, interaction: Opener, target: PanelType, answers: TicketAnswer[]): Promise<void> {
  await oneAtATime(`${ctx.guild.id}:${interaction.user.id}`, () => openNow(ctx, interaction, target, answers));
}

async function openNow(ctx: TicketCtx, interaction: Opener, target: PanelType, answers: TicketAnswer[]): Promise<void> {
  const { type } = target;
  const check = await checkOpen(ctx, interaction, target);
  if (!check.ok) return refuse(ctx, interaction, check.refusal.key, check.refusal.values);

  const subject = subjectOf(answers);
  const username = interaction.user.username;
  const claimed = await claimSlot(ctx, target, { id: interaction.user.id, username }, { subject, answers });
  if (!claimed) {
    const again = await checkOpen(ctx, interaction, target);
    if (!again.ok) return refuse(ctx, interaction, again.refusal.key, again.refusal.values);
    return refuse(ctx, interaction, "limitOne", { openCount: 1, limit: effectiveLimit(ctx.settings, type) });
  }

  const until = cooldownUntil(type, claimed.openedAt);
  if (until) {
    await prisma.ticketCooldown.upsert({
      where: { guildId_userId_typeId: { guildId: ctx.guild.id, userId: claimed.openerId, typeId: type.id } },
      create: { guildId: ctx.guild.id, userId: claimed.openerId, typeId: type.id, until },
      update: { until },
    });
  }

  const channelName = ticketChannelName(username, effectiveChannelName(ctx.settings, type), { type: type.name, number: ticketNumber(claimed) });
  let channel: TicketChannel | null;
  try {
    channel = await createChannel(ctx, target, interaction, channelName, topicFor(ctx, claimed, interaction.user.tag), { staffLater: true });
  } catch (error) {
    console.error("[tickets] failed to create ticket channel:", error);
    channel = null;
  }
  const ticket = channel
    ? await prisma.ticket.update({ where: { id: claimed.id }, data: { channelId: channel.id, channelName } }).catch((error: unknown) => {
        console.error("[tickets] failed to record the new ticket channel:", error);
        return null;
      })
    : null;
  if (!channel || !ticket) {
    // Nothing half-made is left behind: the slot and the cooldown go back, and so does a channel the row could not take.
    await prisma.ticket.delete({ where: { id: claimed.id } }).catch(() => undefined);
    if (until) await prisma.ticketCooldown.deleteMany({ where: { guildId: ctx.guild.id, userId: claimed.openerId, typeId: type.id } });
    if (channel) await channel.delete().catch(() => undefined);
    // The category was checked just before, so a missing one is only reported when it went in the meantime.
    const category = type.opening.mode === "channel" ? categoryFor(ctx, type) : null;
    return refuse(ctx, interaction, category && !category.ok ? category.code : "createFailed");
  }
  rememberOpenTicket(ctx.guild.id, channel.id, { id: ticket.id, openerId: ticket.openerId, typeId: ticket.typeId, panelId: ticket.panelId });
  notifyTicket(ctx.guild.id, ticket.id, "opened");

  // A private thread only lets in the roles its first message mentions, so the handlers are always pinged there.
  const pings = type.opening.mode === "thread" ? [...new Set([...pingRolesOf(type), ...type.handlers])] : pingRolesOf(type);
  const values = welcomeValuesOf(ctx.settings, type, ticket);
  const thread = type.opening.mode === "thread";
  const welcome = await ctx.send(channel, withoutOpenerLine(welcomeBody(type, ticket, values), thread), values, {
    fallback: withoutOpenerLine(welcomeFallback(type, ticket, values), thread),
    rows: ticketRows(ctx.settings, ticket, type),
    // Adding the opener to a thread already notified them, so mentioning them as well would be a second ping.
    mentions: { users: type.opening.mode === "thread" ? [] : [interaction.user.id], roles: pings },
  });
  if (welcome) {
    await prisma.ticket.update({ where: { id: ticket.id }, data: { controlsMessageId: welcome.id } });
    await storeMessage(ctx, ticket, welcome);
  }
  await outsideHoursNotice(ctx, channel, ticket);

  // The first message mentions the handlers, which lets their roles into a thread. Whoever it did not reach is added after a moment.
  if (isThread(channel)) {
    void addMissingThreadStaff(ctx, channel, type).catch((error: unknown) => console.warn(`[tickets] could not add the staff to ${channel.id}:`, error));
  }

  await recordEvent(ticket.id, "opened", actorOf(interaction.user, interaction.member), { typeName: type.name });
  await resetAutoClose(ctx, ticket);
  const reminder = ctx.settings.automation.reminder;
  if (reminder.enabled) await ctx.tasks.schedule("reminder", new Date(Date.now() + atLeastAMinute(reminder.after)), { ticketId: ticket.id });

  await ctx.reply(
    interaction,
    ctx.settings.messages.created,
    { ticket: `<#${channel.id}>`, number: ticketNumber(ticket), subject: subject ?? "" },
    { fallback: CREATED_MESSAGE },
  );
}

/**
 * The opener is added to a thread, which tells them, so the line above the first message that names them only
 * reads like a second ping. Taken out of the text of the message, and left in the embed, which never notifies.
 */
function withoutOpenerLine(body: MessageBody, thread: boolean): MessageBody {
  return thread ? { ...body, content: body.content.replace(/\{user\}\s*/g, "").trim() } : body;
}

/** Tells the opener when the team is back, for a ticket opened outside working hours. */
async function outsideHoursNotice(ctx: TicketCtx, channel: TicketChannel, ticket: Ticket): Promise<void> {
  const hours = ctx.settings.automation.hours;
  const now = new Date();
  if (withinHours(hours, now)) return;
  const opens = nextOpening(hours, now);
  const sent = await ctx.send(
    channel,
    hours.message,
    {
      user: `<@${ticket.openerId}>`,
      opens: opens ? relativeTime(opens) : "",
      opensAt: opens ? `<t:${Math.floor(opens.getTime() / 1000)}:F>` : "",
      number: ticketNumber(ticket),
      type: ticket.typeName,
    },
    { fallback: OUTSIDE_HOURS_MESSAGE, mentions: { users: [], roles: [] } },
  );
  if (sent) await storeMessage(ctx, ticket, sent);
}
