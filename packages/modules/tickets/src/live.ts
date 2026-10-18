/**
 * An in-process change notifier for tickets, so the dashboard's long polls can
 * answer the moment something moves instead of on the next interval.
 *
 * Every change takes the next number from one counter, which is what makes the
 * versions work: a ticket's version is the number of its latest change, a
 * guild's is the number of the latest change to any of its tickets, and both
 * only grow. A waiter names the version it has already seen and is woken by
 * anything higher, so a change made between one poll and the next is still
 * seen. The counter starts at the clock rather than at zero, so a version a
 * browser kept from before a restart is never ahead of the new process.
 *
 * Nothing here is stored. A restart forgets every version, which at worst
 * makes one poll answer early.
 */

/**
 * What changed. `message` is a message stored, edited or deleted. `detail` is
 * anything the ticket's side panel shows: a claim, priority, note, member,
 * move, rename, close or reopen. `activity` only moves counts in the inbox,
 * and `opened` is a new ticket.
 */
export type TicketChangeKind = "message" | "detail" | "activity" | "opened";

let clock = Date.now();

interface Entry {
  version: number;
  detail: number;
  guildId: string;
  touched: number;
}

interface Waiter {
  after: number;
  wake(version: number): void;
}

const tickets = new Map<number, Entry>();
const guildVersions = new Map<string, number>();
const ticketWaiters = new Map<number, Set<Waiter>>();
const guildWaiters = new Map<string, Set<Waiter>>();

/** Entries kept before the oldest idle ones are dropped. A dropped ticket reads as version 0 until it changes again. */
const KEEP_TICKETS = 5_000;

function prune(): void {
  if (tickets.size <= KEEP_TICKETS) return;
  const idle = [...tickets].filter(([id]) => !ticketWaiters.has(id)).sort((a, b) => a[1].touched - b[1].touched);
  for (const [id] of idle.slice(0, tickets.size - KEEP_TICKETS + 500)) tickets.delete(id);
}

function wakeAll(waiters: Set<Waiter> | undefined, version: number): void {
  if (!waiters) return;
  for (const waiter of [...waiters]) if (version > waiter.after) waiter.wake(version);
}

/** Records a change to a ticket and wakes whoever is waiting on it or on its server's inbox. */
export function notifyTicket(guildId: string, ticketId: number, kind: TicketChangeKind): void {
  clock += 1;
  const version = clock;
  const entry = tickets.get(ticketId) ?? { version: 0, detail: 0, guildId, touched: 0 };
  entry.guildId = guildId;
  entry.touched = version;
  if (kind === "message" || kind === "detail") entry.version = version;
  if (kind === "detail") entry.detail = version;
  tickets.set(ticketId, entry);
  guildVersions.set(guildId, version);
  if (kind === "message" || kind === "detail") wakeAll(ticketWaiters.get(ticketId), version);
  wakeAll(guildWaiters.get(guildId), version);
  prune();
}

/** The server a ticket was last seen changing in, or undefined when this process has not seen it change. */
export function guildOfTicket(ticketId: number): string | undefined {
  return tickets.get(ticketId)?.guildId;
}

/** The version of a ticket's latest message or detail change; 0 when it has none since the bot started. */
export function ticketVersion(ticketId: number): number {
  return tickets.get(ticketId)?.version ?? 0;
}

/** The version of the latest change to what the ticket's side panel shows. */
export function ticketDetailVersion(ticketId: number): number {
  return tickets.get(ticketId)?.detail ?? 0;
}

/** The version of the latest change to any ticket of a server. */
export function inboxVersion(guildId: string): number {
  return guildVersions.get(guildId) ?? 0;
}

function waitOn<K>(waiters: Map<K, Set<Waiter>>, key: K, current: () => number, after: number, timeoutMs: number, signal?: AbortSignal): Promise<number> {
  if (current() > after || signal?.aborted) return Promise.resolve(current());
  return new Promise((resolve) => {
    const set = waiters.get(key) ?? new Set<Waiter>();
    waiters.set(key, set);
    const waiter: Waiter = {
      after,
      wake: (version) => {
        finish();
        resolve(version);
      },
    };
    const onAbort = () => {
      finish();
      resolve(current());
    };
    function finish(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      set.delete(waiter);
      if (set.size === 0 && waiters.get(key) === set) waiters.delete(key);
    }
    const timer = setTimeout(() => {
      finish();
      resolve(current());
    }, Math.max(0, timeoutMs));
    timer.unref?.();
    set.add(waiter);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Resolves with the ticket's version as soon as it is higher than `afterVersion`,
 * at once if it already is, and otherwise when the time runs out or the signal
 * aborts, with the version unchanged. Compare the result with `afterVersion`
 * to tell which happened.
 */
export function waitForTicket(guildId: string, ticketId: number, afterVersion: number, timeoutMs: number, signal?: AbortSignal): Promise<number> {
  void guildId;
  return waitOn(ticketWaiters, ticketId, () => ticketVersion(ticketId), afterVersion, timeoutMs, signal);
}

/** The same for a server's inbox: resolves when any of its tickets changes. */
export function waitForInbox(guildId: string, afterVersion: number, timeoutMs: number, signal?: AbortSignal): Promise<number> {
  return waitOn(guildWaiters, guildId, () => inboxVersion(guildId), afterVersion, timeoutMs, signal);
}

/** Waits held right now, for the tests and for anyone watching the bot. */
export function pendingWaits(): { tickets: number; inboxes: number } {
  let tickets = 0;
  let inboxes = 0;
  for (const set of ticketWaiters.values()) tickets += set.size;
  for (const set of guildWaiters.values()) inboxes += set.size;
  return { tickets, inboxes };
}

/** Most waits one person may hold open at once, across every tab they have. */
export const WAITS_PER_VIEWER = 6;
/** Most waits one server may hold open at once, so a crowd of viewers cannot tie up the bot. */
export const WAITS_PER_GUILD = 120;

const heldByViewer = new Map<string, number>();
const heldByGuild = new Map<string, number>();

function bump(map: Map<string, number>, key: string, by: number): void {
  const next = (map.get(key) ?? 0) + by;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
}

/**
 * Takes a place among the waits a viewer and a server may hold. Returns the
 * function that gives it back, or null when either limit is reached. Giving
 * back twice is harmless.
 */
export function acquireWait(guildId: string, viewerId: string, limits: { viewer?: number; guild?: number } = {}): (() => void) | null {
  const viewerKey = `${guildId}:${viewerId}`;
  if ((heldByViewer.get(viewerKey) ?? 0) >= (limits.viewer ?? WAITS_PER_VIEWER)) return null;
  if ((heldByGuild.get(guildId) ?? 0) >= (limits.guild ?? WAITS_PER_GUILD)) return null;
  bump(heldByViewer, viewerKey, 1);
  bump(heldByGuild, guildId, 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    bump(heldByViewer, viewerKey, -1);
    bump(heldByGuild, guildId, -1);
  };
}

/** How many places are taken, per server and in all. */
export function heldWaits(guildId?: string): number {
  if (guildId !== undefined) return heldByGuild.get(guildId) ?? 0;
  let total = 0;
  for (const count of heldByGuild.values()) total += count;
  return total;
}
