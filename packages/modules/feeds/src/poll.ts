import { ChannelType, type NewsChannel, type TextChannel } from "discord.js";
import { prisma } from "@tier0/db";
import { discoverFeedLink } from "./address.js";
import { FeedFailure, describeFailure, type FailureTexts } from "./failures.js";
import { safeFetch } from "./net.js";
import { NEWS_MESSAGE, STEAM_MESSAGE, deliver, newsValues, steamValues } from "./messages.js";
import { parseFeed, type FeedItem } from "./parse.js";
import { selectNew } from "./seen.js";
import {
  isPatchNotes,
  parseSteamNews,
  steamNewsUrl,
  type SteamPost,
} from "./steam.js";
import { sourcesOf, type Scope, type Source } from "./sources.js";
import type { FeedsContext } from "./settings.js";

export const MIN_POLL_MS = 5 * 60_000;
const POSTS_PER_POLL = 5;

function readSeen(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : null;
  } catch {
    return null;
  }
}

export async function pollAll(ctx: FeedsContext): Promise<void> {
  // A game shared by several channels is fetched once per poll, not once each.
  const steam = new Map<string, Promise<SteamPost[]>>();
  const steamPosts = (appId: number, scope: Scope): Promise<SteamPost[]> => {
    const key = `${appId}:${scope}`;
    const cached = steam.get(key);
    if (cached) return cached;
    const request = fetchSteam(appId, scope);
    steam.set(key, request);
    return request;
  };

  for (const source of sourcesOf(ctx.settings)) {
    await pollSource(ctx, source, steamPosts);
  }
}

async function pollSource(
  ctx: FeedsContext,
  source: Source,
  steamPosts: (appId: number, scope: Scope) => Promise<SteamPost[]>,
): Promise<void> {
  const where = { guildId_sourceKey: { guildId: ctx.guild.id, sourceKey: source.key } };
  const cursor = await readCursor(ctx, source);
  const seen = readSeen(cursor?.seen);

  let remembered = seen ?? [];
  let lastError: string | null;
  const texts: FailureTexts = ctx.settings.labels.problems;

  try {
    if (source.kind === "rss") {
      const items = await fetchFeed(source.row.url);
      const selection = selectNew(items, seen, POSTS_PER_POLL);
      remembered = selection.seen;
      const failed = await postEach(selection.post, (item) => postFeedItem(ctx, source, item), texts);
      remembered = withoutUnposted(remembered, failed.unposted);
      lastError = failed.error;
    } else {
      const selection = selectNew(await steamPosts(source.appId, source.scope), seen, POSTS_PER_POLL);
      remembered = selection.seen;
      const failed = await postEach(selection.post, (post) => postSteamPost(ctx, source, post), texts);
      remembered = withoutUnposted(remembered, failed.unposted);
      lastError = failed.error;
    }
  } catch (error) {
    lastError = describeFailure(error, ctx.settings.labels.problems);
    console.warn(`[feeds] ${ctx.guild.id} ${source.key}: ${lastError}`);
  }

  const data = { seen: JSON.stringify(remembered), checkedAt: new Date(), lastError };
  await prisma.feedCursor.upsert({
    where,
    create: { guildId: ctx.guild.id, sourceKey: source.key, ...data },
    update: data,
  });
}

interface PostOutcome {
  unposted: string[];
  error: string | null;
}

/** Stops at the first failure so later items are not posted ahead of an earlier one. */
async function postEach<T extends { id: string }>(
  items: T[],
  post: (item: T) => Promise<void>,
  texts: FailureTexts,
): Promise<PostOutcome> {
  for (const [index, item] of items.entries()) {
    try {
      await post(item);
    } catch (error) {
      return { unposted: items.slice(index).map((entry) => entry.id), error: describeFailure(error, texts) };
    }
  }
  return { unposted: [], error: null };
}

/** An item that could not be posted stays unseen, so the next poll tries it again. */
const withoutUnposted = (seen: string[], unposted: string[]): string[] =>
  unposted.length === 0 ? seen : seen.filter((id) => !unposted.includes(id));

/**
 * The progress of a source, or for a feed tracked before feeds were kept per
 * channel, the progress it had then, so the change does not post old items again.
 */
async function readCursor(ctx: FeedsContext, source: Source) {
  const cursor = await prisma.feedCursor.findUnique({
    where: { guildId_sourceKey: { guildId: ctx.guild.id, sourceKey: source.key } },
  });
  if (cursor || source.kind !== "rss") return cursor;
  return prisma.feedCursor.findUnique({
    where: { guildId_sourceKey: { guildId: ctx.guild.id, sourceKey: source.legacyKey } },
  });
}

/** Pages whose feed was found through the link in their head, so the page is read once rather than every check. */
const discovered = new Map<string, string>();
const MAX_DISCOVERED = 1000;

async function download(url: string) {
  const response = await safeFetch(url, {
    accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
  });
  if (response.status === 429) {
    throw new FeedFailure("rateLimited");
  }
  if (response.status !== 200) throw new FeedFailure("siteStatus", { status: response.status });
  return response;
}

function newestFirst(items: FeedItem[]): FeedItem[] {
  // Feeds are nearly always newest first, but nothing requires it.
  return items.every((item) => item.publishedAt)
    ? [...items].sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
    : items;
}

/**
 * Reads a feed. An address that turns out to be a web page, such as a site's
 * home page or a YouTube channel, is read through the feed the page links to.
 */
async function fetchFeed(url: string): Promise<FeedItem[]> {
  const target = discovered.get(url) ?? url;
  const response = await download(target);
  try {
    return newestFirst(parseFeed(response.body).items);
  } catch (error) {
    if (!(error instanceof FeedFailure) || target !== url) throw error;
    const link = discoverFeedLink(response.body, response.url);
    if (!link || link === url) throw error;
    const items = newestFirst(parseFeed((await download(link)).body).items);
    if (discovered.size >= MAX_DISCOVERED) discovered.clear();
    discovered.set(url, link);
    return items;
  }
}

async function fetchSteam(appId: number, scope: Scope): Promise<SteamPost[]> {
  const response = await safeFetch(steamNewsUrl(appId), { accept: "application/json" });
  if (response.status !== 200) throw new FeedFailure("steamStatus", { status: response.status });

  let json: unknown;
  try {
    json = JSON.parse(response.body);
  } catch {
    throw new FeedFailure("steamNotJson");
  }
  const posts = parseSteamNews(json).sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  return scope === "all" ? posts : posts.filter(isPatchNotes);
}

function textChannel(ctx: FeedsContext, id: string): TextChannel | NewsChannel {
  const channel = ctx.guild.channels.cache.get(id);
  if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
    throw new FeedFailure("channelGone");
  }
  return channel;
}

async function postFeedItem(ctx: FeedsContext, source: Source & { kind: "rss" }, item: FeedItem): Promise<void> {
  const channel = textChannel(ctx, source.row.channel);
  const message = source.message ?? ctx.settings.news.message;
  await deliver(ctx, channel, message, newsValues(source.label, item, source.row.mention), NEWS_MESSAGE);
}

async function postSteamPost(
  ctx: FeedsContext,
  source: Source & { kind: "steam" },
  post: SteamPost,
): Promise<void> {
  const channel = textChannel(ctx, source.channel);
  const values = steamValues(source.game, source.appId, post, source.mention);
  await deliver(ctx, channel, source.message ?? ctx.settings.patchNotes.message, values, STEAM_MESSAGE);
}

export interface SendResult {
  posted: number;
  error: string | null;
}

/**
 * Posts a source's most recent items on request, whether or not they were
 * posted before. They are added to what the source has already shown, so the
 * next scheduled check does not post any of them a second time.
 */
export async function sendLatest(ctx: FeedsContext, source: Source, count: number): Promise<SendResult> {
  const where = { guildId_sourceKey: { guildId: ctx.guild.id, sourceKey: source.key } };

  let items: { id: string }[];
  try {
    if (source.kind === "rss") {
      items = (await fetchFeed(source.row.url)).slice(0, count);
    } else {
      items = (await fetchSteam(source.appId, source.scope)).slice(0, count);
    }
  } catch (error) {
    return { posted: 0, error: describeFailure(error, ctx.settings.labels.problems) };
  }

  // Newest first from the source; the channel should read oldest to newest.
  const ordered = [...items].reverse();
  const outcome = await postEach(ordered, (item) =>
    source.kind === "rss"
      ? postFeedItem(ctx, source, item as FeedItem)
      : postSteamPost(ctx, source, item as SteamPost),
    ctx.settings.labels.problems,
  );

  const cursor = await readCursor(ctx, source);
  const known = readSeen(cursor?.seen) ?? [];
  const sent = ordered.map((item) => item.id).filter((id) => !outcome.unposted.includes(id));
  const seen = JSON.stringify([...new Set([...sent, ...known])].slice(0, 200));
  await prisma.feedCursor.upsert({
    where,
    create: { guildId: ctx.guild.id, sourceKey: source.key, seen },
    update: { seen },
  });

  return { posted: sent.length, error: outcome.error };
}
