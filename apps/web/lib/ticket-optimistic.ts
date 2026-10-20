import type { TicketMessageDto } from "@tier0/shared-tickets";

/**
 * A reply the viewer just sent, shown in the conversation before Discord has
 * accepted it. It carries a made-up id and is swapped for the stored message
 * the moment that arrives, from the answer to the send or from the live feed,
 * whichever comes first, so it is never on screen twice. Free of React so the
 * tests can import it.
 */

const PENDING = "pending:";

/**
 * Messages by id, in the order they were sent. The same rule as
 * `mergeMessages` in ticket-format, which this file cannot import and stay
 * loadable on its own in the tests.
 */
function mergeMessages(current: readonly TicketMessageDto[], incoming: readonly TicketMessageDto[]): TicketMessageDto[] {
  if (incoming.length === 0) return [...current];
  const byId = new Map(current.map((message) => [message.messageId, message]));
  for (const message of incoming) byId.set(message.messageId, message);
  return [...byId.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id);
}

export const isPendingMessage = (message: Pick<TicketMessageDto, "messageId">): boolean => message.messageId.startsWith(PENDING);

export interface PendingDraft {
  token: string;
  content: string;
  replyTo: string | null;
  viewer: { userId: string; name: string; avatarUrl: string | null };
  at: Date;
}

export function pendingMessage(draft: PendingDraft): TicketMessageDto {
  return {
    id: Number.MAX_SAFE_INTEGER,
    messageId: `${PENDING}${draft.token}`,
    author: { userId: draft.viewer.userId, name: draft.viewer.name, avatarUrl: draft.viewer.avatarUrl, isStaff: true },
    content: draft.content,
    attachments: [],
    embeds: [],
    replyTo: draft.replyTo,
    createdAt: draft.at.toISOString(),
    editedAt: null,
    deletedAt: null,
    edits: 0,
    source: "dashboard",
  };
}

/** Whether a stored message is the one a pending reply became: sent from the dashboard by the viewer, with the same words, after the draft. */
function settles(pending: TicketMessageDto, stored: TicketMessageDto, viewerId: string): boolean {
  if (isPendingMessage(stored) || stored.source !== "dashboard") return false;
  const sender = stored.sentBy?.userId ?? stored.author.userId;
  return sender === viewerId && stored.content === pending.content && Date.parse(stored.createdAt) >= Date.parse(pending.createdAt) - 60_000;
}

/** Adds messages that arrived, dropping the pending reply each of them settles. */
export function mergeArrivals(current: readonly TicketMessageDto[], incoming: readonly TicketMessageDto[], viewerId: string): TicketMessageDto[] {
  const open = current.filter(isPendingMessage);
  if (open.length === 0 || incoming.length === 0) return mergeMessages(current, incoming);
  const settled = new Set<string>();
  for (const stored of incoming) {
    const match = open.find((pending) => !settled.has(pending.messageId) && settles(pending, stored, viewerId));
    if (match) settled.add(match.messageId);
  }
  return mergeMessages(
    current.filter((message) => !settled.has(message.messageId)),
    incoming,
  );
}

/** The answer to a send: the stored message in place of the pending one, whether or not the feed brought it first. */
export function settlePending(current: readonly TicketMessageDto[], token: string, stored: TicketMessageDto): TicketMessageDto[] {
  return mergeMessages(
    current.filter((message) => message.messageId !== `${PENDING}${token}`),
    [stored],
  );
}

/** A send that did not go through: the pending reply goes away. */
export function discardPending(current: readonly TicketMessageDto[], token: string): TicketMessageDto[] {
  return current.filter((message) => message.messageId !== `${PENDING}${token}`);
}
