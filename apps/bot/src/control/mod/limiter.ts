/**
 * A sliding-window counter keyed by whoever is being limited. It lives in
 * memory on purpose: the limit exists to stop a runaway client or a stuck
 * retry loop from filling the database, not to meter anyone, so losing the
 * counts on a restart is fine. The clock is a parameter so tests need no timers.
 */

export interface LimiterOptions {
  /** Most calls allowed inside one window. */
  limit: number;
  windowMs: number;
  now?: () => number;
}

export type Take = { ok: true } | { ok: false; retryAfterMs: number };

export interface Limiter {
  /** Counts one call for `key` and says whether it fits. A refused call is not counted. */
  take(key: string): Take;
  /** How many keys are being tracked; exposed so a test can check memory stays bounded. */
  size(): number;
}

const SWEEP_ABOVE = 1000;

export function createLimiter({ limit, windowMs, now = Date.now }: LimiterOptions): Limiter {
  const hits = new Map<string, number[]>();

  const live = (times: number[], at: number): number[] => {
    const cutoff = at - windowMs;
    let first = 0;
    while (first < times.length && times[first]! <= cutoff) first++;
    return first === 0 ? times : times.slice(first);
  };

  return {
    take(key) {
      const at = now();
      if (hits.size > SWEEP_ABOVE) {
        for (const [other, times] of hits) {
          const kept = live(times, at);
          if (kept.length === 0) hits.delete(other);
          else hits.set(other, kept);
        }
      }

      const times = live(hits.get(key) ?? [], at);
      if (times.length >= limit) {
        hits.set(key, times);
        return { ok: false, retryAfterMs: Math.max(1, times[0]! + windowMs - at) };
      }
      times.push(at);
      hits.set(key, times);
      return { ok: true };
    },
    size: () => hits.size,
  };
}
