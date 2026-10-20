import type { Prisma } from "@tier0/db";
import { isServerLogCategory, isServerLogType } from "@tier0/shared-moderation";

const SNOWFLAKE = /^\d{17,20}$/;
const SEARCH_MAX = 200;

const dateOf = (value: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** A comma separated list from the query string, with anything unknown dropped. */
const listOf = (value: string | null, keep: (item: string) => boolean): string[] =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "" && keep(item));

/**
 * The filter for the server log, built from the query string. `readable` is the
 * channels the viewer can open in Discord, or null for someone who can see
 * everything. An entry that happened in a channel the viewer cannot open is
 * never returned, so the log cannot be used to read around a private channel.
 * Entries that are not about a channel, such as a member joining, are open to all.
 *
 * `withCategory` leaves the category filter out, which is how the category chips
 * get a count for each category under the other filters.
 */
export function serverLogWhere(
  guildId: string,
  query: URLSearchParams,
  readable: readonly string[] | null,
  withCategory = true,
): Prisma.ServerLogEntryWhereInput {
  const and: Prisma.ServerLogEntryWhereInput[] = [];

  const text = (query.get("q") ?? "").trim().slice(0, SEARCH_MAX);
  if (text) {
    and.push({
      OR: [
        { summary: { contains: text } },
        { actorName: { contains: text } },
        { targetName: { contains: text } },
        { channelName: { contains: text } },
        // The text of an edit or deletion, and the lines under an entry, are inside the details.
        { details: { contains: text } },
      ],
    });
  }

  if (withCategory) {
    const categories = listOf(query.get("category"), isServerLogCategory);
    if (categories.length > 0) and.push({ category: { in: categories } });
  }
  const types = listOf(query.get("type"), isServerLogType);
  if (types.length > 0) and.push({ type: { in: types } });

  // One box for a person: an id matches them as the one who did it or the one it happened to, a name matches either.
  const member = (query.get("member") ?? "").trim().slice(0, 100);
  if (member) {
    and.push(
      SNOWFLAKE.test(member)
        ? { OR: [{ actorId: member }, { targetId: member }] }
        : { OR: [{ actorName: { contains: member } }, { targetName: { contains: member } }] },
    );
  }

  const channel = query.get("channel") ?? "";
  if (SNOWFLAKE.test(channel)) and.push({ channelId: channel });

  const since = dateOf(query.get("since"));
  const until = dateOf(query.get("until"));
  if (since || until) and.push({ at: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } });

  if (readable !== null) and.push({ OR: [{ channelId: null }, { channelId: { in: [...readable] } }] });

  return { guildId, AND: and };
}

/**
 * Whether a server log entry's actor is shown as Automod. The bot's account does work for every feature, so it
 * is Automod only for what an automod rule did, which the log knows for deleted messages.
 */
export function actsAsAutomod(actorId: string | null, botId: string | null, deletedBy: string | undefined): boolean {
  return actorId !== null && actorId === botId && deletedBy === "automod";
}
