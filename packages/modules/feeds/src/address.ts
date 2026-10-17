/**
 * Turning what an owner pastes into something the module can read: a feed
 * address, a YouTube channel, or a Steam store link. Free of discord.js and of
 * the network, so it can be tested as plain input and output.
 */

/** A web address the module will try to fetch: http or https, with a host. */
export function isWebAddress(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".");
  } catch {
    return false;
  }
}

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

/**
 * A YouTube channel or playlist page as the feed YouTube publishes for it,
 * which needs no account or key. Null for any other address, including a
 * channel named by its handle, whose feed is found by reading the page.
 */
export function youtubeFeedFor(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!YOUTUBE_HOSTS.has(url.hostname)) return null;
  const channel = /^\/channel\/(UC[\w-]{22})(?:\/|$)/.exec(url.pathname)?.[1];
  if (channel) return `https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`;
  const playlist = url.pathname === "/playlist" ? url.searchParams.get("list") : null;
  if (playlist && /^[\w-]{10,64}$/.test(playlist)) return `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlist}`;
  return null;
}

/**
 * What a pasted feed address is stored as: trimmed, given https:// when it was
 * left off, and a YouTube channel turned into its feed.
 */
export function normalizeFeedAddress(raw: string): string {
  let value = raw.trim();
  if (value !== "" && !/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value.replace(/^\/+/, "")}`;
  return youtubeFeedFor(value) ?? value;
}

const STORE_LINK = /^(?:https?:\/\/)?(?:store\.steampowered\.com|steamcommunity\.com)\/app\/(\d{1,10})(?:[/?#]|$)/i;

/** The app ID in a Steam store or community link, or a bare number. Null for anything else. */
export function steamAppIdOf(raw: unknown): string | null {
  if (typeof raw === "number") return Number.isInteger(raw) && raw > 0 ? String(raw) : null;
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (/^\d{1,10}$/.test(value)) return Number(value) > 0 ? String(Number(value)) : null;
  return STORE_LINK.exec(value)?.[1] ?? null;
}

const ATTRIBUTE = /([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/**
 * The feed a web page points to in its head, the way browsers and feed readers
 * find one, so a site's or a YouTube channel's own address works as a feed.
 */
export function discoverFeedLink(html: string, base: string): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attributes = new Map<string, string>();
    for (const match of tag.matchAll(ATTRIBUTE)) {
      attributes.set((match[1] ?? "").toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
    }
    const rel = (attributes.get("rel") ?? "").toLowerCase().split(/\s+/);
    const type = (attributes.get("type") ?? "").toLowerCase();
    const href = attributes.get("href");
    if (!rel.includes("alternate") || !href) continue;
    if (type !== "application/rss+xml" && type !== "application/atom+xml") continue;
    try {
      const url = new URL(href.replace(/&amp;/g, "&"), base);
      if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
    } catch {
      continue;
    }
  }
  return null;
}
