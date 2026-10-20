import { SERVER_LOG_CATEGORIES, SERVER_LOG_CATEGORY_IDS, isServerLogType, type ServerLogCategoryId } from "@tier0/shared-moderation";

/**
 * Query handling for the events view of Server logs, kept free of React so the
 * rules can be tested on their own. Everything a filter can be is in the address,
 * so a filtered view can be bookmarked or sent to another moderator.
 */

export const SERVER_LOG_PAGE_SIZE = 40;

export type ServerLogView = "events" | "messages";

export interface ServerLogQuery {
  q: string;
  category: ServerLogCategoryId[];
  type: string[];
  /** A member's id, or part of their name. Matches who did it and who it happened to. */
  member: string;
  channel: string;
  /** Calendar days as YYYY-MM-DD, or empty. */
  since: string;
  until: string;
  page: number;
}

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] : value) ?? "";
const SNOWFLAKE = /^\d{17,20}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseView(raw: RawParams): ServerLogView {
  return first(raw.view) === "messages" ? "messages" : "events";
}

function validDay(value: string): string {
  if (!DAY.test(value)) return "";
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? "" : value;
}

const listOf = (value: string): string[] => value.split(",").map((item) => item.trim()).filter(Boolean);

/** Anything unrecognised falls back to the defaults, so a hand-edited address never errors. */
export function parseServerLogQuery(raw: RawParams): ServerLogQuery {
  const channel = first(raw.channel).trim();
  const pageNumber = Number.parseInt(first(raw.page), 10);
  let since = validDay(first(raw.since).trim());
  let until = validDay(first(raw.until).trim());
  if (since && until && since > until) [since, until] = [until, since];
  return {
    q: first(raw.q).trim().slice(0, 200),
    category: listOf(first(raw.category)).filter((c): c is ServerLogCategoryId => SERVER_LOG_CATEGORY_IDS.includes(c as ServerLogCategoryId)),
    type: listOf(first(raw.type)).filter(isServerLogType),
    member: first(raw.member).trim().slice(0, 100),
    channel: SNOWFLAKE.test(channel) ? channel : "",
    since,
    until,
    page: Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1,
  };
}

/** The start of `since` and the last millisecond of `until`, so choosing one day shows that whole day. */
export function serverLogApiParams(query: ServerLogQuery) {
  return {
    q: query.q || undefined,
    category: query.category.length > 0 ? query.category.join(",") : undefined,
    type: query.type.length > 0 ? query.type.join(",") : undefined,
    member: query.member || undefined,
    channel: query.channel || undefined,
    since: query.since ? `${query.since}T00:00:00.000Z` : undefined,
    until: query.until ? `${query.until}T23:59:59.999Z` : undefined,
    page: query.page,
    pageSize: SERVER_LOG_PAGE_SIZE,
  };
}

export function serverLogHref(guildId: string, query: Partial<ServerLogQuery>): string {
  const search = new URLSearchParams();
  if (query.q) search.set("q", query.q);
  if (query.category && query.category.length > 0) search.set("category", query.category.join(","));
  if (query.type && query.type.length > 0) search.set("type", query.type.join(","));
  if (query.member) search.set("member", query.member);
  if (query.channel) search.set("channel", query.channel);
  if (query.since) search.set("since", query.since);
  if (query.until) search.set("until", query.until);
  if (query.page && query.page > 1) search.set("page", String(query.page));
  const text = search.toString();
  return `/guilds/${guildId}/mod/server-logs${text ? `?${text}` : ""}`;
}

export function hasServerLogFilters(query: ServerLogQuery): boolean {
  return Boolean(query.q || query.category.length > 0 || query.type.length > 0 || query.member || query.channel || query.since || query.until);
}

/** The calendar day `daysAgo` days before `now`, as YYYY-MM-DD in UTC. */
export function dayAgo(daysAgo: number, now: Date = new Date()): string {
  return new Date(now.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

/** Shortcuts for the date range, each as the `since` it sets. The range always runs up to now. */
export const QUICK_RANGES = [
  { id: "today", label: "Today", days: 0 },
  { id: "7d", label: "7 days", days: 6 },
  { id: "30d", label: "30 days", days: 29 },
] as const;

/** Which quick range the dates in the query are, if any. */
export function activeRange(query: Pick<ServerLogQuery, "since" | "until">, now: Date = new Date()): string | null {
  if (query.until) return null;
  const hit = QUICK_RANGES.find((range) => dayAgo(range.days, now) === query.since);
  return hit?.id ?? null;
}

/** One removable chip for every filter that is on, so what the list is narrowed by is always visible. */
export interface ActiveFilter {
  key: string;
  label: string;
  /** What to change in the query to take this filter off. */
  clear: Partial<ServerLogQuery>;
}

export function activeFilters(query: ServerLogQuery, channelName: (id: string) => string): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  const categoryLabel = (id: string) => SERVER_LOG_CATEGORIES.find((c) => c.id === id)?.label ?? id;
  if (query.q) out.push({ key: "q", label: `"${query.q}"`, clear: { q: "" } });
  for (const id of query.category) out.push({ key: `c-${id}`, label: categoryLabel(id), clear: { category: query.category.filter((c) => c !== id) } });
  for (const id of query.type) {
    const label = (SERVER_LOG_CATEGORIES as readonly { types: readonly { id: string; label: string }[] }[]).flatMap((c) => c.types).find((t) => t.id === id)?.label ?? id;
    out.push({ key: `t-${id}`, label, clear: { type: query.type.filter((t) => t !== id) } });
  }
  if (query.member) out.push({ key: "member", label: /^\d+$/.test(query.member) ? `Member ${query.member.slice(-4)}` : `Member "${query.member}"`, clear: { member: "" } });
  if (query.channel) out.push({ key: "channel", label: `#${channelName(query.channel)}`, clear: { channel: "" } });
  if (query.since || query.until) {
    const label = query.since && query.until ? (query.since === query.until ? query.since : `${query.since} to ${query.until}`) : query.since ? `From ${query.since}` : `Until ${query.until}`;
    out.push({ key: "dates", label, clear: { since: "", until: "" } });
  }
  return out;
}
