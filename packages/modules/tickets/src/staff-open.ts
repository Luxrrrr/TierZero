import { randomUUID } from "node:crypto";
import { ChannelType } from "discord.js";
import {
  applyVariablesToMessage,
} from "@tier0/core";
import {
  TICKET_CREATE_MEMBERS_MAX,
  TICKET_FORM_QUESTIONS_MAX,
  type TicketActor,
  type TicketAnswer,
  type TicketCreateRequest,
  type TicketCreateResult,
} from "@tier0/shared-tickets";
import { prisma, type Ticket } from "@tier0/db";
import { rememberOpenTicket } from "./cache.js";
import { notifyTicket } from "./live.js";
import { storeMessage } from "./capture.js";
import { addMember, categoryFor, topicFor } from "./channels.js";
import type { TicketChannel, TicketCtx } from "./context.js";
import { recordEvent, ticketRows } from "./controls.js";
import { ticketChannelName } from "./naming.js";
import { OPENED_MESSAGE } from "./messages.js";
import { resetAutoClose } from "./notice.js";
import { createChannel } from "./open.js";
import { TicketActionError } from "./outcome.js";
import { atLeastAMinute, ticketNumber } from "./records.js";
import { effectiveChannelName, findType, pingRolesOf, subjectOf, type PanelType } from "./resolve.js";
import { sendReply } from "./webhooks.js";
import { welcomeBody, welcomeFallback, welcomeValuesOf } from "./welcome.js";

/**
 * Staff opening a ticket from the dashboard to talk to someone. It runs the
 * same opening as a member's: the row, the channel or thread, the first
 * message, the event. What a member has to pass (the blocklist, the roles that
 * may open the type, the limit, the wait between tickets, working hours) does
 * not apply to staff, and the form is optional. The category still has to
 * exist and have room, since without it there is nowhere to put the channel.
 */

export type StaffTicketRequest = Partial<Omit<TicketCreateRequest, "typeId" | "memberIds">> & Pick<TicketCreateRequest, "typeId" | "memberIds">;

const invalid = (text: string) => new TicketActionError(text, "invalid");

const CATEGORY_TEXT = {
  noCategory: "This ticket type has no category set. Choose one in the ticket settings first.",
  categoryGone: "This ticket type's category was deleted. Choose another in the ticket settings first.",
  categoryFull: "This ticket type's category is full. Close some tickets or set an overflow category in the ticket settings.",
} as const;

/** The default first message with the opener left out of its text, since the opener here is the staff member. */
const STAFF_OPENED_CONTENT = "{members} {pingRoles}";

const CREATE_FAILED =
  "The bot could not create the ticket. Check that it can manage channels and roles in the ticket category, or manage threads in the panel's channel for a thread ticket, and that the category has room.";

async function memberIn(ctx: TicketCtx, userId: string) {
  return ctx.guild.members.cache.get(userId) ?? (await ctx.guild.members.fetch(userId).catch(() => null));
}

/** The people to add: in the server, not bots, and not the staff member opening the ticket. */
async function peopleToAdd(ctx: TicketCtx, memberIds: readonly string[], creatorId: string): Promise<{ id: string; name: string }[]> {
  const ids = [...new Set(memberIds)].filter((id) => id !== creatorId);
  if (ids.length === 0) throw invalid("Pick at least one member besides yourself to add to the ticket.");
  if (ids.length > TICKET_CREATE_MEMBERS_MAX) throw invalid(`A ticket can start with at most ${TICKET_CREATE_MEMBERS_MAX} members besides you.`);
  const people: { id: string; name: string }[] = [];
  for (const id of ids) {
    const member = await memberIn(ctx, id);
    if (!member) throw invalid("One of the members isn't in this server, so they can't be added to the ticket. Search for them again.");
    if (member.user.bot) throw invalid(`${member.displayName} is a bot, and a bot can't be added to a ticket.`);
    people.push({ id, name: member.displayName });
  }
  return people;
}

/** What the form answers in the request come to: the ones filled in, cut to the form's size. */
function answersOf(given: readonly TicketAnswer[] | undefined): TicketAnswer[] {
  return (given ?? [])
    .map((answer) => ({ label: answer.label.trim(), value: answer.value.trim() }))
    .filter((answer) => answer.label !== "" && answer.value !== "")
    .slice(0, TICKET_FORM_QUESTIONS_MAX);
}

/**
 * Takes the next number in the server and the row in one statement, so two
 * tickets opening together cannot get the same one. The channel id is a
 * placeholder until the channel exists. There is no limit or wait to check.
 */
async function insertRow(
  ctx: TicketCtx,
  { panel, type }: PanelType,
  opener: { id: string; username: string },
  fields: { subject: string | null; answers: TicketAnswer[] },
): Promise<Ticket | null> {
  const placeholder = `pending-${randomUUID()}`;
  const now = Date.now();
  await prisma.$executeRaw`
    INSERT INTO "Ticket" ("guildId", "number", "channelId", "openerId", "subject", "status", "openedAt", "typeId", "panelId", "typeName", "answers",
      "priority", "lastActivityAt", "mode", "archived", "channelName", "openerName", "messageCount", "reopenedCount")
    SELECT ${ctx.guild.id}, (SELECT COALESCE(MAX("number"), 0) + 1 FROM "Ticket" WHERE "guildId" = ${ctx.guild.id}), ${placeholder}, ${opener.id},
      ${fields.subject}, 'open', ${now}, ${type.id}, ${panel.id}, ${type.name},
      ${JSON.stringify(fields.answers)}, 'normal', ${now}, ${type.opening.mode}, 0, '', ${opener.username}, 0, 0`;
  return prisma.ticket.findUnique({ where: { channelId: placeholder } });
}

/** The text a message body comes to once its variables are filled in, to see who it mentions. */
function textOf(body: ReturnType<typeof applyVariablesToMessage>): string {
  const embeds = body.embeds.flatMap((embed) => [embed.title, embed.description, ...embed.fields.flatMap((field) => [field.name, field.value])]);
  return [body.content, ...embeds].join("\n");
}

/**
 * Opens a ticket as a member of staff and puts the picked members in it. The
 * staff member is the opener on the record; the members get access the way
 * the add-member action gives it. Throws a `TicketActionError` with a
 * dashboard sentence when it cannot, and leaves nothing half-made behind.
 */
export async function openTicketAs(ctx: TicketCtx, request: StaffTicketRequest, actor: TicketActor): Promise<TicketCreateResult> {
  const target = findType(ctx.settings, null, request.typeId);
  if (!target) throw invalid("That ticket type no longer exists. Reload the page and pick another.");
  const { type } = target;

  const people = await peopleToAdd(ctx, request.memberIds, actor.userId);
  if (type.opening.mode === "thread") {
    const parent = target.panel.channel ? ctx.guild.channels.cache.get(target.panel.channel) : undefined;
    if (parent?.type !== ChannelType.GuildText) {
      throw new TicketActionError("This ticket type opens a thread in its panel's channel, and that channel is missing. Choose one in the panel's settings first.", "unavailable");
    }
  } else {
    const category = categoryFor(ctx, type);
    if (!category.ok) throw new TicketActionError(CATEGORY_TEXT[category.code], "unavailable");
  }

  const answers = answersOf(request.answers);
  const subject = request.subject?.trim() ? request.subject.trim().slice(0, 200) : subjectOf(answers);
  const creator = await memberIn(ctx, actor.userId);
  const username = creator?.user.username ?? actor.name;
  const claimed = await insertRow(ctx, target, { id: actor.userId, username }, { subject, answers });
  if (!claimed) throw new TicketActionError(CREATE_FAILED, "unavailable");

  const channelName = ticketChannelName(username, effectiveChannelName(ctx.settings, type), { type: type.name, number: ticketNumber(claimed) });
  let channel: TicketChannel | null;
  try {
    channel = await createChannel(ctx, target, { user: { id: actor.userId } }, channelName, topicFor(ctx, claimed, username));
  } catch (error) {
    console.error("[tickets] failed to create a ticket channel for staff:", error);
    channel = null;
  }
  const ticket = channel
    ? await prisma.ticket.update({ where: { id: claimed.id }, data: { channelId: channel.id, channelName } }).catch((error: unknown) => {
        console.error("[tickets] failed to record the new ticket channel:", error);
        return null;
      })
    : null;
  if (!channel || !ticket) {
    await prisma.ticket.delete({ where: { id: claimed.id } }).catch(() => undefined);
    if (channel) await channel.delete().catch(() => undefined);
    throw new TicketActionError(CREATE_FAILED, "unavailable");
  }
  rememberOpenTicket(ctx.guild.id, channel.id, { id: ticket.id, openerId: ticket.openerId, typeId: ticket.typeId, panelId: ticket.panelId });
  notifyTicket(ctx.guild.id, ticket.id, "opened");

  const notes: string[] = [];
  const added: { id: string; name: string }[] = [];
  for (const person of people) {
    if (await addMember(channel, person.id)) added.push(person);
    else notes.push(`${person.name} could not be added to the channel. Check that the bot can manage it, then add them from the ticket.`);
  }
  const addedIds = added.map((person) => person.id);

  // The staff member is the opener on the record but is never mentioned: they know they opened it,
  // so the message names them as text. The handlers are only pinged when staff asked for it, apart from
  // a thread, which only lets in the roles its first message mentions.
  const pinged = request.notifyHandlers === true || type.opening.mode === "thread" ? [...new Set([...type.handlers, ...pingRolesOf(type)])] : [];
  const values = {
    ...welcomeValuesOf(ctx.settings, type, ticket, addedIds),
    user: creator?.displayName ?? actor.name,
    pingRoles: pinged.map((id) => `<@&${id}>`).join(" "),
  };
  const welcomeType = type.welcome.content === OPENED_MESSAGE.content ? { ...type, welcome: { ...type.welcome, content: STAFF_OPENED_CONTENT } } : type;
  const body = welcomeBody(welcomeType, ticket, values);
  const welcome = await ctx.send(channel, body, values, {
    fallback: welcomeFallback(welcomeType, ticket, values),
    rows: ticketRows(ctx.settings, ticket, type),
    mentions: { users: addedIds, roles: pinged },
  });
  if (welcome) {
    await prisma.ticket.update({ where: { id: ticket.id }, data: { controlsMessageId: welcome.id } });
    await storeMessage(ctx, ticket, welcome);
  }
  // An owner's first message that leaves out {members} would add people without telling them.
  const shown = textOf(applyVariablesToMessage(body, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]))));
  const unmentioned = addedIds.filter((id) => !shown.includes(`<@${id}>`));
  const unnotified = pinged.filter((id) => !shown.includes(`<@&${id}>`));
  if (unmentioned.length > 0 || unnotified.length > 0) {
    const extra = await channel
      .send({
        content: [...unmentioned.map((id) => `<@${id}>`), ...unnotified.map((id) => `<@&${id}>`)].join(" "),
        allowedMentions: { users: unmentioned, roles: unnotified },
      })
      .catch(() => null);
    if (extra) await storeMessage(ctx, ticket, extra);
  }

  await recordEvent(ticket.id, "opened", actor, { typeName: type.name, staff: true });
  for (const person of added) await recordEvent(ticket.id, "member_added", actor, { userId: person.id, name: person.name });
  await resetAutoClose(ctx, ticket);
  const reminder = ctx.settings.automation.reminder;
  if (reminder.enabled) await ctx.tasks.schedule("reminder", new Date(Date.now() + atLeastAMinute(reminder.after)), { ticketId: ticket.id });

  if (request.firstMessage) {
    const sent = await sendReply(ctx, ticket, request.firstMessage, actor).catch((error: unknown) => {
      console.error("[tickets] failed to post the first message of a staff ticket:", error);
      return null;
    });
    if (!sent?.ok) notes.push("The ticket is open, but your first message could not be posted. Send it from the ticket.");
  }

  return {
    id: ticket.id,
    number: ticketNumber(ticket),
    channelId: channel.id,
    channelUrl: `https://discord.com/channels/${ctx.guild.id}/${channel.id}`,
    notes,
  };
}
