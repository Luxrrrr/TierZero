import { applyVariables } from "@tier0/core";

/**
 * Plain-text transcript rendering. Kept separate from the Discord-facing code
 * so the format can be tested without a gateway connection, and so the shape
 * of a logged message is decided in one place.
 */

export interface TranscriptMessage {
  authorTag: string;
  authorId: string;
  /** Epoch milliseconds. */
  timestamp: number;
  /** Null for a message that arrived partial, such as one already deleted. */
  content: string | null;
  attachmentUrls: string[];
}

export interface TranscriptMeta {
  guildName: string;
  channelName: string;
  ticketId: number;
  openerTag: string;
  subject: string | null;
  /** Epoch milliseconds. */
  openedAt: number;
  /** Epoch milliseconds. */
  closedAt: number;
  closedByTag: string;
}

/**
 * The words the transcript is written in. Each line is a template, so a server
 * can translate or reword it; the layout (header, blank line, one block per
 * message) stays the same.
 */
export interface TranscriptTexts {
  title: string;
  opened: string;
  subject: string;
  noSubject: string;
  closed: string;
  empty: string;
  line: string;
  attachment: string;
  unavailable: string;
}

export const DEFAULT_TRANSCRIPT_TEXTS: TranscriptTexts = {
  title: "Ticket #{number} - {server} / #{channel}",
  opened: "Opened by {opener} at {time}",
  subject: "Subject: {subject}",
  noSubject: "(none given)",
  closed: "Closed by {closer} at {time}",
  empty: "(no messages were sent in this ticket)",
  line: "[{time}] {author} ({authorId})",
  attachment: "  attachment: {url}",
  unavailable: "(message content unavailable)",
};

function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

/**
 * Renders a ticket's header and every captured message as plain text, oldest
 * first. Messages are expected to already be in that order.
 */
export function renderTranscript(
  meta: TranscriptMeta,
  messages: TranscriptMessage[],
  texts: TranscriptTexts = DEFAULT_TRANSCRIPT_TEXTS,
): string {
  const lines: string[] = [
    applyVariables(texts.title, { number: String(meta.ticketId), server: meta.guildName, channel: meta.channelName }),
    applyVariables(texts.opened, { opener: meta.openerTag, time: formatTimestamp(meta.openedAt) }),
    applyVariables(texts.subject, { subject: meta.subject ?? texts.noSubject }),
    applyVariables(texts.closed, { closer: meta.closedByTag, time: formatTimestamp(meta.closedAt) }),
    "",
  ];

  if (messages.length === 0) {
    lines.push(texts.empty);
    return lines.join("\n");
  }

  for (const message of messages) {
    lines.push(
      applyVariables(texts.line, {
        time: formatTimestamp(message.timestamp),
        author: message.authorTag,
        authorId: message.authorId,
      }),
    );
    lines.push(message.content ?? texts.unavailable);
    for (const url of message.attachmentUrls) {
      lines.push(applyVariables(texts.attachment, { url }));
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}
