import { applyVariables, s, type Infer } from "@tier0/core";
import { DEFAULT_CHANNEL_NAME } from "./naming.js";
import { DEFAULT_TRANSCRIPT_TEXTS, type TranscriptTexts } from "./transcript.js";

/**
 * The short strings the module hands to Discord: form and button text, the
 * name and topic of a ticket channel, audit-log reasons and the words of the
 * transcript file. The defaults are what the module has always used. Free of
 * discord.js so they can be tested on their own.
 */

export const DEFAULT_LABELS = {
  modalTitle: "Open a ticket",
  modalQuestion: "What do you need help with?",
  closeButton: "Close ticket",
  channelName: DEFAULT_CHANNEL_NAME,
  topicWithSubject: "Opened by {tag}: {subject}",
  topicWithoutSubject: "Opened by {tag}",
  closeReason: "Ticket closed by {tag}",
  autoCloseName: "Auto-close",
  inactiveReason: "No activity in this ticket",
  unknownAuthor: "unknown user",
  unknownAuthorId: "unknown",
  fileName: "ticket-{number}.txt",
} as const;

const T = DEFAULT_TRANSCRIPT_TEXTS;

export const labelsGroup = s.object(
  {
    modalTitle: s.string({
      label: "Form title",
      help: "The title of the form that opens when a member presses the panel button. Discord allows 45 characters.",
      default: DEFAULT_LABELS.modalTitle,
      max: 45,
    }),
    modalQuestion: s.string({
      label: "Form question",
      help: "The label above the box where the member describes what they need. Discord allows 45 characters.",
      default: DEFAULT_LABELS.modalQuestion,
      max: 45,
    }),
    closeButton: s.string({
      label: "Close button",
      help: "The text on the button in a new ticket that closes it.",
      default: DEFAULT_LABELS.closeButton,
      max: 80,
    }),
    channelName: s.template({
      label: "Ticket channel name",
      help: "Capitals and spaces are turned into what Discord allows, so Ticket {username} becomes ticket-ada.",
      default: DEFAULT_LABELS.channelName,
      placeholders: ["username"],
      max: 90,
    }),
    topicWithSubject: s.template({
      label: "Channel topic when a subject was given",
      default: DEFAULT_LABELS.topicWithSubject,
      placeholders: ["tag", "username", "subject"],
      max: 500,
    }),
    topicWithoutSubject: s.template({
      label: "Channel topic when no subject was given",
      default: DEFAULT_LABELS.topicWithoutSubject,
      placeholders: ["tag", "username"],
      max: 500,
    }),
    closeReason: s.template({
      label: "Reason recorded in the server's audit log when a ticket closes",
      help: "Shown by Discord next to the deleted channel.",
      default: DEFAULT_LABELS.closeReason,
      placeholders: ["tag"],
      max: 400,
    }),
    autoCloseName: s.string({
      label: "Name shown for an automatic close",
      help: "Stands in for a person's name in the audit log and the transcript when a ticket closes from inactivity.",
      default: DEFAULT_LABELS.autoCloseName,
      max: 80,
    }),
    inactiveReason: s.string({
      label: "Reason given for an automatic close",
      help: "Fills {reason} in the closing message when that is switched on for inactive tickets.",
      default: DEFAULT_LABELS.inactiveReason,
      max: 200,
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
      { label: "Transcript file", help: "The text file attached to a saved transcript. Lines are filled in from the ticket." },
    ),
  },
  {
    label: "Labels and text",
    help: "Form and button text, channel names and topics, audit-log reasons and the transcript's wording.",
    collapsible: true,
  },
);

export type TicketLabels = Infer<typeof labelsGroup>;

export function transcriptTexts(labels: TicketLabels): TranscriptTexts {
  const { title, opened, subject, noSubject, closed, empty, line, attachment, unavailable } = labels.transcript;
  return { title, opened, subject, noSubject, closed, empty, line, attachment, unavailable };
}

const fill = (template: string, values: Record<string, string>): string => applyVariables(template, values);

export function topicOf(labels: TicketLabels, tag: string, username: string, subject: string | null): string {
  const text = subject
    ? fill(labels.topicWithSubject, { tag, username, subject })
    : fill(labels.topicWithoutSubject, { tag, username });
  // Discord stops a topic at 1024 characters.
  return text.slice(0, 1024);
}

export function closeReasonOf(labels: TicketLabels, tag: string): string {
  return fill(labels.closeReason, { tag }).slice(0, 512);
}

const UNSAFE_FILE_CHARS = /[\\/:*?"<>|]+/g;

/** A file name the attachment can carry: no path separators or characters Windows refuses. */
export function transcriptFileName(labels: TicketLabels, ticketId: number): string {
  const filled = fill(labels.transcript.fileName, { number: String(ticketId) });
  const printable = [...filled].filter((char) => char.charCodeAt(0) >= 32).join("");
  const name = printable.replace(UNSAFE_FILE_CHARS, "-").trim();
  return (name || DEFAULT_LABELS.fileName.replace("{number}", String(ticketId))).slice(0, 100);
}
