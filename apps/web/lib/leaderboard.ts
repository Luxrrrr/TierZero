/**
 * The public leaderboard page's rules, kept free of Next imports so the tests
 * can reach them. The bot decides what the page may show; this decides how
 * often one visitor may ask.
 */

export interface PublicMember {
  position: number;
  name: string;
  avatar: string | null;
  level: number;
}

export interface PublicLeaderboard {
  server: { name: string; icon: string | null };
  indexed: boolean;
  page: number;
  pages: number;
  members: PublicMember[];
}

/** Discord ids are 17 to 20 digits. Anything else is not a server, and is not passed on to the bot. */
export function isGuildId(value: string): boolean {
  return /^\d{17,20}$/.test(value);
}

/** The page asked for in the query string, 1 when it is missing or not a whole number above 0. */
export function pageParam(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || !/^\d{1,4}$/.test(raw)) return 1;
  return Math.max(1, Number(raw));
}

/**
 * Who is asking, for counting requests. A reverse proxy adds the address it was
 * connected from to the end of X-Forwarded-For, and anything before that was
 * sent by the visitor and can say whatever it likes, so the last entry is the
 * one counted. Next.js does not give a page the connection's own address, so
 * with no proxy in front the header is entirely the visitor's: every visitor
 * can claim a new address, and only the limit on all visitors together and the
 * bot's own limits on member lookups still hold.
 */
export function visitorKey(forwardedFor: string | null, realIp: string | null): string {
  const last = forwardedFor?.split(",").at(-1)?.trim();
  return last || realIp?.trim() || "unknown";
}

export interface RateLimit {
  /** True when the request may go ahead, and counts it. */
  take(key: string, now?: number): boolean;
}

/**
 * A fixed window per visitor plus one for everyone together, so neither a
 * single visitor nor many at once can make the bot read the leaderboard
 * without pause.
 */
export function createRateLimit(options: { perVisitor: number; overall: number; windowMs: number; maxVisitors?: number }): RateLimit {
  const visitors = new Map<string, { start: number; count: number }>();
  let overall = { start: 0, count: 0 };
  const maxVisitors = options.maxVisitors ?? 10_000;

  return {
    take(key, now = Date.now()) {
      if (now - overall.start >= options.windowMs) overall = { start: now, count: 0 };
      if (overall.count >= options.overall) return false;

      let entry = visitors.get(key);
      if (!entry || now - entry.start >= options.windowMs) {
        if (!entry && visitors.size >= maxVisitors) visitors.clear();
        entry = { start: now, count: 0 };
        visitors.set(key, entry);
      }
      if (entry.count >= options.perVisitor) return false;
      entry.count += 1;
      overall.count += 1;
      return true;
    },
  };
}

/** The pages to offer links to: the first, the last, and the two either side of this one. */
export function pageLinks(page: number, pages: number): number[] {
  const wanted = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2]);
  return [...wanted].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
}
