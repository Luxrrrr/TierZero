import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, applyVariablesToMessage, emptyEmbed, parseMessage, type MessageBody } from "@tier0/core";
import feeds from "../dist/index.js";
import { NEWS_MESSAGE, STEAM_MESSAGE, deliver, newsValues, steamValues } from "../dist/messages.js";

const registry = new ModuleRegistry();
registry.register(feeds);

function resolved(stored: unknown) {
  const result = registry.resolveSettings("feeds", stored);
  assert.ok(result.ok, "settings should resolve");
  return result.value as { news: { message: MessageBody }; patchNotes: { message: MessageBody } };
}

function fill(body: MessageBody, values: Record<string, string | number>): MessageBody {
  const strings = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));
  const parsed = parseMessage(applyVariablesToMessage(body, strings));
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.errors[0]?.message);
  return parsed.value;
}

const published = new Date("2026-09-21T14:13:20.000Z");
const item = {
  id: "1",
  title: "Season 4 is live",
  link: "https://example.com/news/season-4",
  summary: "New map, new weapons.",
  publishedAt: published,
  image: "https://example.com/cover.png",
};
const post = {
  id: "9",
  title: "Update 1.2",
  url: "https://store.steampowered.com/news/app/730/view/9",
  body: "[h2]Fixes[/h2][list][*]Fixed a crash[/list]",
  author: "dev",
  publishedAt: published,
  tags: ["patchnotes"],
};

describe("the news post", () => {
  test("is the embed the bot has always posted until the owner writes another", () => {
    const message = fill(resolved({}).news.message, newsValues("Example Gazette", item, "123456789012345678"));
    assert.equal(message.content, "<@&123456789012345678>");
    assert.deepEqual(message.embeds, [
      {
        ...emptyEmbed(),
        color: "#5865f2",
        authorName: "Example Gazette",
        title: "Season 4 is live",
        url: "https://example.com/news/season-4",
        description: "New map, new weapons.",
        imageUrl: "https://example.com/cover.png",
        timestamp: "2026-09-21T14:13:20.000Z",
      },
    ]);
  });

  test("leaves out the ping, link, picture and time an item does not have", () => {
    const bare = { ...item, link: null, summary: "", image: null, publishedAt: null };
    const message = fill(NEWS_MESSAGE, newsValues("Gazette", bare, undefined));
    assert.equal(message.content, "");
    const [embed] = message.embeds;
    assert.equal(embed?.url, "");
    assert.equal(embed?.description, "");
    assert.equal(embed?.imageUrl, "");
    assert.equal(embed?.timestamp, "");
  });

  test("cuts the description and the headline to the lengths it always used", () => {
    const long = { ...item, title: "t".repeat(300), summary: "d".repeat(500) };
    const values = newsValues("s".repeat(300), long, undefined);
    assert.equal(String(values.title).length, 256);
    assert.equal(String(values.source).length, 256);
    assert.equal(String(values.description).length, 400);
    assert.ok(String(values.description).endsWith("…"));
  });

  test("uses the owner's message when they have written one", () => {
    const stored = { news: { message: { content: "", embeds: [{ title: "{source}: {title}", url: "{link}", description: "{published}" }] } } };
    const message = fill(resolved(stored).news.message, newsValues("Gazette", item, undefined));
    assert.equal(message.embeds[0]?.title, "Gazette: Season 4 is live");
    assert.equal(message.embeds[0]?.url, "https://example.com/news/season-4");
    assert.match(message.embeds[0]?.description ?? "", /^<t:\d+:R>$/);
  });

  test("reads a plain string as a message that is only text", () => {
    const message = resolved({ news: { message: "New: {title} {link}" } }).news.message;
    assert.equal(message.content, "New: {title} {link}");
    assert.deepEqual(message.embeds, []);
  });

  test("breaks up a mention written into a headline so a feed cannot ping anyone", () => {
    const values = newsValues("Gazette", { ...item, title: "hi <@&123456789012345678>" }, undefined);
    assert.ok(!String(values.title).includes("<@&"));
  });

  test("a message that overflows once filled is not valid, so the starting one is sent instead", async () => {
    const stored = { news: { message: { content: "", embeds: [{ title: "{title}{title}" }] } } };
    const custom = resolved(stored).news.message;
    const values = newsValues("Gazette", { ...item, title: "t".repeat(200) }, undefined);
    const strings = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));
    assert.equal(parseMessage(applyVariablesToMessage(custom, strings)).ok, false);

    let received: { body: MessageBody; fallback?: MessageBody } | undefined;
    const ctx = {
      send: async (_target: unknown, body: MessageBody, _values: unknown, options?: { fallback?: MessageBody }) => {
        received = { body, fallback: options?.fallback };
        return {};
      },
    };
    await deliver(ctx as never, {} as never, custom, values, NEWS_MESSAGE);
    assert.equal(received?.body, custom);
    assert.equal(received?.fallback, NEWS_MESSAGE);

    const worst = newsValues("s".repeat(300), { ...item, title: "t".repeat(300), summary: "d".repeat(500) }, "123456789012345678");
    fill(NEWS_MESSAGE, worst);
  });

  test("a post that could not be delivered is reported so the item is tried again", async () => {
    const ctx = { send: async () => null };
    await assert.rejects(deliver(ctx as never, {} as never, NEWS_MESSAGE, {}, NEWS_MESSAGE), /could not be sent/);
  });
});

describe("the Steam patch note post", () => {
  test("is the embed the bot has always posted until the owner writes another", () => {
    const message = fill(resolved({}).patchNotes.message, steamValues("Counter-Strike 2", 730, post, undefined));
    assert.equal(message.content, "");
    assert.deepEqual(message.embeds, [
      {
        ...emptyEmbed(),
        color: "#5865f2",
        authorName: "Counter-Strike 2",
        title: "Update 1.2",
        url: "https://store.steampowered.com/news/app/730/view/9",
        description: "**Fixes**\n• Fixed a crash",
        thumbnailUrl: "https://cdn.cloudflare.steamstatic.com/steam/apps/730/logo.png",
        footerText: "Steam",
        timestamp: "2026-09-21T14:13:20.000Z",
      },
    ]);
  });

  test("pings the role in the message text, as it always has", () => {
    const message = fill(STEAM_MESSAGE, steamValues("CS2", 730, post, "123456789012345678"));
    assert.equal(message.content, "<@&123456789012345678>");
  });

  test("cuts the description to 900 characters", () => {
    const values = steamValues("CS2", 730, { ...post, body: "x".repeat(2000) }, undefined);
    assert.equal(String(values.description).length, 900);
  });

  test("offers the game's id and logo to the owner", () => {
    const values = steamValues("CS2", 730, post, undefined);
    assert.equal(values["game.id"], 730);
    assert.match(String(values.logo), /730\/logo\.png$/);
  });
});

describe("the /feeds send answer", () => {
  const starting = feeds.commands?.[0]?.response?.starting;

  test("reads as it always has when everything was sent", () => {
    assert.ok(starting);
    const message = fill(starting, { posted: 3, count: 3, source: "Example Gazette", problem: "" });
    assert.equal(message.embeds[0]?.description.trim(), "Sent 3 of the latest 3 from Example Gazette.");
  });

  test("adds why it stopped when it stopped early", () => {
    assert.ok(starting);
    const message = fill(starting, { posted: 1, count: 3, source: "Example Gazette", problem: "Stopped because: the site answered with status 500." });
    assert.equal(message.embeds[0]?.description, "Sent 1 of the latest 3 from Example Gazette. Stopped because: the site answered with status 500.");
  });
});
