import { embedReply, emptyButton, emptyEmbed, plainReply, s, type Field, type MessageBody, type MessageButton, type MessageVariable } from "@tier0/core";
import { type TicketAnswer } from "@tier0/shared-tickets";

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

/**
 * The text names the roles picked under "Who to ping when a ticket opens",
 * which are also the only roles the message may ping, so the choice there
 * decides who hears about a new ticket without the text being edited too.
 */
export const OPENED_MESSAGE: MessageBody = {
  ...embedOf({ title: "{title}", description: "Opened by {user}" }),
  content: "{user} {pingRoles}",
};

export const CLOSING_MESSAGE: MessageBody = embedReply("Closing this ticket{ending}", "info");
export const TRANSCRIPT_MESSAGE: MessageBody = embedReply("Transcript for ticket #{number}", "info");
export const CREATED_MESSAGE: MessageBody = embedReply("Your ticket has been created: {ticket}", "success");
export const PANEL_POSTED_MESSAGE: MessageBody = embedReply("Panel posted in {panelChannel}.", "success");
/** After the first post of a panel an older version had posted, which kept no note of where, so the old message is still up. */
export const PANEL_POSTED_LEGACY_MESSAGE: MessageBody = embedReply(
  "Panel posted in {panelChannel}. The panel an older version of the bot posted is still up. Delete that message so members only use the new one.",
  "warning",
);
export const ADDED_MESSAGE: MessageBody = embedReply("Added {member} to this ticket.", "success");
export const REMOVED_MESSAGE: MessageBody = embedReply("Removed {member} from this ticket.", "success");

const USER: MessageVariable = { name: "user", description: "The member who opened the ticket, as a mention", sample: "@Ada" };
const NUMBER: MessageVariable = { name: "number", description: "The ticket's number in this server", sample: "42" };
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
  {
    name: "supportRoles",
    description: "The type's handlers, as mentions. They are only notified when they are the roles picked to ping",
    sample: "@Support @Moderators",
  },
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
  /** The number in the server; a row without one shows its id. */
  number?: number | null;
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
    number: ticket.number ?? ticket.id,
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
    number: ticket.number ?? ticket.id,
  };
}

export function transcriptValues(
  ticket: TicketLike & { openerId: string },
  closedBy: { id: string; tag: string },
  channelName: string,
): Record<string, string | number> {
  return {
    number: ticket.number ?? ticket.id,
    user: `<@${ticket.openerId}>`,
    subject: ticket.subject ?? "",
    // The scheduled close has no member behind it, and a mention of it would not resolve.
    closedBy: /^\d+$/.test(closedBy.id) ? `<@${closedBy.id}>` : closedBy.tag,
    ticketName: channelName,
  };
}

// -- messages added with ticket types --------------------------------------

const STAFF: MessageVariable = { name: "staff", description: "Who did it, as a mention", sample: "@Grace" };
const TYPE: MessageVariable = { name: "type", description: "The ticket's type", sample: "Billing" };
const HANDLERS: MessageVariable = {
  name: "handlers",
  description: "The roles that handle this type of ticket, as mentions",
  sample: "@Support",
};
const REASON: MessageVariable = { name: "reason", description: "The reason given, empty when there was none", sample: "Solved" };
const ENDING: MessageVariable = {
  name: "ending",
  description: "How the sentence ends: a colon and the reason when one was given, otherwise a full stop",
  sample: ": Solved",
};
const PRIORITY: MessageVariable = { name: "priority", description: "The ticket's priority", sample: "High" };
const TICKET_URL: MessageVariable = {
  name: "ticketUrl",
  description: "The ticket in the dashboard, empty while the dashboard's address is not known",
  sample: "https://tickets.example.com/guilds/1/tickets/42",
};

const ANSWER_VARIABLES: MessageVariable[] = [1, 2, 3, 4, 5].map((n) => ({
  name: `answer${n}`,
  description: `The answer to question ${n} of the form, empty when there is none`,
  sample: n === 1 ? "I can't log in" : "",
}));

/** The first message in a ticket, per type. The six variables it always had come first. */
export const WELCOME_VARIABLES: MessageVariable[] = [
  ...OPENED_VARIABLES,
  TYPE,
  PRIORITY,
  { name: "answers", description: "Every answer to the form, as a bulleted list", sample: "- I can't log in" },
  ...ANSWER_VARIABLES,
  { name: "claimedBy", description: "Who is handling the ticket, as a mention, empty until someone claims it", sample: "@Grace" },
  HANDLERS,
  { name: "pingRoles", description: "The roles chosen to be pinged when a ticket opens, as mentions, so they are notified", sample: "@Support" },
  { name: "members", description: "The members added to the ticket, as mentions, including those staff picked when they opened it from the dashboard", sample: "@Ada @Linus" },
];

/** Posted in a ticket whose opener left the server, while it is open. */
export const OPENER_LEFT_MESSAGE: MessageBody = embedReply("{user} left the server, so they can no longer read this ticket.", "warning");
export const OPENER_LEFT_VARIABLES: MessageVariable[] = [
  { ...USER, description: "The member who opened the ticket and left, as a mention" },
  { name: "username", description: "Their name, without a mention", sample: "Ada" },
  NUMBER,
  TYPE,
];

/** Posted under the first message of a ticket opened outside working hours. */
export const OUTSIDE_HOURS_MESSAGE: MessageBody = embedReply(
  "The team answers tickets during working hours, which start again {opens}. Your ticket is saved and someone will answer then.",
  "info",
);
export const OUTSIDE_HOURS_VARIABLES: MessageVariable[] = [
  USER,
  { name: "opens", description: "When working hours start again, as a relative time", sample: "in 9 hours" },
  { name: "opensAt", description: "The same moment as a date and time, in each reader's own time zone", sample: "Monday 9:00" },
  NUMBER,
  TYPE,
];

/** Posted in the ticket when it closes and the channel is kept. The Reopen button is added under it. */
export const CLOSED_MESSAGE: MessageBody = embedReply("This ticket was closed by {closedBy}{ending}", "info");
export const CLOSED_VARIABLES: MessageVariable[] = [...CLOSING_VARIABLES, USER, TYPE];

/** Asks the opener to confirm. The Close and Keep open buttons are added under it. */
export const CLOSE_REQUEST_MESSAGE: MessageBody = embedReply(
  "{staff} thinks this ticket can be closed{ending} Press Close if you have everything you need, or Keep open if you still need help. It closes by itself {deadline} if nobody answers.",
  "info",
  { ping: "{user}" },
);
export const CLOSE_REQUEST_VARIABLES: MessageVariable[] = [
  USER,
  STAFF,
  REASON,
  ENDING,
  { name: "deadline", description: "When the ticket closes if nobody answers, as a relative time", sample: "in 24 hours" },
  NUMBER,
];

export const KEPT_OPEN_MESSAGE: MessageBody = embedReply("{user} would like to keep this ticket open.", "info");
export const REOPENED_MESSAGE: MessageBody = embedReply("Ticket reopened by {staff}.", "success");
export const CLAIMED_MESSAGE: MessageBody = embedReply("{staff} is handling this ticket.", "success");
export const UNCLAIMED_MESSAGE: MessageBody = embedReply("{staff} is no longer handling this ticket.", "info");
export const PRIORITY_MESSAGE: MessageBody = embedReply("Priority set to {priority} by {staff}.", "info");
export const TRANSFERRED_MESSAGE: MessageBody = embedReply("Moved from {previousType} to {type} by {staff}.", "info", { ping: "{handlers}" });
export const RENAMED_MESSAGE: MessageBody = embedReply("Renamed to {name} by {staff}.", "info");
export const NOTE_ADDED_MESSAGE: MessageBody = embedReply("Note added to ticket #{number}. Only staff can read it, in the dashboard.", "success");
export const TRANSCRIPT_LINK_MESSAGE: MessageBody = embedReply("The transcript of ticket #{number} is in the dashboard: {ticketUrl}", "info");
export const INFO_MESSAGE: MessageBody = {
  ...plainReply(""),
  embeds: [
    {
      ...emptyEmbed(),
      title: "Ticket #{number}",
      color: TICKET_COLOUR,
      fields: [
        { name: "Type", value: "{type}", inline: true },
        { name: "Priority", value: "{priority}", inline: true },
        { name: "Opened by", value: "{user}", inline: true },
        { name: "Opened", value: "{opened}", inline: true },
        { name: "Handled by", value: "{claimedBy}", inline: true },
        { name: "Subject", value: "{subject}", inline: false },
      ],
    },
  ],
};

export const TICKET_VARIABLES: MessageVariable[] = [USER, STAFF, NUMBER, TYPE];
export const PRIORITY_VARIABLES: MessageVariable[] = [
  PRIORITY,
  { name: "previous", description: "The priority it had before", sample: "Normal" },
  ...TICKET_VARIABLES,
];
export const TRANSFERRED_VARIABLES: MessageVariable[] = [
  { ...TYPE, description: "The type it was moved to" },
  { name: "previousType", description: "The type it was before", sample: "General" },
  HANDLERS,
  USER,
  STAFF,
  NUMBER,
];
export const RENAMED_VARIABLES: MessageVariable[] = [
  { name: "name", description: "The new name", sample: "billing-ada" },
  { name: "previous", description: "The name before", sample: "ticket-ada" },
  ...TICKET_VARIABLES,
];
export const TRANSCRIPT_LINK_VARIABLES: MessageVariable[] = [NUMBER, TICKET_URL];
export const INFO_VARIABLES: MessageVariable[] = [
  NUMBER,
  TYPE,
  PRIORITY,
  USER,
  SUBJECT,
  { name: "opened", description: "When the ticket was opened, as a relative time", sample: "2 hours ago" },
  { name: "claimedBy", description: "Who is handling it, as a mention, empty when nobody is", sample: "@Grace" },
];

/** Direct message to the opener after a close. The 1 to 5 buttons are added under it. */
export const RATING_MESSAGE: MessageBody = {
  ...embedOf({
    title: "How did we do?",
    description: "Your ticket #{number} on {server} was closed. Pick a rating from 1 to 5 below to tell the team how it went.",
  }),
};
export const RATING_VARIABLES: MessageVariable[] = [NUMBER, TYPE, SUBJECT, CLOSED_BY];
export const RATING_THANKS_MESSAGE: MessageBody = embedReply("Thanks, your rating of {rating} has been passed on to the team.", "success");
export const RATING_THANKS_VARIABLES: MessageVariable[] = [
  { name: "rating", description: "The rating they gave, from 1 to 5", sample: "5" },
  NUMBER,
];

/**
 * Added under the rating request, whose buttons it replaces, once a rating is
 * picked. The request's own text stays above it.
 */
export const RATING_RATED_MESSAGE: MessageBody = embedReply("You rated this {rating} out of 5\n{stars}", "success");
export const RATING_RATED_VARIABLES: MessageVariable[] = [
  { name: "rating", description: "The rating they gave, from 1 to 5", sample: "4" },
  { name: "stars", description: "The rating as filled and empty stars", sample: "★★★★☆" },
  ...RATING_VARIABLES,
];

/** The rating as five stars, filled up to the rating. */
export function starsOf(rating: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

/** Two messages as one: the second's text and embeds after the first's. Buttons are left to the caller. */
export function appended(first: MessageBody, second: MessageBody): MessageBody {
  return {
    content: [first.content, second.content].filter((part) => part !== "").join("\n"),
    embeds: [...first.embeds, ...second.embeds],
    buttons: [],
    selects: [],
    reactions: [],
  };
}

/** Pings the handlers once when only the opener has spoken for a while. */
export const REMINDER_MESSAGE: MessageBody = embedReply("{user} has been waiting {waited} for a reply.", "warning", { ping: "{handlers}" });
export const REMINDER_VARIABLES: MessageVariable[] = [
  USER,
  HANDLERS,
  { name: "waited", description: "How long since the ticket opened", sample: "30 minutes" },
  NUMBER,
  TYPE,
  { ...TICKET, description: "The ticket's channel, as a link" },
];

/** Direct message to the people in the ticket with the transcript attached. */
export const TRANSCRIPT_DM_MESSAGE: MessageBody = embedReply("Here is the transcript of ticket #{number} on {server}.", "info");
export const TRANSCRIPT_DM_VARIABLES: MessageVariable[] = [NUMBER, TYPE, SUBJECT];

/** The post-close summary in the log channel. The button drops out while the dashboard's address is not known. */
export const CLOSED_SUMMARY_MESSAGE: MessageBody = {
  ...plainReply(""),
  embeds: [
    {
      ...emptyEmbed(),
      title: "Ticket #{number} closed",
      color: TICKET_COLOUR,
      fields: [
        { name: "Type", value: "{type}", inline: true },
        { name: "Opened by", value: "{user}", inline: true },
        { name: "Closed by", value: "{closedBy}", inline: true },
        { name: "Handled by", value: "{claimedBy}", inline: true },
        { name: "Messages", value: "{messages}", inline: true },
        { name: "Open for", value: "{duration}", inline: true },
        { name: "Reason", value: "{reason}", inline: false },
      ],
    },
  ],
  buttons: [viewTicketButton()],
};
export const CLOSED_SUMMARY_VARIABLES: MessageVariable[] = [
  NUMBER,
  TYPE,
  USER,
  SUBJECT,
  CLOSED_BY,
  { name: "claimedBy", description: "Who handled it, as a mention, empty when nobody claimed it", sample: "@Grace" },
  REASON,
  { name: "messages", description: "How many messages were sent in it", sample: "14" },
  { name: "duration", description: "How long it was open", sample: "3 hours" },
  { ...PRIORITY, sample: "Normal" },
  TICKET_URL,
];

export function viewTicketButton(): MessageButton {
  return { ...emptyButton(), label: "View in dashboard", style: "link", url: "{ticketUrl}" };
}

/** `{answers}`: one line per answered question. */
export function answersBlock(answers: readonly TicketAnswer[]): string {
  return answers
    .filter((answer) => answer.value.trim() !== "")
    .map((answer) => `- **${answer.label}**: ${answer.value.trim()}`)
    .join("\n");
}

/**
 * How much of the answers `{answers}` and `{answer1}` to `{answer5}` carry. Discord
 * allows 2000 characters of text, so a first message that puts them in its text
 * still fits, rather than being replaced by the default message.
 */
const ANSWERS_TEXT_MAX = 1000;

const shortened = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** Every value WELCOME_VARIABLES names. */
export function welcomeValues(input: {
  opener: { id: string; username: string };
  ticket: TicketLike;
  channelId: string;
  typeName: string;
  priority: string;
  answers: readonly TicketAnswer[];
  handlerRoleIds: readonly string[];
  pingRoleIds: readonly string[];
  claimedById: string | null;
  /** Members added to the ticket, for `{members}`. */
  memberIds?: readonly string[];
}): Record<string, string | number> {
  const mention = (ids: readonly string[]) => ids.map((roleId) => `<@&${roleId}>`).join(" ");
  const values: Record<string, string | number> = {
    ...openedValues(input.opener, input.ticket, input.channelId, [...input.handlerRoleIds]),
    type: input.typeName,
    priority: input.priority,
    answers: shortened(answersBlock(input.answers), ANSWERS_TEXT_MAX),
    claimedBy: input.claimedById ? `<@${input.claimedById}>` : "",
    handlers: mention(input.handlerRoleIds),
    pingRoles: mention(input.pingRoleIds),
    members: (input.memberIds ?? []).map((userId) => `<@${userId}>`).join(" "),
  };
  for (let n = 1; n <= 5; n++) values[`answer${n}`] = shortened(input.answers[n - 1]?.value ?? "", ANSWERS_TEXT_MAX);
  return values;
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

const CLAIMED_BY: MessageVariable = { name: "claimedBy", description: "Who is handling the ticket, as a mention", sample: "@Grace" };
const OPEN_COUNT: MessageVariable = { name: "openCount", description: "How many tickets the member has open", sample: "2" };
const LIMIT: MessageVariable = { name: "limit", description: "The most tickets one member may have open at once", sample: "2" };

export type ReplyKey =
  | "notStaff"
  | "cannotClose"
  | "cannotAdd"
  | "addLimit"
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
  | "panelFailed"
  | "staffOnlyClose"
  | "notOpener"
  | "notYourClaim"
  | "blocked"
  | "cooldown"
  | "notAllowed"
  | "typeMissing"
  | "panelMissing"
  | "alreadyClaimed"
  | "notClaimed"
  | "claimOff"
  | "notClosed"
  | "cannotReopen"
  | "reopenOff"
  | "reopenNeedsStaff"
  | "typeNotFound"
  | "sameType"
  | "renameFailed"
  | "noDashboard"
  | "alreadyRated"
  | "memberMissing"
  | "renameQueued"
  | "panelEmoji"
  | "noSavedReply"
  | "cannotRemoveOpener";

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
  addLimit: {
    label: "Added as many people as allowed",
    help: "Shown when the ticket opener has added as many people as an opener may, or tries to add a bot. Support staff are not limited.",
    starting: embedReply("You've added as many people to this ticket as you can. Ask support staff to add anyone else.", "error"),
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
  staffOnlyClose: {
    label: "Only staff may close",
    help: "Shown when the opener tries to close a ticket of a type whose openers may not close their own.",
    starting: embedReply("Only staff can close {type} tickets. Ask them here if you're done.", "error"),
    variables: [TYPE],
  },
  notOpener: {
    label: "Only the opener may answer",
    help: "Shown when someone other than the opener presses Close or Keep open on a close request.",
    starting: embedReply("Only the member who opened this ticket can answer this.", "error"),
  },
  notYourClaim: {
    label: "Claimed by someone else",
    help: "Shown when a handler tries to unclaim or take over a ticket someone else has claimed.",
    starting: embedReply("{claimedBy} is handling this ticket. Only they or an admin can change that.", "error"),
    variables: [CLAIMED_BY],
  },
  blocked: {
    label: "Blocked from opening tickets",
    help: "Shown to a member on the blocklist, or holding a blocked role, when they try to open a ticket.",
    starting: embedReply("You can't open tickets on this server. If you think that's a mistake, talk to a server admin.", "error"),
  },
  cooldown: {
    label: "Opened one too recently",
    help: "Shown when a member tries to open another ticket of a type before its cooldown has passed.",
    starting: embedReply("You opened a {type} ticket recently. You can open another {available}.", "error"),
    variables: [TYPE, { name: "available", description: "When they can open another, as a relative time", sample: "in 2 hours" }],
  },
  notAllowed: {
    label: "Not allowed to open this type",
    help: "Shown when a type only lets some roles open it, or blocks a role the member holds.",
    starting: embedReply("You don't have a role that can open {type} tickets.", "error"),
    variables: [TYPE],
  },
  typeMissing: {
    label: "Ticket option removed",
    help: "Shown when a member presses a button or picks an option on an old panel whose ticket type has since been removed.",
    starting: embedReply("That option isn't available any more. Ask a server admin to update the panel.", "error"),
  },
  panelMissing: {
    label: "Panel not found",
    help: "Shown to someone using /ticket panel for a panel that no longer exists.",
    starting: embedReply("That panel doesn't exist any more. Pick another one, or set it up in the dashboard.", "error"),
  },
  alreadyClaimed: {
    label: "Already claimed",
    help: "Shown when someone claims a ticket that is already claimed.",
    starting: embedReply("{claimedBy} is already handling this ticket.", "error"),
    variables: [CLAIMED_BY],
  },
  notClaimed: {
    label: "Not claimed",
    help: "Shown when someone unclaims a ticket nobody has claimed.",
    starting: embedReply("Nobody is handling this ticket yet.", "error"),
  },
  claimOff: {
    label: "Claiming switched off",
    help: "Shown when someone claims a ticket of a type that has claiming switched off.",
    starting: embedReply("Claiming is switched off for {type} tickets.", "error"),
    variables: [TYPE],
  },
  notClosed: {
    label: "Ticket still open",
    help: "Shown when /ticket reopen is used on a ticket that is open.",
    starting: embedReply("This ticket is still open.", "error"),
  },
  cannotReopen: {
    label: "Channel already deleted",
    help: "Shown when someone tries to reopen a ticket whose channel was deleted when it closed.",
    starting: embedReply("This ticket's channel was deleted when it closed, so it can't be reopened. Open a new ticket instead.", "error"),
  },
  reopenOff: {
    label: "Reopening switched off",
    help: "Shown when someone tries to reopen a ticket on a server that does not allow it.",
    starting: embedReply("Closed tickets can't be reopened on this server. Open a new ticket instead.", "error"),
  },
  reopenNeedsStaff: {
    label: "Staff must reopen",
    help: "Shown when the opener presses Reopen on a type that needs staff to reopen its tickets.",
    starting: embedReply("A member of staff needs to reopen this ticket. Ask them, or open a new one.", "error"),
  },
  typeNotFound: {
    label: "No such ticket type",
    help: "Shown when /ticket transfer names a type that does not exist.",
    starting: embedReply("There's no ticket type by that name. Pick one from the list.", "error"),
  },
  sameType: {
    label: "Already that type",
    help: "Shown when /ticket transfer names the type the ticket already is.",
    starting: embedReply("This is already a {type} ticket.", "error"),
    variables: [TYPE],
  },
  renameFailed: {
    label: "Ticket could not be renamed",
    help: "Shown when Discord refuses to rename the ticket's channel or thread.",
    starting: embedReply("I couldn't rename this ticket. Check that I have Manage Channels, and try again in a few minutes.", "error"),
  },
  noDashboard: {
    label: "Dashboard address not known",
    help: "Shown by /ticket transcript while the bot does not know the dashboard's address.",
    starting: embedReply("The bot doesn't know the dashboard's address yet, so it can't link to the transcript. Open the dashboard once, or set its address in the Moderation settings.", "error"),
  },
  memberMissing: {
    label: "Member not in the server",
    help: "Shown when /ticket add names someone who isn't a member of this server.",
    starting: embedReply("That person isn't in this server, so they can't be added to the ticket.", "error"),
  },
  alreadyRated: {
    label: "Already rated",
    help: "Shown when the opener presses a rating button again after rating the ticket.",
    starting: embedReply("You've already rated this ticket. Thanks!", "info"),
  },
  renameQueued: {
    label: "Rename waiting its turn",
    help: "Shown by /ticket rename when Discord holds the rename back, which it does after two renames of a channel in ten minutes.",
    starting: embedReply(
      "Discord lets a channel be renamed twice every ten minutes, so this rename is waiting its turn. It goes through by itself within ten minutes.",
      "info",
    ),
  },
  panelEmoji: {
    label: "Panel emoji not in this server",
    help: "Shown to someone using /ticket panel when a ticket type's emoji is a custom one from another server, which Discord refuses.",
    starting: embedReply("The emoji of {type} is not one of this server's emoji, so Discord won't post the panel. Pick another emoji for it in the dashboard.", "error"),
    variables: [TYPE],
  },
  cannotRemoveOpener: {
    label: "Opener can't be removed",
    help: "Shown when /ticket remove names the member who opened the ticket.",
    starting: embedReply("The member who opened this ticket can't be removed from it. Close the ticket instead.", "error"),
  },
  noSavedReply: {
    label: "No such saved reply",
    help: "Shown when /ticket reply names a saved reply that does not exist.",
    starting: embedReply("There's no saved reply by that name. Pick one from the list.", "error"),
  },
};

/** `topic` files the reply under another heading of the messages list than its group's. */
export const replyField = (key: ReplyKey, topic?: string): Field<MessageBody> =>
  s.message({
    label: REPLIES[key].label,
    help: REPLIES[key].help,
    ...(topic ? { topic } : {}),
    audience: "private",
    note: "Only the person it is shown to sees this.",
    starting: REPLIES[key].starting,
    variables: REPLIES[key].variables ?? [],
    delivery: "dm",
    components: false,
    compact: true,
  });
