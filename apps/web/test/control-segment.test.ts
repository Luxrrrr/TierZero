import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { segment } from "../lib/path-segment.ts";

describe("segment", () => {
  test("encodes ordinary ids and keeps a slash inside one piece", () => {
    assert.equal(segment("leveling"), "leveling");
    assert.equal(segment("a/b"), "a%2Fb");
  });

  test("turns a lone dot or double dot into an id no route matches", () => {
    for (const value of [".", ".."]) {
      const path = new URL(`http://bot/guilds/1/modules/x/rows/${segment(value)}/actions/y`);
      assert.equal(path.pathname, "/guilds/1/modules/x/rows/%00/actions/y", value);
    }
  });

  test("leaves dots inside a longer id alone", () => {
    assert.equal(segment("a.b"), "a.b");
    assert.equal(segment("..x"), "..x");
  });
});
