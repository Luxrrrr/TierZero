import { normalizeOrigin } from "@tier0/core";
import { prisma } from "@tier0/db";

/**
 * The address links back to the dashboard are built from. Owners can type one
 * into the moderation settings; without it the bot uses the address the web app
 * last saw the owner open the dashboard at. Neither may exist yet on a fresh
 * install, and then links are simply left out.
 */

/** An http(s) origin with no trailing slash, path, query or login, or null when `value` is not a web address. */
export function normalizeDashboardUrl(value: unknown): string | null {
  return typeof value === "string" ? normalizeOrigin(value) : null;
}

/**
 * An address only the owner's own machine can open. A button that leads there is
 * no use to a moderator on another device, so the stored address (which is learned,
 * not typed) is not used for links while it is one of these. An address typed into
 * the moderation settings is the owner's decision and is used as given.
 */
export function isLocalOrigin(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "[::1]" || host === "::1" || /^127\./.test(host);
}

/** Short enough that a changed address shows up quickly, long enough that a burst of posts asks the database once. */
export const STORED_ADDRESS_TTL_MS = 30_000;

export interface DashboardUrlLookup {
  /** The configured address if it is a usable one, else the stored one unless it is local, else an empty string. */
  resolve(configured: unknown): Promise<string>;
  /** Forget the stored address, so the next lookup reads it again. */
  clear(): void;
}

export function createDashboardUrlLookup(
  readStored: () => Promise<string | null | undefined>,
  options: { ttlMs?: number; now?: () => number } = {},
): DashboardUrlLookup {
  const ttl = options.ttlMs ?? STORED_ADDRESS_TTL_MS;
  const now = options.now ?? Date.now;
  let cached: { value: string; at: number } | null = null;
  let pending: Promise<string> | null = null;

  const stored = (): Promise<string> => {
    if (cached && now() - cached.at < ttl) return Promise.resolve(cached.value);
    // Concurrent posts share one read.
    pending ??= readStored()
      .then((raw) => {
        const address = normalizeDashboardUrl(raw);
        return address && !isLocalOrigin(address) ? address : "";
      })
      .catch((error: unknown) => {
        console.error("Could not read the dashboard address:", error);
        return "";
      })
      .then((value) => {
        cached = { value, at: now() };
        pending = null;
        return value;
      });
    return pending;
  };

  return {
    async resolve(configured) {
      return normalizeDashboardUrl(configured) ?? (await stored());
    },
    clear() {
      cached = null;
    },
  };
}

const lookup = createDashboardUrlLookup(async () => (await prisma.instance.findUnique({ where: { id: 1 } }))?.dashboardUrl);

/** What `ctx.dashboardUrl()` returns for a server whose moderation settings hold `configured`. */
export function resolveDashboardUrl(configured: unknown): Promise<string> {
  return lookup.resolve(configured);
}
