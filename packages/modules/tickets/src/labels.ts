import { applyVariables, s, type Infer } from "@tier0/core";
import { DEFAULT_TRANSCRIPT_TEXTS, type TranscriptTexts } from "./transcript.js";

/**
 * The short strings the module hands to Discord: form and button text, the
 * name and topic of a ticket channel, audit-log reasons and the words of the
 * transcript file. The defaults are what the module has always used. Free of
 * discord.js so they can be tested on their own.
 */

/**
 * The one question the form asked before types had forms of their own. It
 * moved to the first question of the type the settings upgrade creates.
 */
export const DEFAULT_MODAL_QUESTION = "What do you need help with?";

export const PRIORITY_LABELS = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" } as const;

/** The colours a Discord button can have, as the dashboard names them. */
export const BUTTON_COLOURS = [
  { value: "primary", label: "Blurple" },
  { value: "secondary", label: "Grey" },
  { value: "success", label: "Green" },
  { value: "danger", label: "Red" },
] as const;

export type ButtonColour = (typeof BUTTON_COLOURS)[number]["value"];

/** The colour each button has always had. */
export const DEFAULT_BUTTON_COLOURS = {
  closeButtonStyle: "danger",
  claimButtonStyle: "success",
  unclaimButtonStyle: "secondary",
  reopenButtonStyle: "success",
  deleteButtonStyle: "danger",
  requestCloseButtonStyle: "danger",
  keepOpenButtonStyle: "secondary",
} as const satisfies Record<string, ButtonColour>;

const colour = (label: string, fallback: ButtonColour) =>
  s.choice({ label, options: [...BUTTON_COLOURS], default: fallback, topic: "buttons" });

const button = (label: string, fallback: string, help?: string) =>
  s.string({ label, ...(help ? { help } : {}), default: fallback, max: 80, topic: "buttons" });

export const DEFAULT_LABELS = {
  modalTitle: "Open a ticket",
  closeButton: "Close ticket",
  claimButton: "Claim",
  unclaimButton: "Unclaim",
  reopenButton: "Reopen",
  deleteButton: "Delete ticket",
  requestCloseButton: "Close",
  keepOpenButton: "Keep open",
  reasonTitle: "Close the ticket",
  reasonQuestion: "Why is it being closed?",
  topicWithSubject: "Opened by {tag}: {subject}",
  topicWithoutSubject: "Opened by {tag}",
  closeReason: "Ticket closed by {tag}",
  autoCloseName: "Auto-close",
  inactiveReason: "No activity in this ticket",
  openerLeftReason: "The opener left the server",
  unknownAuthor: "unknown user",
  unknownAuthorId: "unknown",
  fileName: "ticket-{number}.txt",
} as const;

const T = DEFAULT_TRANSCRIPT_TEXTS;

export const labelsGroup = s.object(
  {
    modalTitle: s.string({
      label: "Form title",
      help: "The title of the form that opens when a member picks a ticket type with questions. Discord allows 45 characters.",
      default: DEFAULT_LABELS.modalTitle,
      max: 45,
      topic: "forms",
    }),
    closeButton: button("Close button", DEFAULT_LABELS.closeButton, "On the first message in a ticket."),
    closeButtonStyle: colour("Close button colour", DEFAULT_BUTTON_COLOURS.closeButtonStyle),
    claimButton: button("Claim button", DEFAULT_LABELS.claimButton, "Beside the close button, while claiming is on."),
    claimButtonStyle: colour("Claim button colour", DEFAULT_BUTTON_COLOURS.claimButtonStyle),
    unclaimButton: button("Unclaim button", DEFAULT_LABELS.unclaimButton, "Takes the place of the claim button once someone has claimed the ticket."),
    unclaimButtonStyle: colour("Unclaim button colour", DEFAULT_BUTTON_COLOURS.unclaimButtonStyle),
    reopenButton: button("Reopen button", DEFAULT_LABELS.reopenButton, "Under the closed notice of a ticket whose channel is kept."),
    reopenButtonStyle: colour("Reopen button colour", DEFAULT_BUTTON_COLOURS.reopenButtonStyle),
    deleteButton: button("Delete button", DEFAULT_LABELS.deleteButton, "Under the closed notice, for staff to delete the channel straight away."),
    deleteButtonStyle: colour("Delete button colour", DEFAULT_BUTTON_COLOURS.deleteButtonStyle),
    requestCloseButton: button("Close button on a close request", DEFAULT_LABELS.requestCloseButton),
    requestCloseButtonStyle: colour("Close button colour on a close request", DEFAULT_BUTTON_COLOURS.requestCloseButtonStyle),
    keepOpenButton: button("Keep open button on a close request", DEFAULT_LABELS.keepOpenButton),
    keepOpenButtonStyle: colour("Keep open button colour", DEFAULT_BUTTON_COLOURS.keepOpenButtonStyle),
    reasonTitle: s.string({
      label: "Title of the form asking why a ticket is closed",
      help: "Shown when a ticket type asks for a reason. Discord allows 45 characters.",
      default: DEFAULT_LABELS.reasonTitle,
      max: 45,
      topic: "forms",
    }),
    reasonQuestion: s.string({ label: "Question asking why", default: DEFAULT_LABELS.reasonQuestion, max: 45, topic: "forms" }),
    topicWithSubject: s.template({
      label: "Channel topic when a subject was given",
      default: DEFAULT_LABELS.topicWithSubject,
      placeholders: ["tag", "username", "subject", "type", "priority"],
      max: 500,
      topic: "forms",
    }),
    topicWithoutSubject: s.template({
      label: "Channel topic when no subject was given",
      default: DEFAULT_LABELS.topicWithoutSubject,
      placeholders: ["tag", "username", "type", "priority"],
      max: 500,
      topic: "forms",
    }),
    priorities: s.object(
      {
        low: s.string({ label: "Low", default: PRIORITY_LABELS.low, max: 40 }),
        normal: s.string({ label: "Normal", default: PRIORITY_LABELS.normal, max: 40 }),
        high: s.string({ label: "High", default: PRIORITY_LABELS.high, max: 40 }),
        urgent: s.string({ label: "Urgent", default: PRIORITY_LABELS.urgent, max: 40 }),
      },
      { label: "Priority names", help: "How each priority reads in channel topics, messages and the /ticket priority options.", topic: "forms" },
    ),
    closeReason: s.template({
      label: "Reason recorded in the server's audit log when a ticket closes",
      help: "Shown by Discord next to the deleted channel.",
      default: DEFAULT_LABELS.closeReason,
      placeholders: ["tag"],
      max: 400,
      topic: "forms",
    }),
    autoCloseName: s.string({
      label: "Name shown for an automatic close",
      help: "Stands in for a person's name in the audit log and the transcript when a ticket closes from inactivity.",
      default: DEFAULT_LABELS.autoCloseName,
      max: 80,
      topic: "forms",
    }),
    inactiveReason: s.string({
      label: "Reason given for an automatic close",
      help: "Fills {reason} in the closing message when that is switched on for inactive tickets.",
      default: DEFAULT_LABELS.inactiveReason,
      max: 200,
      topic: "forms",
    }),
    openerLeftReason: s.string({
      label: "Reason given when a ticket closes because the opener left",
      help: "Used when General is set to close a ticket whose opener leaves the server.",
      default: DEFAULT_LABELS.openerLeftReason,
      max: 200,
      topic: "forms",
    }),
    transcript: s.object(
      {
        fileName: s.template({
          label: "File name",
          default: DEFAULT_LABELS.fileName,
          placeholders: ["number"],
          max: 100,
        }),
        title: s.template({
          label: "First line",
          default: T.title,
          placeholders: ["number", "server", "channel"],
          max: 200,
        }),
        opened: s.template({ label: "Who opened it and when", default: T.opened, placeholders: ["opener", "time"], max: 200 }),
        subject: s.template({ label: "Subject line", default: T.subject, placeholders: ["subject"], max: 200 }),
        noSubject: s.string({ label: "When there was no subject", default: T.noSubject, max: 100 }),
        closed: s.template({ label: "Who closed it and when", default: T.closed, placeholders: ["closer", "time"], max: 200 }),
        reason: s.template({ label: "Why it was closed", default: T.reason ?? "Reason: {reason}", placeholders: ["reason"], max: 200 }),
        empty: s.string({ label: "When nothing was said", default: T.empty, max: 200 }),
        line: s.template({
          label: "Heading of each message",
          default: T.line,
          placeholders: ["time", "author", "authorId"],
          max: 200,
        }),
        attachment: s.template({ label: "Line for each attachment", default: T.attachment, placeholders: ["url"], max: 200 }),
        unavailable: s.string({ label: "When a message's text is not available", default: T.unavailable, max: 200 }),
        unknownAuthor: s.string({ label: "Author whose name is not known", default: DEFAULT_LABELS.unknownAuthor, max: 100 }),
        unknownAuthorId: s.string({ label: "Author whose ID is not known", default: DEFAULT_LABELS.unknownAuthorId, max: 100 }),
      },
      { label: "Transcript file", help: "The text file attached to a saved transcript. Lines are filled in from the ticket.", topic: "transcript" },
    ),
  },
  {
    label: "Buttons and form text",
    help: "The short text Discord shows on buttons and forms, in channel topics and the audit log, and in the transcript file.",
    section: "messages",
    layout: "fields",
    topics: [
      { id: "buttons", label: "Buttons", help: "Buttons can also be edited where they show, under the message previews." },
      { id: "forms", label: "Forms and channels" },
      { id: "transcript", label: "Transcript file", help: "The text file attached to a saved transcript. Lines are filled in from the ticket." },
    ],
  },
);

export type TicketLabels = Infer<typeof labelsGroup>;

export function transcriptTexts(labels: TicketLabels): TranscriptTexts {
  const { title, opened, subject, noSubject, closed, reason, empty, line, attachment, unavailable } = labels.transcript;
  return { title, opened, subject, noSubject, closed, reason, empty, line, attachment, unavailable };
}

const fill = (template: string, values: Record<string, string>): string => applyVariables(template, values);

export function topicOf(
  labels: TicketLabels,
  tag: string,
  username: string,
  subject: string | null,
  extra: { type?: string; priority?: string } = {},
): string {
  const values = { tag, username, type: extra.type ?? "", priority: extra.priority ?? "" };
  const text = subject ? fill(labels.topicWithSubject, { ...values, subject }) : fill(labels.topicWithoutSubject, values);
  // Discord stops a topic at 1024 characters.
  return text.slice(0, 1024);
}

export function closeReasonOf(labels: TicketLabels, tag: string): string {
  return fill(labels.closeReason, { tag }).slice(0, 512);
}

/** How a priority reads, in the server's words. */
export function priorityLabel(labels: TicketLabels, priority: string): string {
  const names = labels.priorities as Record<string, string>;
  return names[priority] ?? priority;
}

const UNSAFE_FILE_CHARS = /[\\/:*?"<>|]+/g;

/** A file name the attachment can carry: no path separators or characters Windows refuses. `number` is the ticket's number in the server. */
export function transcriptFileName(labels: TicketLabels, number: number): string {
  const filled = fill(labels.transcript.fileName, { number: String(number) });
  const printable = [...filled].filter((char) => char.charCodeAt(0) >= 32).join("");
  const name = printable.replace(UNSAFE_FILE_CHARS, "-").trim();
  return (name || DEFAULT_LABELS.fileName.replace("{number}", String(number))).slice(0, 100);
}

/**
 * The names of the web page and the text file for a ticket, from the one
 * file name setting. The page takes the name with its extension swapped for
 * .html, and the text file keeps the name unless that would collide with it.
 */
export function transcriptFileNames(labels: TicketLabels, number: number): { html: string; text: string } {
  const name = transcriptFileName(labels, number);
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, "") || name;
  return { html: `${base}.html`, text: name.toLowerCase().endsWith(".html") ? `${base}.txt` : name };
}
