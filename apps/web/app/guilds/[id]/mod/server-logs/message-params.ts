import { MESSAGE_LOG_STATES, type MessageLogState } from "@tier0/shared-moderation";

/**
 * Query handling for the message log tab, kept free of React so the rules can
 * be tested alone.
 */

export const MESSAGE_LOG_PAGE_SIZE = 40;

export interface MessageLogQuery {
  q: string;
  /** A member's id, or part of their name. */
  author: string;
  /** One message, from a link in a server log entry. */
  message: string;
  channel: string;
  /** Calendar days as YYYY-MM-DD, or empty. */
  since: string;
  until: string;
  state: MessageLogState;
  page: number;
}

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] : value) ?? "";
const SNOWFLAKE = /^\d{17,20}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function validDay(value: string): string {
  if (!DAY.test(value)) return "";
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? "" : value;
}

/** Anything unrecognised falls back to the defaults, so a hand-edited address never errors. */
export function parseMessageLogQuery(raw: RawParams): MessageLogQuery {
  const channel = first(raw.channel).trim();
  const state = first(raw.state);
  const pageNumber = Number.parseInt(first(raw.page), 10);
  let since = validDay(first(raw.since).trim());
  let until = validDay(first(raw.until).trim());
  if (since && until && since > until) [since, until] = [until, since];
  return {
    q: first(raw.q).trim().slice(0, 200),
    author: first(raw.author).trim().slice(0, 100),
    message: SNOWFLAKE.test(first(raw.message).trim()) ? first(raw.message).trim() : "",
    channel: SNOWFLAKE.test(channel) ? channel : "",
    since,
    until,
    state: MESSAGE_LOG_STATES.find((s) => s === state) ?? "all",
    page: Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1,
  };
}

/** The start of `since` and the last millisecond of `until`, so choosing one day shows that whole day. */
export function messageLogApiParams(query: MessageLogQuery) {
  return {
    q: query.q || undefined,
    author: query.author || undefined,
    message: query.message || undefined,
    channel: query.channel || undefined,
    since: query.since ? `${query.since}T00:00:00.000Z` : undefined,
    until: query.until ? `${query.until}T23:59:59.999Z` : undefined,
    state: query.state === "all" ? undefined : query.state,
    page: query.page,
    pageSize: MESSAGE_LOG_PAGE_SIZE,
  };
}

export function messageLogHref(guildId: string, query: Partial<MessageLogQuery>): string {
  const search = new URLSearchParams();
  if (query.q) search.set("q", query.q);
  if (query.author) search.set("author", query.author);
  if (query.channel) search.set("channel", query.channel);
  if (query.since) search.set("since", query.since);
  if (query.until) search.set("until", query.until);
  if (query.state && query.state !== "all") search.set("state", query.state);
  if (query.message) search.set("message", query.message);
  if (query.page && query.page > 1) search.set("page", String(query.page));
  const text = search.toString();
  return `/guilds/${guildId}/mod/server-logs?view=messages${text ? `&${text}` : ""}`;
}

export function hasMessageLogFilters(query: MessageLogQuery): boolean {
  return Boolean(query.q || query.author || query.message || query.channel || query.since || query.until || query.state !== "all");
}
