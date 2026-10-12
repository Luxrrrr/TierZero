import type { Prisma } from "@tier0/db";
import { MESSAGE_LOG_STATES, type MessageLogState } from "@tier0/core";

const SNOWFLAKE = /^\d{17,20}$/;
const SEARCH_MAX = 200;

export function parseLogState(value: string | null): MessageLogState {
  return MESSAGE_LOG_STATES.find((state) => state === value) ?? "all";
}

const dateOf = (value: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * The filter for the message log, built from the query string. `readable` is
 * the channels the viewer can open in Discord, or null for someone who can see
 * everything the bot logged. A message in any other channel is never returned,
 * so the log cannot be used to read a channel the person has no access to.
 */
export function messageLogWhere(guildId: string, query: URLSearchParams, readable: readonly string[] | null): Prisma.LoggedMessageWhereInput {
  const and: Prisma.LoggedMessageWhereInput[] = [];

  const text = (query.get("q") ?? "").trim().slice(0, SEARCH_MAX);
  // Any version counts, so a message can be found by what it said before it was edited.
  if (text) and.push({ OR: [{ content: { contains: text } }, { edits: { some: { content: { contains: text } } } }] });

  const author = (query.get("author") ?? "").trim().slice(0, 100);
  if (author) and.push(SNOWFLAKE.test(author) ? { authorId: author } : { authorName: { contains: author } });

  // One message, for a link from a server log entry to what the message said.
  const message = query.get("message") ?? "";
  if (SNOWFLAKE.test(message)) and.push({ messageId: message });

  const channel = query.get("channel") ?? "";
  if (SNOWFLAKE.test(channel)) and.push({ channelId: channel });

  const since = dateOf(query.get("since"));
  const until = dateOf(query.get("until"));
  if (since || until) and.push({ createdAt: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } });

  const state = parseLogState(query.get("state"));
  if (state === "deleted") and.push({ deletedAt: { not: null } });
  if (state === "edited") and.push({ editedAt: { not: null } });

  if (readable !== null) and.push({ channelId: { in: [...readable] } });

  return { guildId, AND: and };
}
