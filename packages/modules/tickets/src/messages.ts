import { embedReply, emptyEmbed, plainReply, s, type Field, type MessageBody, type MessageVariable } from "@tier0/core";

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

export const CLOSING_MESSAGE: MessageBody = embedReply("Closing this ticket{ending}", "info");
export const TRANSCRIPT_MESSAGE: MessageBody = embedReply("Transcript for ticket #{number}", "info");
export const CREATED_MESSAGE: MessageBody = embedReply("Your ticket has been created: {ticket}", "success");
export const PANEL_POSTED_MESSAGE: MessageBody = embedReply("Panel posted in {panelChannel}.", "success");
export const ADDED_MESSAGE: MessageBody = embedReply("Added {member} to this ticket.", "success");
export const REMOVED_MESSAGE: MessageBody = embedReply("Removed {member} from this ticket.", "success");

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
  { ...CLOSED_BY, description: "Who closed the ticket, as a mention, or Auto-close when it closed from inactivity" },
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
  closer: { id: string; tag?: string },
  ticket: TicketLike,
  reason: string | null,
): Record<string, string | number> {
  return {
    // The scheduled close has no member behind it, and a mention of it would not resolve.
    closedBy: closer.tag === undefined || /^\d+$/.test(closer.id) ? `<@${closer.id}>` : closer.tag,
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

const OPEN_COUNT: MessageVariable = { name: "openCount", description: "How many tickets the member has open", sample: "2" };
const LIMIT: MessageVariable = { name: "limit", description: "The most tickets one member may have open at once", sample: "2" };

export type ReplyKey =
  | "notStaff"
  | "cannotClose"
  | "cannotAdd"
  | "notATicket"
  | "alreadyClosed"
  | "channelMissing"
  | "categoryGone"
  | "categoryFull"
  | "limitOne"
  | "limitMany"
  | "noCategory"
  | "createFailed"
  | "noPanelChannel"
  | "panelFailed";

interface ReplyDefinition {
  label: string;
  help: string;
  starting: MessageBody;
  variables?: MessageVariable[];
}

/**
 * Every refusal and failure a person is told about in private. They go out
 * through `ctx.reply`, so only the member who pressed the button or ran the
 * command sees them.
 */
export const REPLIES: Record<ReplyKey, ReplyDefinition> = {
  notStaff: {
    label: "Support staff only",
    help: "Shown when someone without a support role or Manage Channels posts the panel or uses /ticket remove.",
    starting: embedReply("You need a support role or Manage Channels to do that.", "error"),
  },
  cannotClose: {
    label: "Not allowed to close",
    help: "Shown when someone who is not the opener or support staff presses Close ticket or uses /ticket close.",
    starting: embedReply("You need to be the ticket opener, hold a support role, or have Manage Channels to close this.", "error"),
  },
  cannotAdd: {
    label: "Not allowed to add a member",
    help: "Shown when someone who is not the opener or support staff uses /ticket add.",
    starting: embedReply("You need to be the ticket opener, hold a support role, or have Manage Channels to do that.", "error"),
  },
  notATicket: {
    label: "Not in a ticket",
    help: "Shown when /ticket close, add or remove is used in a channel that is not an open ticket.",
    starting: embedReply("This isn't an open ticket channel.", "error"),
  },
  alreadyClosed: {
    label: "Ticket already closed",
    help: "Shown when Close ticket is pressed on a ticket that has already been closed.",
    starting: embedReply("This ticket is already closed.", "error"),
  },
  channelMissing: {
    label: "Ticket channel missing",
    help: "Shown when /ticket add or remove is used on a ticket whose channel can no longer be found.",
    starting: embedReply("This ticket's channel is missing.", "error"),
  },
  categoryGone: {
    label: "Ticket category deleted",
    help: "Shown when a member presses the panel button after the ticket category was deleted.",
    starting: embedReply("The ticket category no longer exists. Ask a server admin to set a new one in the dashboard.", "error"),
  },
  categoryFull: {
    label: "Ticket category full",
    help: "Shown when the ticket category already holds Discord's limit of 50 channels.",
    starting: embedReply("The ticket category is full. Ask a server admin to close old tickets or choose a different category.", "error"),
  },
  limitOne: {
    label: "Already has a ticket (limit of one)",
    help: "Shown when a member who may only have one ticket open tries to open another.",
    starting: embedReply("You already have an open ticket. Close it before opening another.", "error"),
    variables: [OPEN_COUNT, LIMIT],
  },
  limitMany: {
    label: "Already has the most tickets allowed",
    help: "Shown when a member at the limit for open tickets, which is higher than one, tries to open another.",
    starting: embedReply("You already have {openCount} open tickets, the most this server allows. Close one before opening another.", "error"),
    variables: [OPEN_COUNT, LIMIT],
  },
  noCategory: {
    label: "No ticket category",
    help: "Shown when the ticket form is sent in but the category is missing or deleted.",
    starting: embedReply("No ticket category is set, or the one configured has been deleted. Ask a server admin to set one in the dashboard.", "error"),
  },
  createFailed: {
    label: "Ticket could not be created",
    help: "Shown when Discord refuses to create the ticket channel, usually for a missing permission.",
    starting: embedReply("Something went wrong creating your ticket channel. Try again, or tell a server admin if it keeps happening.", "error"),
  },
  noPanelChannel: {
    label: "No panel channel",
    help: "Shown to someone using /ticket panel when no panel channel is set or it was deleted.",
    starting: embedReply("No panel channel is set, or the one configured has been deleted. Set one in the dashboard first.", "error"),
  },
  panelFailed: {
    label: "Panel could not be posted",
    help: "Shown to someone using /ticket panel when the bot cannot post in the panel channel.",
    starting: embedReply("I couldn't post the panel there. Check that I can send messages and embed links in that channel.", "error"),
  },
};

export const replyField = (key: ReplyKey): Field<MessageBody> =>
  s.message({
    label: REPLIES[key].label,
    help: REPLIES[key].help,
    note: "Only the person it is shown to sees this.",
    starting: REPLIES[key].starting,
    variables: REPLIES[key].variables ?? [],
    delivery: "dm",
    components: false,
    compact: true,
  });
