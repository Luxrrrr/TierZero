import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { sourceForRow, sourcesOf } from "../dist/sources.js";

const settings = {
  pollEvery: 900000,
  news: {
    enabled: true,
    feeds: [{ url: "https://example.com/rss", channel: "111111111111111111", name: "Example" }],
  },
  patchNotes: {
    enabled: true,
    destinations: [
      { channel: "222222222222222222", games: [{ appId: 730, name: "CS2", scope: "patch" }] },
      { channel: "333333333333333333", games: [{ appId: 730, name: "CS2", scope: "all" }] },
    ],
  },
};

describe("sourcesOf", () => {
  test("keeps a game listed under two channels as two sources", () => {
    const keys = sourcesOf(settings as never).map((s) => s.key);
    assert.deepEqual(keys, [
      "rss:https://example.com/rss:111111111111111111",
      "steam:730:222222222222222222",
      "steam:730:333333333333333333",
    ]);
  });

  test("gives each listing of a game its own scope", () => {
    const steam = sourcesOf(settings as never).flatMap((s) => (s.kind === "steam" ? [s.scope] : []));
    assert.deepEqual(steam, ["patch", "all"]);
  });

  test("keeps one address listed for two channels as two sources", () => {
    const twice = {
      ...settings,
      news: { enabled: true, feeds: [settings.news.feeds[0]!, { url: "https://example.com/rss", channel: "444444444444444444" }] },
    };
    const keys = sourcesOf(twice as never).flatMap((s) => (s.kind === "rss" ? [s.key] : []));
    assert.deepEqual(keys, ["rss:https://example.com/rss:111111111111111111", "rss:https://example.com/rss:444444444444444444"]);
  });

  test("uses a destination's own post only while it is switched on", () => {
    const own = { content: "New patch for {game}", embeds: [], buttons: [], selects: [], reactions: [] };
    const custom = {
      ...settings,
      patchNotes: { enabled: true, destinations: [{ channel: "222222222222222222", custom: true, message: own, games: [{ appId: "730", name: "CS2", scope: "patch" }] }, { channel: "333333333333333333", custom: false, message: own, games: [{ appId: 730, name: "CS2", scope: "patch" }] }] },
    };
    const messages = sourcesOf(custom as never).flatMap((s) => (s.kind === "steam" ? [s.message] : []));
    assert.deepEqual(messages, [own, undefined]);
  });

  test("leaves out a kind that is switched off", () => {
    const off = { ...settings, news: { ...settings.news, enabled: false } };
    assert.ok(sourcesOf(off as never).every((s) => s.kind === "steam"));
  });
});

describe("sourceForRow", () => {
  test("builds the same key the scheduled check uses for a feed", () => {
    const row = settings.news.feeds[0]!;
    const source = sourceForRow("news.feeds", { path: "news.feeds[0]", row, parent: settings.news });
    assert.equal(source?.key, "rss:https://example.com/rss:111111111111111111");
  });

  test("takes a game's channel from the row that holds it", () => {
    const destination = settings.patchNotes.destinations[1]!;
    const row = destination.games[0]!;
    const source = sourceForRow("patchNotes.destinations.games", {
      path: "patchNotes.destinations[1].games[0]",
      row,
      parent: destination,
    });
    assert.equal(source?.key, "steam:730:333333333333333333");
    assert.equal(source?.kind === "steam" ? source.scope : null, "all");
  });

  test("is null for a row that is not filled in", () => {
    const source = sourceForRow("news.feeds", { path: "news.feeds[0]", row: { url: "" }, parent: {} });
    assert.equal(source, null);
  });
});
