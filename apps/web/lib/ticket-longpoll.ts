/**
 * The loop behind the ticket pages that update as things happen. It asks the
 * dashboard to hold a request until something changes, applies the answer and
 * asks again at once. Free of React and of `fetch`, so the rules can be tested
 * on their own: when to ask, when to stop asking, how to back off, and when to
 * give up on holding requests and go back to asking on a timer.
 */

/** Seconds a request asks the bot to hold it. The bot allows up to 25; this leaves room for slow links. */
export const WAIT_SECONDS = 20;

export const RETRY_START_MS = 1_000;
export const RETRY_MAX_MS = 10_000;
/** Failures in a row, after the first, that make the loop stop holding requests. */
export const FALLBACK_AFTER_FAILURES = 4;
/** An answer faster than this to a held request had nothing to wait for. */
export const QUICK_MS = 200;
/** Quick answers in a row that mean the bot is not holding requests at all. */
export const QUICK_LIMIT = 10;
/** How long the loop asks on a timer after giving up on holding requests, before it tries holding again. */
export const FALLBACK_HOLD_MS = 60_000;

/** How long to wait before the retry after `failures` failures in a row: 1 s, 2 s, 4 s, then 10 s. */
export function retryDelay(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(RETRY_START_MS * 2 ** (failures - 1), RETRY_MAX_MS);
}

/**
 * What one request came to. `aborted` is not a failure: the loop aborts a
 * request itself when the tab is hidden, and goes round again.
 */
export type PollOutcome = "ok" | "error" | "aborted" | "stop";

export interface LongPollOptions {
  /** One request. `wait` is the seconds the bot may hold it, 0 for an answer at once. */
  poll(request: { signal: AbortSignal; wait: number }): Promise<PollOutcome>;
  visible(): boolean;
  /** How often to ask on a timer, once holding requests has been given up on. */
  intervalMs: number;
  /** While the tab is hidden: how often to ask anyway, or null to ask nothing until it is shown again. */
  hiddenIntervalMs?(): number | null;
  /** Replaces the clock, for the tests. */
  now?(): number;
  /** Replaces the backoff, for the tests. */
  delay?(failures: number): number;
  onMode?(mode: "wait" | "interval"): void;
}

export interface LongPoll {
  stop(): void;
  /** Call when the tab is shown or hidden. */
  visibilityChanged(): void;
  mode(): "wait" | "interval";
}

export function startLongPoll(options: LongPollOptions): LongPoll {
  const root = new AbortController();
  const now = options.now ?? Date.now;
  const delay = options.delay ?? retryDelay;
  let inflight: AbortController | null = null;
  let wake: (() => void) | null = null;
  let failures = 0;
  let quick = 0;
  let intervalUntil = 0;
  let reported: "wait" | "interval" = "wait";

  const mode = (): "wait" | "interval" => (now() < intervalUntil ? "interval" : "wait");
  const report = () => {
    const current = mode();
    if (current !== reported) {
      reported = current;
      options.onMode?.(current);
    }
  };

  /** Sleeps for `ms`, or until something wakes the loop. Infinity sleeps until woken. */
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      if (root.signal.aborted) return resolve();
      const timer = Number.isFinite(ms) ? setTimeout(done, ms) : undefined;
      function done() {
        if (timer !== undefined) clearTimeout(timer);
        wake = null;
        root.signal.removeEventListener("abort", done);
        resolve();
      }
      wake = done;
      root.signal.addEventListener("abort", done, { once: true });
    });

  async function run(): Promise<void> {
    while (!root.signal.aborted) {
      let wait = WAIT_SECONDS;
      let spacing = 0;
      if (!options.visible()) {
        const hidden = options.hiddenIntervalMs?.() ?? null;
        if (hidden === null) {
          await sleep(Infinity);
          continue;
        }
        wait = 0;
        spacing = hidden;
      } else if (mode() === "interval") {
        wait = 0;
        spacing = options.intervalMs;
      }
      report();

      const controller = new AbortController();
      inflight = controller;
      const started = now();
      let outcome: PollOutcome;
      try {
        outcome = await options.poll({ signal: controller.signal, wait });
      } catch {
        outcome = "error";
      }
      inflight = null;
      if (root.signal.aborted || outcome === "stop") return;
      if (outcome === "aborted") continue;

      if (outcome === "ok") {
        failures = 0;
        if (wait > 0) {
          quick = now() - started < QUICK_MS ? quick + 1 : 0;
          if (quick >= QUICK_LIMIT) {
            quick = 0;
            intervalUntil = now() + FALLBACK_HOLD_MS;
          }
        }
        if (spacing > 0) await sleep(spacing);
        continue;
      }

      failures += 1;
      if (wait > 0 && failures > FALLBACK_AFTER_FAILURES) {
        failures = 0;
        intervalUntil = now() + FALLBACK_HOLD_MS;
        await sleep(spacing > 0 ? spacing : options.intervalMs);
        continue;
      }
      await sleep(Math.max(spacing, delay(failures)));
    }
  }

  void run();

  return {
    stop() {
      root.abort();
      inflight?.abort();
    },
    visibilityChanged() {
      if (!options.visible()) inflight?.abort();
      wake?.();
    },
    mode,
  };
}
