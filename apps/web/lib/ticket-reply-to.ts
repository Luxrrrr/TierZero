import { ticketReplySnippet, type TicketMessageDto } from "@tier0/core";

/**
 * Replying to one message of a conversation. What the reply bar says, which
 * messages can be answered, and which one the keyboard shortcut picks. Free of
 * React so the tests can import it.
 */

/** The message a draft answers: its id for the request, and the name and snippet for the bar. */
export interface ReplyTarget {
  messageId: string;
  name: string;
  snippet: string;
}

const SNOWFLAKE = /^\d{17,20}$/;

/** A message can be answered while it is still in Discord and has a real id. */
export function canReplyTo(message: Pick<TicketMessageDto, "messageId" | "deletedAt">): boolean {
  return message.deletedAt === null && SNOWFLAKE.test(message.messageId);
}

export function replyTargetOf(message: TicketMessageDto): ReplyTarget {
  return { messageId: message.messageId, name: message.author.name, snippet: ticketReplySnippet(message) };
}

/**
 * The message the shortcut answers: the latest one from someone other than the
 * staff, which is almost always what a handler is about to respond to. When
 * only staff have written, their latest, so the key still does something.
 */
export function latestToReplyTo(messages: readonly TicketMessageDto[]): TicketMessageDto | null {
  const open = messages.filter(canReplyTo);
  for (let index = open.length - 1; index >= 0; index -= 1) if (!open[index]!.author.isStaff) return open[index]!;
  return open[open.length - 1] ?? null;
}
