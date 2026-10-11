import { ChannelType, EmbedBuilder, type NewsChannel, type TextChannel } from "discord.js";
import { prisma } from "@tier0/db";
import { FetchError, safeFetch } from "./net.js";
import { parseFeed, type FeedItem } from "./parse.js";
import { selectNew } from "./seen.js";
import {
  cleanSteamBody,
  isPatchNotes,
  logoUrl,
  parseSteamNews,
  steamNewsUrl,
  type SteamPost,
} from "./steam.js";
import { sourcesOf, type Scope, type Source } from "./sources.js";
import type { FeedsContext } from "./settings.js";

export const MIN_POLL_MS = 5 * 60_000;
const POSTS_PER_POLL = 5;
const EMBED_COLOR = 0x5865f2;

function readSeen(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : null;
  } catch {
    return null;
  }
}

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

function describeFailure(error: unknown): string {
  if (error instanceof FetchError) return error.message;
  if (error instanceof Error) return truncate(error.message, 200);
  return "something went wrong";
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
  const cursor = await prisma.feedCursor.findUnique({ where });
  const seen = readSeen(cursor?.seen);

  let remembered = seen ?? [];
  let lastError: string | null;

  try {
    if (source.kind === "rss") {
      const items = await fetchFeed(source.row.url);
      const selection = selectNew(items, seen, POSTS_PER_POLL);
      remembered = selection.seen;
      const failed = await postEach(selection.post, (item) => postFeedItem(ctx, source, item));
      remembered = withoutUnposted(remembered, failed.unposted);
      lastError = failed.error;
    } else {
      const selection = selectNew(await steamPosts(source.appId, source.scope), seen, POSTS_PER_POLL);
      remembered = selection.seen;
      const failed = await postEach(selection.post, (post) => postSteamPost(ctx, source, post));
      remembered = withoutUnposted(remembered, failed.unposted);
      lastError = failed.error;
    }
  } catch (error) {
    lastError = describeFailure(error);
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
): Promise<PostOutcome> {
  for (const [index, item] of items.entries()) {
    try {
      await post(item);
    } catch (error) {
      return { unposted: items.slice(index).map((entry) => entry.id), error: describeFailure(error) };
    }
  }
  return { unposted: [], error: null };
}

/** An item that could not be posted stays unseen, so the next poll tries it again. */
const withoutUnposted = (seen: string[], unposted: string[]): string[] =>
  unposted.length === 0 ? seen : seen.filter((id) => !unposted.includes(id));

async function fetchFeed(url: string): Promise<FeedItem[]> {
  const response = await safeFetch(url, {
    accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
  });
  if (response.status === 429) {
    throw new FetchError("the site is limiting how often it can be checked (status 429). Try a longer check interval");
  }
  if (response.status !== 200) throw new FetchError(`the site answered with status ${response.status}`);

  const { items } = parseFeed(response.body);
  // Feeds are nearly always newest first, but nothing requires it.
  return items.every((item) => item.publishedAt)
    ? [...items].sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
    : items;
}

async function fetchSteam(appId: number, scope: Scope): Promise<SteamPost[]> {
  const response = await safeFetch(steamNewsUrl(appId), { accept: "application/json" });
  if (response.status !== 200) throw new FetchError(`Steam answered with status ${response.status}`);

  let json: unknown;
  try {
    json = JSON.parse(response.body);
  } catch {
    throw new FetchError("Steam answered with something that was not JSON");
  }
  const posts = parseSteamNews(json).sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  return scope === "all" ? posts : posts.filter(isPatchNotes);
}

function textChannel(ctx: FeedsContext, id: string): TextChannel | NewsChannel {
  const channel = ctx.guild.channels.cache.get(id);
  if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
    throw new Error("the channel it posts in no longer exists, or is not a text channel");
  }
  return channel;
}

async function postFeedItem(ctx: FeedsContext, source: Source & { kind: "rss" }, item: FeedItem): Promise<void> {
  const channel = textChannel(ctx, source.row.channel);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({ name: truncate(source.label, 256) })
    .setTitle(truncate(item.title, 256));
  if (item.link) embed.setURL(item.link);
  if (item.summary) embed.setDescription(truncate(item.summary, 400));
  if (item.image) embed.setImage(item.image);
  if (item.publishedAt) embed.setTimestamp(item.publishedAt);

  const mention = source.row.mention;
  await channel.send({
    content: mention ? `<@&${mention}>` : undefined,
    embeds: [embed],
    allowedMentions: { roles: mention ? [mention] : [] },
  });
}

async function postSteamPost(
  ctx: FeedsContext,
  source: Source & { kind: "steam" },
  post: SteamPost,
): Promise<void> {
  const channel = textChannel(ctx, source.channel);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({ name: truncate(source.game, 256) })
    .setTitle(truncate(post.title, 256))
    .setURL(post.url)
    .setThumbnail(logoUrl(source.appId))
    .setFooter({ text: "Steam" })
    .setTimestamp(post.publishedAt);
  const body = cleanSteamBody(post.body);
  if (body) embed.setDescription(truncate(body, 900));

  await channel.send({
    content: source.mention ? `<@&${source.mention}>` : undefined,
    embeds: [embed],
    allowedMentions: { roles: source.mention ? [source.mention] : [] },
  });
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
    return { posted: 0, error: describeFailure(error) };
  }

  // Newest first from the source; the channel should read oldest to newest.
  const ordered = [...items].reverse();
  const outcome = await postEach(ordered, (item) =>
    source.kind === "rss"
      ? postFeedItem(ctx, source, item as FeedItem)
      : postSteamPost(ctx, source, item as SteamPost),
  );

  const cursor = await prisma.feedCursor.findUnique({ where });
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
