export interface SteamPost {
  id: string;
  title: string;
  url: string;
  body: string;
  author: string;
  publishedAt: Date;
  tags: string[];
}

const COMING_SOON = /\b(coming|preview|soon|next week|livestream|redstream|upcoming|tomorrow)\b/i;
const PATCH_WORDS = /\b(patch(?:\s?notes?)?|hot\s?fix(?:es)?|change\s?log|release notes|bug\s?fix(?:es)?)\b/i;
const VERSIONED_UPDATE = /\bupdate\s+v?\d/i;
const BARE_UPDATE = /^[\w\s:'.-]*\bupdate$/i;

/**
 * Valve tags its own posts `patchnotes`, but most studios post an ordinary
 * announcement titled "Patch 2.31" and tag nothing, so the title has to be
 * read as well. Announcements that merely mention an upcoming update are left
 * out, since the notes themselves have not shipped yet.
 */
export function isPatchNotes(post: Pick<SteamPost, "title" | "tags">): boolean {
  if (post.tags.some((tag) => tag.toLowerCase() === "patchnotes")) return true;
  if (COMING_SOON.test(post.title)) return false;
  return (
    PATCH_WORDS.test(post.title) ||
    VERSIONED_UPDATE.test(post.title) ||
    BARE_UPDATE.test(post.title.trim())
  );
}

export function steamNewsUrl(appId: number, count = 20): string {
  // Without `feeds`, the endpoint mixes in reposts from news sites about the
  // game, none of which are patch notes.
  return (
    `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}` +
    `&count=${count}&maxlength=0&feeds=steam_community_announcements`
  );
}

/** The game's transparent title logo, which Steam serves for every app id. */
export function logoUrl(appId: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/logo.png`;
}

/** Steam posts use their own markup. This keeps the readable part. */
export function cleanSteamBody(raw: string): string {
  return raw
    .replace(/\[img\][\s\S]*?\[\/img\]/gi, "")
    .replace(/\[previewyoutube[^\]]*\][\s\S]*?\[\/previewyoutube\]/gi, "")
    .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, "$2")
    .replace(/\[h[1-6]\]([\s\S]*?)\[\/h[1-6]\]/gi, "**$1**\n")
    .replace(/\[\*\]/g, "• ")
    .replace(/\[\/?(?:list|olist|b|i|u|strike|spoiler|noparse|quote|code|table|tr|td|th|p)[^\]]*\]/gi, "")
    .replace(/\{STEAM_CLAN_IMAGE\}\S*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseSteamNews(json: unknown): SteamPost[] {
  const items = (json as { appnews?: { newsitems?: unknown } } | null)?.appnews?.newsitems;
  if (!Array.isArray(items)) throw new Error("Steam answered with something unexpected");

  const posts: SteamPost[] = [];
  for (const raw of items) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.gid !== "string" && typeof item.gid !== "number") continue;
    if (typeof item.title !== "string" || typeof item.url !== "string") continue;
    posts.push({
      id: String(item.gid),
      title: item.title,
      url: item.url,
      body: typeof item.contents === "string" ? item.contents : "",
      author: typeof item.author === "string" ? item.author : "",
      publishedAt: new Date(Number(item.date ?? 0) * 1000),
      tags: Array.isArray(item.tags) ? item.tags.filter((t): t is string => typeof t === "string") : [],
    });
  }
  return posts;
}
