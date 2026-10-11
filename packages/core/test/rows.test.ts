import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { resolveList, resolveRow, schemaPathOf } from "../dist/rows.js";

const settings = {
  news: { feeds: [{ url: "a" }, { url: "b" }] },
  patchNotes: {
    destinations: [
      { channel: "1", games: [{ name: "x" }, { name: "y" }] },
      { channel: "2", games: [{ name: "z" }] },
    ],
  },
};

describe("schemaPathOf", () => {
  test("drops the indices", () => {
    assert.equal(schemaPathOf("patchNotes.destinations[0].games[1]"), "patchNotes.destinations.games");
    assert.equal(schemaPathOf("news.feeds"), "news.feeds");
  });

  test("refuses text that is not a path", () => {
    assert.equal(schemaPathOf("news..feeds"), null);
    assert.equal(schemaPathOf("news.feeds[x]"), null);
    assert.equal(schemaPathOf(""), null);
  });
});

describe("resolveRow", () => {
  test("finds a row in a top-level list, with the object that holds the list", () => {
    const ref = resolveRow(settings, "news.feeds[1]");
    assert.deepEqual(ref?.row, { url: "b" });
    assert.equal(ref?.parent, settings.news);
  });

  test("finds a row in a list inside a row, and reports that row as its parent", () => {
    const ref = resolveRow(settings, "patchNotes.destinations[1].games[0]");
    assert.deepEqual(ref?.row, { name: "z" });
    assert.equal(ref?.parent["channel"], "2");
  });

  test("is null when an index is out of range", () => {
    assert.equal(resolveRow(settings, "news.feeds[5]"), null);
    assert.equal(resolveRow(settings, "patchNotes.destinations[9].games[0]"), null);
  });

  test("is null for a path that names a list instead of a row", () => {
    assert.equal(resolveRow(settings, "news.feeds"), null);
  });

  test("is null for a path that leads somewhere that is not a list", () => {
    assert.equal(resolveRow(settings, "news.nothing[0]"), null);
  });
});

describe("resolveList", () => {
  test("returns every row with its own indexed path", () => {
    const rows = resolveList(settings, "patchNotes.destinations[0].games");
    assert.deepEqual(rows?.map((r) => r.path), [
      "patchNotes.destinations[0].games[0]",
      "patchNotes.destinations[0].games[1]",
    ]);
    assert.equal(rows?.[0]?.parent["channel"], "1");
  });

  test("is null for a path that names a row", () => {
    assert.equal(resolveList(settings, "news.feeds[0]"), null);
  });
});
