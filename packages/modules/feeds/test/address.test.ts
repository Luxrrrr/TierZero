import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry } from "@tier0/core";
import feeds from "../dist/index.js";
import { discoverFeedLink, isWebAddress, normalizeFeedAddress, steamAppIdOf, youtubeFeedFor } from "../dist/address.js";

const CHANNEL = "123456789012345678";
const registry = new ModuleRegistry();
registry.register(feeds);

const resolve = (stored: unknown) => registry.resolveSettings("feeds", stored);

describe("a pasted feed address", () => {
  test("gets https:// when it was left off, and loses stray spaces", () => {
    assert.equal(normalizeFeedAddress("  example.com/feed.xml "), "https://example.com/feed.xml");
    assert.equal(normalizeFeedAddress("http://example.com/rss"), "http://example.com/rss");
  });

  test("of a YouTube channel or playlist becomes the feed YouTube publishes for it", () => {
    const channel = "UCabcdefghijklmnopqrstuv";
    assert.equal(youtubeFeedFor(`https://www.youtube.com/channel/${channel}`), `https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`);
    assert.equal(normalizeFeedAddress(`youtube.com/channel/${channel}/videos`), `https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`);
    assert.equal(
      youtubeFeedFor("https://www.youtube.com/playlist?list=PLabcdefghij12345"),
      "https://www.youtube.com/feeds/videos.xml?playlist_id=PLabcdefghij12345",
    );
    assert.equal(youtubeFeedFor("https://www.youtube.com/@speedrunners"), null);
    assert.equal(youtubeFeedFor("https://example.com/channel/UCabcdefghijklmnopqrstuv"), null);
  });

  test("must be a web address", () => {
    assert.equal(isWebAddress("https://example.com/feed"), true);
    assert.equal(isWebAddress("ftp://example.com/feed"), false);
    assert.equal(isWebAddress("https://localhost/feed"), false);
    assert.equal(isWebAddress("not a feed"), false);
  });

  test("that is not one is cleared, so the other feeds keep loading, and the row says why", async () => {
    const stored = { news: { feeds: [{ url: "not a feed", channel: CHANNEL }, { url: "https://example.com/rss", channel: CHANNEL }] } };
    const bad = resolve(stored);
    assert.ok(bad.ok);
    const rows = (bad.value as { news: { feeds: { url?: string }[] } }).news.feeds;
    assert.equal(rows[0]?.url, undefined);
    assert.equal(rows[1]?.url, "https://example.com/rss");

    const status = feeds.rows!["news.feeds"]!.status!;
    const [first] = await status({ ctx: { guild: { id: "1" } } as never, path: "news.feeds", rows: [{ path: "news.feeds[0]", row: rows[0] as never, parent: {} }] });
    assert.deepEqual(first, { tone: "problem", text: "No feed address. Add one and save." });
  });

  test("is tidied when it is one", () => {
    const good = resolve({ news: { feeds: [{ url: "example.com/feed", channel: CHANNEL }] } });
    assert.ok(good.ok);
    assert.equal((good.value as { news: { feeds: { url: string }[] } }).news.feeds[0]?.url, "https://example.com/feed");
  });
});

describe("a page that links to its feed", () => {
  test("is read through the feed in its head", () => {
    const html = `<html><head><link rel="stylesheet" href="/a.css"><link type="application/rss+xml" rel="alternate" title="RSS" href="https://www.youtube.com/feeds/videos.xml?channel_id=UC1&amp;x=1"></head></html>`;
    assert.equal(discoverFeedLink(html, "https://www.youtube.com/@game"), "https://www.youtube.com/feeds/videos.xml?channel_id=UC1&x=1");
  });

  test("resolves a link written relative to the page", () => {
    const html = `<link rel='alternate' type='application/atom+xml' href='/atom.xml'>`;
    assert.equal(discoverFeedLink(html, "https://blog.example.com/posts/"), "https://blog.example.com/atom.xml");
  });

  test("finds nothing on a page without one", () => {
    assert.equal(discoverFeedLink(`<link rel="icon" href="/favicon.ico">`, "https://example.com/"), null);
  });
});

describe("a Steam game", () => {
  test("can be given as its store link or its number", () => {
    assert.equal(steamAppIdOf("https://store.steampowered.com/app/1091500/Cyberpunk_2077/"), "1091500");
    assert.equal(steamAppIdOf("store.steampowered.com/app/730"), "730");
    assert.equal(steamAppIdOf("https://steamcommunity.com/app/730/allnews/"), "730");
    assert.equal(steamAppIdOf(" 730 "), "730");
    assert.equal(steamAppIdOf(730), "730");
    assert.equal(steamAppIdOf("Counter-Strike"), null);
    assert.equal(steamAppIdOf(0), null);
  });

  const games = (appId: unknown) => ({ patchNotes: { destinations: [{ channel: CHANNEL, games: [{ appId, name: "CS2" }] }] } });
  const appIdOf = (stored: unknown) => {
    const result = resolve(stored);
    assert.ok(result.ok, result.ok ? "" : result.errors[0]?.message);
    return (result.value as { patchNotes: { destinations: { games: { appId: string }[] }[] } }).patchNotes.destinations[0]?.games[0]?.appId;
  };

  test("saved as a number before keeps working", () => {
    assert.equal(appIdOf(games(730)), "730");
  });

  test("pasted as a store link is kept as its number", () => {
    assert.equal(appIdOf(games("https://store.steampowered.com/app/1091500/Cyberpunk_2077/")), "1091500");
  });

  test("given as anything else is refused", () => {
    const result = resolve(games("Counter-Strike"));
    assert.equal(result.ok, false);
  });
});

describe("the check interval", () => {
  test("is at least five minutes", () => {
    const result = resolve({ pollEvery: 60_000 });
    assert.ok(result.ok);
    assert.equal((result.value as { pollEvery: number }).pollEvery, 300_000);
    assert.equal(resolve({ pollEvery: "1m" }).ok, false);
  });
});
