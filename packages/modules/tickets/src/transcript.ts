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

function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

/**
 * Renders a ticket's header and every captured message as plain text, oldest
 * first. Messages are expected to already be in that order.
 */
export function renderTranscript(meta: TranscriptMeta, messages: TranscriptMessage[]): string {
  const lines: string[] = [
    `Ticket #${meta.ticketId} - ${meta.guildName} / #${meta.channelName}`,
    `Opened by ${meta.openerTag} at ${formatTimestamp(meta.openedAt)}`,
    `Subject: ${meta.subject ?? "(none given)"}`,
    `Closed by ${meta.closedByTag} at ${formatTimestamp(meta.closedAt)}`,
    "",
  ];

  if (messages.length === 0) {
    lines.push("(no messages were sent in this ticket)");
    return lines.join("\n");
  }

  for (const message of messages) {
    lines.push(`[${formatTimestamp(message.timestamp)}] ${message.authorTag} (${message.authorId})`);
    lines.push(message.content ?? "(message content unavailable)");
    for (const url of message.attachmentUrls) {
      lines.push(`  attachment: ${url}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}
