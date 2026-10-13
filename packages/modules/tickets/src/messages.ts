import { emptyEmbed, plainReply, type MessageBody, type MessageVariable } from "@tier0/core";

/**
 * Wording the ticket messages start with, the values they are filled from, and
 * the upgrade for a panel saved while its title and body were separate
 * settings. Free of discord.js so it can be tested on its own.
 */

/** Discord's blurple, which the panel and the first message in a ticket have always used. */
export const TICKET_COLOUR = "#5865f2";

const embedOf = (fields: Partial<ReturnType<typeof emptyEmbed>>): MessageBody => ({
  ...plainReply(""),
  embeds: [{ ...emptyEmbed(), color: TICKET_COLOUR, ...fields }],
});

export const PANEL_TITLE = "Need help?";
export const PANEL_BODY = "Press the button below to open a ticket and the support team will be with you.";

export const PANEL_MESSAGE: MessageBody = embedOf({ title: PANEL_TITLE, description: PANEL_BODY });

export const OPENED_MESSAGE: MessageBody = {
  ...embedOf({ title: "{title}", description: "Opened by {user}" }),
  content: "{user} {supportRoles}",
};

export const CLOSING_MESSAGE: MessageBody = plainReply("Closing this ticket{ending}");
export const TRANSCRIPT_MESSAGE: MessageBody = plainReply("Transcript for ticket #{number}");
export const CREATED_MESSAGE: MessageBody = plainReply("Your ticket has been created: {ticket}");
export const PANEL_POSTED_MESSAGE: MessageBody = plainReply("Panel posted in {panelChannel}.");
export const ADDED_MESSAGE: MessageBody = plainReply("Added {member} to this ticket.");
export const REMOVED_MESSAGE: MessageBody = plainReply("Removed {member} from this ticket.");

const USER: MessageVariable = { name: "user", description: "The member who opened the ticket, as a mention", sample: "@Ada" };
const NUMBER: MessageVariable = { name: "number", description: "The ticket's number", sample: "42" };
const SUBJECT: MessageVariable = {
  name: "subject",
  description: "What the member typed when opening the ticket, empty when they left it blank",
  sample: "I can't log in",
};
const TICKET: MessageVariable = { name: "ticket", description: "The ticket's channel, as a link", sample: "#ticket-ada" };
const CLOSED_BY: MessageVariable = { name: "closedBy", description: "Who closed the ticket, as a mention", sample: "@Grace" };

export const OPENED_VARIABLES: MessageVariable[] = [
  USER,
  { name: "username", description: "The member's name, without a mention", sample: "Ada" },
  SUBJECT,
  { name: "title", description: "The subject, or \"New ticket\" when there is none", sample: "I can't log in" },
  NUMBER,
  TICKET,
  { name: "supportRoles", description: "Every support role, as mentions, so they are notified", sample: "@Support @Moderators" },
];

export const CLOSING_VARIABLES: MessageVariable[] = [
  CLOSED_BY,
  { name: "reason", description: "The reason given when closing with /ticket close, empty otherwise", sample: "Solved" },
  {
    name: "ending",
    description: "How the sentence ends: a colon and the reason when one was given, otherwise a full stop",
    sample: ": Solved",
  },
  NUMBER,
];

export const TRANSCRIPT_VARIABLES: MessageVariable[] = [
  NUMBER,
  USER,
  SUBJECT,
  { ...CLOSED_BY, description: "Who closed the ticket, as a mention, or Auto-close when it closed from inactivity" },
  { name: "ticketName", description: "The name the ticket's channel had", sample: "ticket-ada" },
];

export const CREATED_VARIABLES: MessageVariable[] = [TICKET, NUMBER, SUBJECT];

export const PANEL_POSTED_VARIABLES: MessageVariable[] = [
  { name: "panelChannel", description: "The channel the panel was posted in, as a link", sample: "#support" },
];

export const MEMBER_VARIABLES: MessageVariable[] = [
  { name: "member", description: "The member who was added or removed, as a mention", sample: "@Ada" },
  { name: "staff", description: "Who ran the command, as a mention", sample: "@Grace" },
  NUMBER,
];

export interface TicketLike {
  id: number;
  subject: string | null;
}

export function openedValues(
  opener: { id: string; username: string },
  ticket: TicketLike,
  channelId: string,
  supportRoleIds: string[],
): Record<string, string | number> {
  return {
    user: `<@${opener.id}>`,
    username: opener.username,
    subject: ticket.subject ?? "",
    title: ticket.subject ?? "New ticket",
    number: ticket.id,
    ticket: `<#${channelId}>`,
    supportRoles: supportRoleIds.map((roleId) => `<@&${roleId}>`).join(" "),
  };
}

export function closingValues(
  closer: { id: string },
  ticket: TicketLike,
  reason: string | null,
): Record<string, string | number> {
  return {
    closedBy: `<@${closer.id}>`,
    reason: reason ?? "",
    ending: reason ? `: ${reason}` : ".",
    number: ticket.id,
  };
}

export function transcriptValues(
  ticket: TicketLike & { openerId: string },
  closedBy: { id: string; tag: string },
  channelName: string,
): Record<string, string | number> {
  return {
    number: ticket.id,
    user: `<@${ticket.openerId}>`,
    subject: ticket.subject ?? "",
    // The scheduled close has no member behind it, and a mention of it would not resolve.
    closedBy: /^\d+$/.test(closedBy.id) ? `<@${closedBy.id}>` : closedBy.tag,
    ticketName: channelName,
  };
}

const filled = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/**
 * A panel saved with a title and body becomes a message with an embed holding
 * them in the same colour. A panel that already has a message is left alone,
 * and a title or body that was never set falls back to the old default.
 */
export function upgradePanel(stored: Record<string, unknown>): Record<string, unknown> {
  const { title, body, ...rest } = stored;
  if (rest.message !== undefined || (title === undefined && body === undefined)) return rest;
  return {
    ...rest,
    message: embedOf({
      title: filled(title) ? title : PANEL_TITLE,
      description: filled(body) ? body : PANEL_BODY,
    }),
  };
}
