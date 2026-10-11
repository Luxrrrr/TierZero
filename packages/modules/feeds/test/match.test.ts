import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { clampCount, matchSources, MAX_SEND } from "../dist/match.js";

const sources = [
  { id: "reddit", search: "r/GTA6 https://www.reddit.com/r/GTA6/.rss" },
  { id: "bbc", search: " https://feeds.bbci.co.uk/news/technology/rss.xml" },
  { id: "cyberpunk", search: "Cyberpunk 2077 1091500" },
];

const ids = (query: string) => matchSources(sources, query).map((s) => s.id);

describe("matchSources", () => {
  test("finds a source by part of its name, ignoring case", () => {
    assert.deepEqual(ids("CYBER"), ["cyberpunk"]);
  });

  test("finds a game by its app id", () => {
    assert.deepEqual(ids("1091500"), ["cyberpunk"]);
  });

  test("needs every word, in any order", () => {
    assert.deepEqual(ids("rss gta6"), ["reddit"]);
    assert.deepEqual(ids("rss"), ["reddit", "bbc"]);
  });

  test("matches nothing for a blank query rather than everything", () => {
    assert.deepEqual(ids("   "), []);
  });

  test("matches nothing when no word fits", () => {
    assert.deepEqual(ids("wardogs"), []);
  });
});

describe("clampCount", () => {
  test("defaults to one when no count is given", () => {
    assert.equal(clampCount(null), 1);
    assert.equal(clampCount(undefined), 1);
  });

  test("keeps a count inside the allowed range", () => {
    assert.equal(clampCount(0), 1);
    assert.equal(clampCount(-4), 1);
    assert.equal(clampCount(500), MAX_SEND);
    assert.equal(clampCount(3), 3);
  });
});
