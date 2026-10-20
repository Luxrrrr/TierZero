import type { Ticket } from "@tier0/db";
import type { TicketListFilters, TicketMessagesPage } from "@tier0/shared-tickets";
import { messagesPage } from "./detail.js";
import { listWhere } from "./query.js";
import { countTickets } from "./reads.js";
import { acquireWait, inboxVersion, ticketDetailVersion, ticketVersion, waitForInbox, waitForTicket, type TicketSettings } from "./runtime.js";
import { fail, type Reply, type TicketEnv } from "./types.js";

/**
 * The two reads a dashboard page keeps asking, answered the moment something
 * changes rather than on the next interval. `wait` is how long the bot may
 * hold the request, in seconds; without it the read answers at once as before.
 *
 * The viewer has been let in before anything here runs, so a held request is
 * checked the same as any other. A hold takes one of the places each viewer
 * and each server have (see `acquireWait`); when none is free the answer is a
 * 429 and the page asks again a little later.
 */

export const TOO_MANY_WAITS = "This page is already waiting on several updates. Close other tabs of the dashboard, or try again in a moment.";
const CANCELLED = "The request was cancelled.";

/** What a wait leaves unchecked: this much of the time is not worth another read. */
const MIN_REMAINING_MS = 50;

/**
 * `GET items/:id/messages?wait=`. Answers when there is a new, edited or
 * deleted message, or when what the side panel shows changed since the
 * `known` detail version, or when the time is up with the usual, empty page.
 * Versions are read before the data is, so a change made while a read runs
 * is seen by the next one and never lost.
 */
export async function messagesAfterWait(
  env: TicketEnv,
  row: Ticket,
  read: { cursor: number | null; since: Date | null; transcripts: Pick<TicketSettings["transcripts"], "store" | "retentionDays"> },
  wait: { seconds: number; knownDetail: number | undefined },
): Promise<TicketMessagesPage | Reply> {
  const { signal } = env;
  const deadline = Date.now() + wait.seconds * 1000;
  const known = wait.knownDetail ?? ticketDetailVersion(row.id);
  let release: (() => void) | null = null;
  try {
    for (;;) {
      const seen = ticketVersion(row.id);
      const detailVersion = ticketDetailVersion(row.id);
      const page = await messagesPage(row, read.cursor, read.since, read.transcripts);
      const news = page.items.length > 0 || page.changed.length > 0 || detailVersion !== known;
      const remaining = deadline - Date.now();
      if (news || wait.seconds === 0 || remaining < MIN_REMAINING_MS || signal?.aborted) return { ...page, detailVersion };
      if (release === null) {
        release = acquireWait(env.guild.id, env.viewer.userId);
        if (release === null) return fail(429, TOO_MANY_WAITS);
      }
      await waitForTicket(env.guild.id, row.id, seen, remaining, signal);
    }
  } finally {
    release?.();
  }
}

/**
 * `GET count?wait=&version=`. `version` is the one the last answer carried;
 * the request is held until the server's version moves past it, and answers
 * at once when it already has. Without `version` it waits for the next change.
 */
export async function countAfterWait(
  env: TicketEnv,
  filters: TicketListFilters,
  wait: { seconds: number; knownVersion: number | undefined },
): Promise<Reply> {
  const guildId = env.guild.id;
  const at = inboxVersion(guildId);
  const denied = listWhere(guildId, { ...filters, afterId: null }, env.access) === null;
  if (wait.seconds === 0 || denied || (wait.knownVersion !== undefined && wait.knownVersion < at)) return countTickets(env, filters, at);
  const release = acquireWait(guildId, env.viewer.userId);
  if (release === null) return fail(429, TOO_MANY_WAITS);
  try {
    await waitForInbox(guildId, wait.knownVersion ?? at, wait.seconds * 1000, env.signal);
  } finally {
    release();
  }
  if (env.signal?.aborted) return fail(503, CANCELLED);
  return countTickets(env, filters, inboxVersion(guildId));
}
