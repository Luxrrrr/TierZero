/**
 * A small cache whose entries expire after a fixed time, for answers that may be
 * a few seconds old, such as the public leaderboard. Free of Next imports so the
 * tests can reach it.
 */
export interface TimedCache<T> {
  get(key: string, now?: number): T | undefined;
  set(key: string, value: T, now?: number): void;
}

export function createTimedCache<T>(options: { ttlMs: number; maxEntries: number }): TimedCache<T> {
  const entries = new Map<string, { value: T; until: number }>();
  return {
    get(key, now = Date.now()) {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (hit.until <= now) {
        entries.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value, now = Date.now()) {
      if (!entries.has(key) && entries.size >= options.maxEntries) {
        // Anything expired goes first. If that frees nothing, the oldest goes.
        for (const [other, entry] of entries) if (entry.until <= now) entries.delete(other);
        if (entries.size >= options.maxEntries) {
          const oldest = entries.keys().next().value;
          if (oldest !== undefined) entries.delete(oldest);
        }
      }
      entries.set(key, { value, until: now + options.ttlMs });
    },
  };
}
