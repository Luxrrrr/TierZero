import type { TicketCountDto, TicketListFilters } from "@tier0/core";

/**
 * What keeps the inbox list current without reloading it under the reader:
 * the cheap count is asked every so often, and compared with what the list
 * showed when it was drawn. Free of React so the tests can import it.
 */

export const LIVE_POLL_MS = 15_000;
/** While desktop alerts are on, a tab in the background still asks, less often. */
export const LIVE_HIDDEN_POLL_MS = 60_000;

/** The count as it was when the list on screen was drawn. */
export interface LiveBaseline {
  latestId: number | null;
  latestActivityAt: string | null;
  total: number;
  awaitingStaff: number;
}

export function baselineOf(count: TicketCountDto): LiveBaseline {
  return { latestId: count.latestId, latestActivityAt: count.latestActivityAt, total: count.total, awaitingStaff: count.awaitingStaff };
}

export type LiveChange =
  /** Tickets opened since the list was drawn. */
  | { kind: "new"; count: number }
  /** The same tickets, but something moved: a message, a close, a claim elsewhere. */
  | { kind: "activity" }
  | { kind: "none" };

/**
 * How the list on screen differs from the latest count. `count` is the answer
 * to a count that named the baseline's `latestId` as `after`, so `newCount` is
 * already the tickets opened since; with no baseline id every ticket is new.
 */
export function liveChange(base: LiveBaseline, count: TicketCountDto): LiveChange {
  const fresh = base.latestId === null ? count.total : count.newCount;
  if (fresh > 0) return { kind: "new", count: fresh };
  if (count.total !== base.total || count.latestActivityAt !== base.latestActivityAt || count.awaitingStaff !== base.awaitingStaff) {
    return { kind: "activity" };
  }
  return { kind: "none" };
}

/** The filters a count asks with: the list's own, without the page, which a count has no use for. */
export function countFilters(filters: TicketListFilters, base: LiveBaseline | null): Partial<TicketListFilters> {
  return { ...filters, page: 1, afterId: base?.latestId ?? null };
}

/** The words on the button that brings the list up to date. */
export function livePillText(change: LiveChange): string | null {
  if (change.kind === "new") return change.count === 1 ? "1 new ticket" : `${change.count.toLocaleString("en")} new tickets`;
  if (change.kind === "activity") return "New activity";
  return null;
}

/** What a screen reader hears when the pill appears. */
export function liveAnnouncement(change: LiveChange): string {
  if (change.kind === "new") {
    return `${change.count === 1 ? "A new ticket was" : `${change.count} new tickets were`} opened. Use the button above the list to show ${change.count === 1 ? "it" : "them"}.`;
  }
  if (change.kind === "activity") return "Tickets in this list have new activity.";
  return "";
}

const BADGE = /^\(\d+\+?\) /;

/** The page title with how many tickets wait on staff in front, as mail tabs do, or the plain title when none do. */
export function titleWithBadge(title: string, waiting: number): string {
  const plain = title.replace(BADGE, "");
  if (waiting <= 0) return plain;
  return `(${waiting > 99 ? "99+" : waiting}) ${plain}`;
}

/** Tickets opened since the poll before, from two answers counted against the same baseline. */
export function newSincePrevious(before: LiveChange, now: LiveChange): number {
  const was = before.kind === "new" ? before.count : 0;
  const is = now.kind === "new" ? now.count : 0;
  return Math.max(0, is - was);
}

/**
 * The words of a desktop alert, or null when nothing is worth one. Only what
 * changed since the poll before counts, so one ticket is announced once.
 */
export function alertText(opened: number, waitingBefore: number, waitingNow: number): { title: string; body: string } | null {
  if (opened > 0) {
    return {
      title: opened === 1 ? "New ticket" : `${opened} new tickets`,
      body: "Open the inbox to read and answer.",
    };
  }
  const waitingMore = waitingNow - waitingBefore;
  if (waitingMore > 0) {
    return {
      title: waitingMore === 1 ? "A ticket is waiting on staff" : `${waitingMore} more tickets are waiting on staff`,
      body: "A member wrote and nobody has answered yet.",
    };
  }
  return null;
}

/** Where the choice to get desktop alerts is remembered, per server, in this browser only. */
export function alertsKey(guildId: string): string {
  return `tier0:tickets:alerts:${guildId}`;
}
