import type { TextBasedChannel } from "discord.js";
import { discordTimestamp, emptyEmbed, type MessageBody, type MessageVariable, type ReplyValues } from "@tier0/core";
import { FeedFailure } from "./failures.js";
import type { FeedItem } from "./parse.js";
import { cleanSteamBody, logoUrl, type SteamPost } from "./steam.js";
import type { FeedsContext } from "./settings.js";

const EMBED_COLOR = "#5865f2";

export const NEWS_DESCRIPTION_MAX = 400;
export const STEAM_DESCRIPTION_MAX = 900;

const body = (embed: Partial<ReturnType<typeof emptyEmbed>>): MessageBody => ({
  content: "{role}",
  embeds: [{ ...emptyEmbed(), color: EMBED_COLOR, ...embed }],
  buttons: [],
  selects: [],
  reactions: [],
});

/** What a news item looks like until the owner writes something else. */
export const NEWS_MESSAGE: MessageBody = body({
  authorName: "{source}",
  title: "{title}",
  url: "{link}",
  description: "{description}",
  imageUrl: "{image}",
  timestamp: "{published.iso}",
});

/** What a Steam post looks like until the owner writes something else. */
export const STEAM_MESSAGE: MessageBody = body({
  authorName: "{game}",
  title: "{title}",
  url: "{link}",
  description: "{description}",
  thumbnailUrl: "{logo}",
  footerText: "Steam",
  timestamp: "{published.iso}",
});

const SHARED: MessageVariable[] = [
  { name: "title", description: "The post's headline", sample: "Season 4 is live" },
  { name: "link", description: "The address of the post, empty when the feed gives none", sample: "https://example.com/news/season-4" },
  { name: "description", description: "The start of the post, already cut to the length it is posted at", sample: "New map, new weapons and a round of balance changes." },
  { name: "published", description: "When it was published, shown in each reader's own time (empty when unknown)", sample: "<t:1790000000:R>" },
  { name: "published.iso", description: "The same moment as a date and time, for an embed's time setting (empty when unknown)", sample: "2026-09-21T14:13:20.000Z" },
  { name: "role", description: "A mention of the role to ping, empty when no role is set. The default message has it as its text", sample: "@Announcements" },
];

export const NEWS_VARIABLES: MessageVariable[] = [
  { name: "source", description: "The feed's name", sample: "Example Gazette" },
  ...SHARED,
  { name: "image", description: "The post's picture, empty when it has none", sample: "https://example.com/cover.png" },
];

export const STEAM_VARIABLES: MessageVariable[] = [
  { name: "game", description: "The game's name as written in the dashboard", sample: "Counter-Strike 2" },
  { name: "game.id", description: "The game's Steam app ID", sample: "730" },
  ...SHARED,
  { name: "logo", description: "The game's logo, for an image or thumbnail", sample: "https://example.com/logo.png" },
];

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

// Text copied from a site is only ever shown, never allowed to ping anyone, so a
// mention written into a headline is broken up before it reaches message text.
const defang = (value: string): string => value.replace(/<@/g, "<​@");

const moment = (date: Date | null): { published: string; "published.iso": string } =>
  date ? { published: discordTimestamp(date, "R"), "published.iso": date.toISOString() } : { published: "", "published.iso": "" };

export function newsValues(label: string, item: FeedItem, mention: string | undefined): ReplyValues {
  return {
    source: defang(truncate(label, 256)),
    title: defang(truncate(item.title, 256)),
    link: item.link ?? "",
    description: defang(truncate(item.summary, NEWS_DESCRIPTION_MAX)),
    image: item.image ?? "",
    role: mention ? `<@&${mention}>` : "",
    ...moment(item.publishedAt),
  };
}

export function steamValues(game: string, appId: number, post: SteamPost, mention: string | undefined): ReplyValues {
  const text = cleanSteamBody(post.body);
  return {
    game: defang(truncate(game, 256)),
    "game.id": appId,
    title: defang(truncate(post.title, 256)),
    link: post.url,
    description: text ? defang(truncate(text, STEAM_DESCRIPTION_MAX)) : "",
    logo: logoUrl(appId),
    role: mention ? `<@&${mention}>` : "",
    ...moment(post.publishedAt),
  };
}

/**
 * Throws when nothing was delivered, so the item stays unseen and the next check
 * tries it again, as it did when the bot sent the embed itself.
 */
export async function deliver(
  ctx: FeedsContext,
  channel: TextBasedChannel,
  message: MessageBody,
  values: ReplyValues,
  fallback: MessageBody,
): Promise<void> {
  const sent = await ctx.send(channel, message, values, { fallback });
  if (!sent) throw new FeedFailure("postFailed");
}
