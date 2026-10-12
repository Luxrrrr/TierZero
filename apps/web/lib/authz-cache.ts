/**
 * The cache in front of Discord's /users/@me/guilds, as pure functions over
 * one user's entry so the timing rules can be tested without Discord.
 *
 * Three windows matter. A good answer is reused for a minute. A failure is
 * remembered for 30 seconds, so a page that runs the check several times does
 * not send Discord a burst of requests it has already refused. While Discord
 * is failing, the last good answer keeps being used for at most 15 minutes;
 * after that the failure stands and access is denied, because a grant that
 * nobody can confirm should not last indefinitely. When Discord says how long
 * to wait, the failure is remembered for that long instead, since asking again
 * sooner only extends the limit.
 */

export const AUTHZ_FRESH_MS = 60_000;
export const AUTHZ_FAILURE_MS = 30_000;
export const AUTHZ_STALE_MAX_MS = 15 * 60_000;
/** Longest we will stay quiet because Discord asked us to, whatever it said. */
export const AUTHZ_BACKOFF_MAX_MS = 5 * 60_000;

export interface AuthzCacheEntry {
  good: { guildIds: Set<string>; at: number } | null;
  failure: { error: unknown; until: number } | null;
}

export type AuthzCacheRead =
  | { kind: "use"; guildIds: Set<string>; stale: boolean }
  | { kind: "fail"; error: unknown }
  | { kind: "fetch" };

function staleGood(entry: AuthzCacheEntry, now: number): Set<string> | null {
  if (!entry.good) return null;
  return now - entry.good.at <= AUTHZ_STALE_MAX_MS ? entry.good.guildIds : null;
}

/** What to do before asking Discord: use the cache, repeat a recent failure, or fetch. */
export function readAuthzCache(entry: AuthzCacheEntry | undefined, now: number): AuthzCacheRead {
  if (!entry) return { kind: "fetch" };

  if (entry.good && now - entry.good.at < AUTHZ_FRESH_MS) {
    return { kind: "use", guildIds: entry.good.guildIds, stale: false };
  }

  if (entry.failure && now < entry.failure.until) {
    const fallback = staleGood(entry, now);
    return fallback ? { kind: "use", guildIds: fallback, stale: true } : { kind: "fail", error: entry.failure.error };
  }

  return { kind: "fetch" };
}

export function recordAuthzSuccess(guildIds: Set<string>, now: number): AuthzCacheEntry {
  return { good: { guildIds, at: now }, failure: null };
}

export function recordAuthzFailure(entry: AuthzCacheEntry | undefined, error: unknown, now: number): AuthzCacheEntry {
  const asked = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs;
  const wait =
    typeof asked === "number" ? Math.min(Math.max(asked, AUTHZ_FAILURE_MS), AUTHZ_BACKOFF_MAX_MS) : AUTHZ_FAILURE_MS;
  return { good: entry?.good ?? null, failure: { error, until: now + wait } };
}

/** What a caller gets right after a failed fetch: the stale answer if one is young enough, else the error. */
export function afterAuthzFailure(entry: AuthzCacheEntry, now: number): AuthzCacheRead {
  const fallback = staleGood(entry, now);
  return fallback
    ? { kind: "use", guildIds: fallback, stale: true }
    : { kind: "fail", error: entry.failure?.error };
}

/**
 * Whether a failure means "could not find out" rather than "was told no". The
 * stale answer may stand in for the first kind only: a 429, a server error or a
 * network failure says nothing about the user, but a 400, 401 or 403 means the
 * token was revoked or refused, and an old grant must not outlive that.
 */
export function isTransientFailure(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== "number") return true;
  return status === 429 || status >= 500;
}
