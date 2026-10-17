import {
  DEFAULT_TICKET_FILTERS,
  ticketListQuery,
  transcriptTopic,
  type TicketAttachmentDto,
  type TicketDetailDto,
  type TicketEventDto,
  type TicketMessagesPage,
  type TicketListFilters,
  type TicketMessageDto,
  type TicketPriority,
  type TicketSummaryDto,
  type TicketTranscriptDeleteResult,
  type TranscriptActivity,
} from "@tier0/core";

/**
 * The words and the small calculations the ticket workspace repeats: labels,
 * addresses, the sentence for each event, and the order a conversation is
 * drawn in. Free of React so the tests can import it directly.
 */

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

/** Highest first, the order a priority menu lists them in. */
export const PRIORITY_MENU: readonly TicketPriority[] = ["urgent", "high", "normal", "low"];

export const PRIORITY_HINT: Record<TicketPriority, string> = {
  urgent: "Needs someone now",
  high: "Answer before the rest",
  normal: "The usual",
  low: "When there is time",
};

export function statusLabel(ticket: Pick<TicketSummaryDto, "status" | "archived">): string {
  if (ticket.status === "open") return "Open";
  return ticket.archived ? "Closed, channel kept" : "Closed";
}

/**
 * The number people know a ticket by: counted per server, as members see it
 * in Discord. The internal id stays in addresses and requests, and stands in
 * only for a bot too old to send the number.
 */
export function ticketNumber(ticket: { id: number; number?: number | null }): number {
  return typeof ticket.number === "number" && ticket.number > 0 ? ticket.number : ticket.id;
}

/** What a list row calls a ticket: its subject, or failing that its channel. */
export function ticketTitle(ticket: Pick<TicketSummaryDto, "subject" | "channelName" | "id" | "number">): string {
  const subject = ticket.subject?.trim();
  if (subject) return subject;
  if (ticket.channelName.trim() !== "") return `#${ticket.channelName}`;
  return `Ticket ${ticketNumber(ticket)}`;
}

// -- addresses ----------------------------------------------------------------

type Filters = Partial<TicketListFilters>;

/** The inbox, or one ticket in it, with the filters kept so going back lands on the same list. */
export function inboxHref(guildId: string, filters: Filters = {}, ticketId?: number): string {
  const query = ticketListQuery(filters);
  const path = `/guilds/${guildId}/tickets${ticketId === undefined ? "" : `/${ticketId}`}`;
  return query ? `${path}?${query}` : path;
}

/**
 * The transcript archive, or one transcript in it. The archive only ever lists
 * closed tickets, so the status is left out of the address rather than
 * repeated in every link.
 */
export function transcriptsHref(guildId: string, filters: Filters = {}, ticketId?: number): string {
  const params = new URLSearchParams(ticketListQuery({ ...filters, status: DEFAULT_TICKET_FILTERS.status }));
  const query = params.toString();
  const path = `/guilds/${guildId}/tickets/transcripts${ticketId === undefined ? "" : `/${ticketId}`}`;
  return query ? `${path}?${query}` : path;
}

/** The same filters with some changed. Any change but the page itself starts again from page one. */
export function withFilters(filters: TicketListFilters, change: Filters): TicketListFilters {
  const next = { ...filters, ...change };
  if (!("page" in change)) next.page = 1;
  return next;
}

/** How many filters beyond the status are on, for the count on a Filters button. */
export function activeFilterCount(filters: TicketListFilters, ignore: readonly (keyof TicketListFilters)[] = []): number {
  const keys: (keyof TicketListFilters)[] = ["typeIds", "priority", "claimed", "openerId", "q", "sort", "rating", "handlerId", "from", "to"];
  let count = 0;
  for (const key of keys) {
    if (ignore.includes(key)) continue;
    const value = filters[key];
    const fallback = DEFAULT_TICKET_FILTERS[key];
    if (Array.isArray(value) ? value.length > 0 : value !== fallback && value !== "" && value !== null) count += 1;
  }
  return count;
}

/**
 * Whether the list is the viewer's own queue: open tickets they claimed,
 * closed or answered first, which is what the bot's person filter matches.
 */
export function isMyQueue(filters: Pick<TicketListFilters, "handlerId" | "status">, viewerId: string): boolean {
  return filters.handlerId === viewerId && filters.status === "open";
}

export function ticketIdFrom(raw: string): number | null {
  if (!/^[0-9]{1,12}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// -- numbers ----------------------------------------------------------------

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** "under a minute", "14 min", "3 h 5 min", "2 days 4 h". */
export function durationText(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "No data";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "Under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  const dayWord = days === 1 ? "day" : "days";
  return restHours === 0 ? `${days} ${dayWord}` : `${days} ${dayWord} ${restHours} h`;
}

export function isImage(attachment: Pick<TicketAttachmentDto, "contentType" | "name">): boolean {
  if (attachment.contentType) return /^image\/(png|jpe?g|gif|webp)$/i.test(attachment.contentType);
  return /\.(png|jpe?g|gif|webp)$/i.test(attachment.name);
}

export function ratingText(rating: number | null): string {
  return rating === null ? "Not rated" : `${rating} out of 5`;
}

// -- events -----------------------------------------------------------------

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function priorityName(value: unknown): string {
  return typeof value === "string" && value in PRIORITY_LABEL ? PRIORITY_LABEL[value as TicketPriority].toLowerCase() : "";
}

export interface EventLine {
  text: string;
  /** A second line, such as a close reason, shown quieter. */
  detail: string | null;
}

/** One sentence for something that happened to a ticket. Bot actions with no person behind them read as the bot's. */
export function eventLine(event: Pick<TicketEventDto, "kind" | "actor" | "detail">): EventLine {
  const who = event.actor?.name.trim() || "The bot";
  const d = event.detail;
  switch (event.kind) {
    case "opened": {
      const type = text(d.typeName);
      return { text: type ? `${who} opened a ${type} ticket` : `${who} opened the ticket`, detail: null };
    }
    case "claimed":
      return { text: `${who} claimed the ticket`, detail: null };
    case "unclaimed":
      return { text: `${who} unclaimed the ticket`, detail: null };
    case "priority": {
      const from = priorityName(d.from);
      const to = priorityName(d.to);
      if (from && to) return { text: `${who} changed the priority from ${from} to ${to}`, detail: null };
      return { text: to ? `${who} set the priority to ${to}` : `${who} changed the priority`, detail: null };
    }
    case "transferred": {
      const from = text(d.fromTypeName);
      const to = text(d.toTypeName);
      if (from && to) return { text: `${who} moved the ticket from ${from} to ${to}`, detail: null };
      return { text: to ? `${who} moved the ticket to ${to}` : `${who} moved the ticket to another type`, detail: null };
    }
    case "member_added": {
      const name = text(d.name);
      return { text: name ? `${who} added ${name}` : `${who} added a member`, detail: null };
    }
    case "member_removed": {
      const name = text(d.name);
      return { text: name ? `${who} removed ${name}` : `${who} removed a member`, detail: null };
    }
    case "rename": {
      const to = text(d.to);
      return { text: to ? `${who} renamed the channel to #${to}` : `${who} renamed the channel`, detail: null };
    }
    case "close_requested":
      return { text: `${who} asked the opener whether the ticket can close`, detail: text(d.reason) || null };
    case "closed":
      return {
        text: event.actor ? `${who} closed the ticket` : "The ticket closed after a stretch with no messages",
        detail: text(d.reason) ? `Reason: ${text(d.reason)}` : null,
      };
    case "reopened":
      return { text: `${who} reopened the ticket`, detail: null };
    case "rated": {
      const rating = typeof d.rating === "number" ? d.rating : null;
      return {
        text: rating ? `${who} rated the ticket ${rating} out of 5` : `${who} rated the ticket`,
        detail: text(d.comment) || null,
      };
    }
    case "reminder":
      return { text: "The handlers were reminded that nobody has answered yet", detail: null };
    case "opener_left":
      return { text: d.closed === true ? "The opener left the server, so the ticket closed" : "The opener left the server", detail: null };
  }
}

// -- conversation -----------------------------------------------------------

/** Messages from one person this close together are drawn as one block, as Discord does. */
export const GROUP_GAP_MS = 7 * 60_000;

export type ConversationItem =
  | { kind: "day"; key: string; iso: string }
  | { kind: "message"; key: string; message: TicketMessageDto; continued: boolean }
  | { kind: "event"; key: string; event: TicketEventDto };

/**
 * Messages and events in the order they happened, with a divider at the start
 * of each day. `dayOf` decides which day a moment falls on, which depends on
 * the reader's time zone, so it is handed in. The opening event is left out:
 * the conversation's own header says who opened it.
 */
export function conversationItems(
  messages: readonly TicketMessageDto[],
  events: readonly TicketEventDto[],
  dayOf: (iso: string) => string,
): ConversationItem[] {
  type Entry = { at: number; order: number } & (
    | { kind: "message"; message: TicketMessageDto }
    | { kind: "event"; event: TicketEventDto }
  );
  const entries: Entry[] = [
    ...messages.map((message, order) => ({ kind: "message" as const, message, at: Date.parse(message.createdAt), order })),
    ...events
      .filter((event) => event.kind !== "opened")
      .map((event, order) => ({ kind: "event" as const, event, at: Date.parse(event.createdAt), order: order + messages.length })),
  ];
  // Stable on ties, so an event logged in the same second as a message keeps its place.
  entries.sort((a, b) => a.at - b.at || a.order - b.order);

  const items: ConversationItem[] = [];
  let day: string | null = null;
  let last: { authorId: string; at: number } | null = null;
  for (const entry of entries) {
    const iso = entry.kind === "message" ? entry.message.createdAt : entry.event.createdAt;
    const thisDay = dayOf(iso);
    if (thisDay !== day) {
      items.push({ kind: "day", key: `day-${thisDay}`, iso });
      day = thisDay;
      last = null;
    }
    if (entry.kind === "event") {
      items.push({ kind: "event", key: `event-${entry.event.id}`, event: entry.event });
      last = null;
      continue;
    }
    const { message } = entry;
    const continued = last !== null && last.authorId === message.author.userId && entry.at - last.at < GROUP_GAP_MS;
    items.push({ kind: "message", key: `message-${message.messageId}`, message, continued });
    last = { authorId: message.author.userId, at: entry.at };
  }
  return items;
}

/** Adds newer messages to a list, replacing any it already holds by Discord id: an edit or a delete comes back as the same message. */
export function mergeMessages(current: readonly TicketMessageDto[], incoming: readonly TicketMessageDto[]): TicketMessageDto[] {
  if (incoming.length === 0) return [...current];
  const byId = new Map(current.map((message) => [message.messageId, message]));
  for (const message of incoming) byId.set(message.messageId, message);
  return [...byId.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id);
}

/** A day as UTC, which is what the server renders before the reader's own zone is known. */
export function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

/** The sentence a screen reader hears when new messages arrive while a ticket is open. */
export function arrivalAnnouncement(messages: readonly TicketMessageDto[], viewerId: string): string {
  const others = messages.filter((message) => message.author.userId !== viewerId && message.deletedAt === null);
  if (others.length === 0) return "";
  if (others.length === 1) return `New message from ${others[0]!.author.name}.`;
  const names = [...new Set(others.map((message) => message.author.name))];
  return names.length === 1 ? `${others.length} new messages from ${names[0]}.` : `${others.length} new messages.`;
}

export type RemovalNotice =
  | { kind: "deleted"; by: string | null; at: string }
  | { kind: "pruned"; at: string | null };

/**
 * Why a closed ticket has no messages left, for the line that says so. A
 * manager's deletion names who and when; the retention period is named only
 * when it really was the cause. A bot older than this dashboard says only
 * that the messages went, which reads as retention, as it always did.
 */
export function removalNotice(
  ticket: Pick<TicketDetailDto, "transcript" | "closedAt">,
  page: Pick<TicketMessagesPage, "pruned" | "removal">,
): RemovalNotice | null {
  const removal = ticket.transcript?.removal ?? page.removal ?? null;
  if (removal?.kind === "deleted") return { kind: "deleted", by: removal.by?.name.trim() || null, at: removal.at };
  if (removal?.kind === "pruned") return { kind: "pruned", at: removal.at };
  if (page.pruned && ticket.closedAt) return { kind: "pruned", at: null };
  return null;
}

/** Whether a closed ticket's transcript holds nothing, so its downloads would be empty files. */
export function transcriptIsEmpty(ticket: Pick<TicketDetailDto, "transcript">, page: Pick<TicketMessagesPage, "items" | "pruned">): boolean {
  if (ticket.transcript) return ticket.transcript.messages === 0;
  return page.pruned && page.items.length === 0;
}

/** The toast after a transcript is deleted, saying how much went. `number` is the one people see. */
export function transcriptDeletedText(number: number, result: TicketTranscriptDeleteResult): string {
  const count = typeof result.deleted === "number" && Number.isFinite(result.deleted) ? result.deleted : 0;
  return `Transcript of #${number} deleted: ${count} ${count === 1 ? "message" : "messages"} removed`;
}

/** Whether the search box is in use, so a change of address must not overwrite what is in it. */
export function searchIsBusy(focused: boolean, debouncing: boolean): boolean {
  return focused || debouncing;
}

/**
 * Display names of everyone the ticket already knows: who wrote in it, its
 * opener, who claimed or closed it, and its members. Used to show a mention
 * by name without asking Discord for anyone.
 */
export function knownNames(
  messages: readonly Pick<TicketMessageDto, "author">[],
  ticket: {
    opener: { userId: string; name: string | null };
    claimedBy: { userId: string; name: string | null } | null;
    closedBy?: { userId: string; name: string } | null;
    members?: readonly { user: { userId: string; name: string | null } }[];
  },
): Map<string, string> {
  const names = new Map<string, string>();
  const put = (userId: string, name: string | null | undefined) => {
    if (name && name.trim() !== "") names.set(userId, name);
  };
  for (const message of messages) put(message.author.userId, message.author.name);
  for (const member of ticket.members ?? []) put(member.user.userId, member.user.name);
  if (ticket.closedBy) put(ticket.closedBy.userId, ticket.closedBy.name);
  if (ticket.claimedBy) put(ticket.claimedBy.userId, ticket.claimedBy.name);
  put(ticket.opener.userId, ticket.opener.name);
  return names;
}

// -- transcript view --------------------------------------------------------

/** What happened to a ticket, worded, for the transcript's "Show ticket activity" switch. */
export function transcriptActivity(events: readonly TicketEventDto[]): TranscriptActivity[] {
  return events.map((event) => {
    const line = eventLine(event);
    return { key: `event-${event.id}`, at: event.createdAt, text: line.text, detail: line.detail, kind: event.kind };
  });
}

/** The line beside the channel's name, worded as the downloaded transcript words it. */
export function ticketTopic(ticket: Pick<TicketSummaryDto, "subject" | "typeName" | "opener">): string | null {
  return transcriptTopic(ticket.opener.name, ticket.subject, ticket.typeName);
}

/** Where a ticket's transcript is read. One address for the archive and for the inbox's link to it. */
export function transcriptPageHref(guildId: string, ticketId: number): string {
  return transcriptsHref(guildId, {}, ticketId);
}

export interface ArchiveRowAction {
  kind: "read" | "html" | "txt";
  label: string;
  href: string;
  /** Downloads a file rather than opening a page. */
  download: boolean;
}

/**
 * What a row of the transcript archive offers, in the order it shows them.
 * Reading comes first: when a row offered only its two downloads, the
 * transcript could not be found from the archive at all.
 */
export function archiveRowActions(guildId: string, ticketId: number, filters: Partial<TicketListFilters> = {}): ArchiveRowAction[] {
  const api = `/api/guilds/${encodeURIComponent(guildId)}/tickets/items/${ticketId}`;
  return [
    { kind: "read", label: "Read", href: transcriptsHref(guildId, filters, ticketId), download: false },
    { kind: "html", label: "Web page", href: `${api}/transcript.html`, download: true },
    { kind: "txt", label: "Text", href: `${api}/transcript.txt`, download: true },
  ];
}
