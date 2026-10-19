import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { matchRange, splitMatch } from "../lib/name-match.ts";

describe("splitMatch", () => {
  test("marks a match in the middle of a name", () => {
    assert.deepEqual(splitMatch("LuxTester", "test"), { before: "Lux", match: "Test", after: "er" });
  });

  test("ignores case, accents, spaces and underscores", () => {
    assert.deepEqual(splitMatch("Zoë_Smith", "zoe sm"), { before: "", match: "Zoë_Sm", after: "ith" });
    assert.deepEqual(splitMatch("the wolf", "thewolf"), { before: "", match: "the wolf", after: "" });
  });

  test("drops a leading @ and an old tag", () => {
    assert.deepEqual(splitMatch("lux", "@lux#1234"), { before: "", match: "lux", after: "" });
  });

  test("returns the text untouched when nothing matches", () => {
    assert.deepEqual(splitMatch("Lux", "zzz"), { before: "Lux", match: "", after: "" });
    assert.equal(matchRange("Lux", "  "), null);
  });
});
