import { applyVariables, type MessageBody, type ReplyValues } from "@tier0/core";
import { readTicketAnswers, type TicketAnswer } from "@tier0/shared-tickets";
import type { Ticket } from "@tier0/db";
import { priorityLabel } from "./labels.js";
import { OPENED_MESSAGE, welcomeValues } from "./messages.js";
import type { TicketType } from "./panels.js";
import { pingRolesOf } from "./resolve.js";
import type { TicketSettings } from "./settings.js";

/**
 * The first message in a ticket, which is posted when it opens and filled in
 * again when it is claimed or moved, so `{claimedBy}` and `{type}` stay true.
 * Free of discord.js so it can be tested on its own.
 */

/** Discord's cap on the text of all the embeds in one message together. */
const EMBEDS_TOTAL = 6000;
const FIELD_VALUE_MAX = 1024;
const FIELD_NAME_MAX = 256;
const FIELDS_MAX = 25;
/** The shortest piece of an answer worth showing once the rest is cut. */
const ANSWER_MIN = 40;

const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`);

/** The text Discord counts against the 6000 characters of a message's embeds, with the variables filled in. */
function embedsLength(body: MessageBody, values: Record<string, string>): number {
  const fill = (text: string) => applyVariables(text, values).length;
  return body.embeds.reduce(
    (sum, embed) =>
      sum +
      fill(embed.title) +
      fill(embed.description) +
      fill(embed.authorName) +
      fill(embed.footerText) +
      embed.fields.reduce((total, field) => total + fill(field.name) + fill(field.value), 0),
    0,
  );
}

const asStrings = (values: ReplyValues): Record<string, string> =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));

/**
 * The first message with each answer as a field of its first embed, when the
 * type asks for that. The answers are cut to what is left of Discord's limits
 * once the owner's own text is filled in, so long answers shorten rather than
 * pushing the whole message over the limit, which would replace it with the
 * default one.
 */
export function withAnswers(body: MessageBody, answers: readonly TicketAnswer[], show: boolean, values: ReplyValues = {}): MessageBody {
  const [first, ...others] = body.embeds;
  const given = answers.filter((answer) => answer.value !== "");
  if (!show || !first || given.length === 0) return body;
  const room = Math.min(FIELDS_MAX - first.fields.length, given.length);
  if (room <= 0) return body;
  let budget = EMBEDS_TOTAL - embedsLength(body, asStrings(values));
  const fields = [];
  for (const [index, answer] of given.slice(0, room).entries()) {
    const name = cut(answer.label, FIELD_NAME_MAX);
    const left = given.slice(index, room).length;
    // Each answer gets an even share of what is left, so one long answer cannot crowd out the rest.
    const share = Math.floor((budget - name.length) / left);
    if (share < Math.min(ANSWER_MIN, answer.value.length)) break;
    const value = cut(answer.value, Math.min(FIELD_VALUE_MAX, share));
    budget -= name.length + value.length;
    fields.push({ name, value, inline: false });
  }
  if (fields.length === 0) return body;
  return { ...body, embeds: [{ ...first, fields: [...first.fields, ...fields] }, ...others] };
}

type WelcomeTicket = Pick<Ticket, "id" | "subject" | "openerId" | "openerName" | "channelId" | "priority" | "answers" | "claimedById" | "typeName"> & {
  number?: number | null;
};

/** The type's first message, with the answers fitted in. */
export function welcomeBody(type: TicketType, ticket: Pick<Ticket, "answers">, values: ReplyValues = {}): MessageBody {
  return withAnswers(type.welcome, readTicketAnswers(ticket.answers), type.showAnswers, values);
}

/** What is posted when the owner's first message no longer fits: the starting one, with the answers still under it. */
export function welcomeFallback(type: TicketType, ticket: Pick<Ticket, "answers">, values: ReplyValues = {}): MessageBody {
  return withAnswers(OPENED_MESSAGE, readTicketAnswers(ticket.answers), type.showAnswers, values);
}

export function welcomeValuesOf(settings: TicketSettings, type: TicketType, ticket: WelcomeTicket, memberIds: readonly string[] = []): ReplyValues {
  return welcomeValues({
    memberIds,
    opener: { id: ticket.openerId, username: ticket.openerName || ticket.openerId },
    ticket,
    channelId: ticket.channelId,
    typeName: ticket.typeName || type.name,
    priority: priorityLabel(settings.labels, ticket.priority),
    answers: readTicketAnswers(ticket.answers),
    handlerRoleIds: type.handlers,
    pingRoleIds: pingRolesOf(type),
    claimedById: ticket.claimedById,
  });
}
