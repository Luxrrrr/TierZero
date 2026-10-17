import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRateLimit, isGuildId, pageLinks, pageParam, visitorKey } from "../lib/leaderboard.ts";
import { needsSession } from "../lib/login-redirect.ts";

describe("the public leaderboard page", () => {
  test("needs no sign-in", () => {
    assert.equal(needsSession("/leaderboard/123456789012345678"), false);
  });

  test("only passes a Discord id on to the bot", () => {
    assert.equal(isGuildId("123456789012345678"), true);
    assert.equal(isGuildId("12345"), false);
    assert.equal(isGuildId("../modules"), false);
  });

  test("reads the page number, falling back to the first", () => {
    assert.equal(pageParam("4"), 4);
    assert.equal(pageParam(["2", "9"]), 2);
    assert.equal(pageParam(undefined), 1);
    assert.equal(pageParam("0"), 1);
    assert.equal(pageParam("-3"), 1);
    assert.equal(pageParam("1e9"), 1);
  });

  test("counts visitors by the address the proxy added, not one the visitor sent", () => {
    assert.equal(visitorKey("203.0.113.9", null), "203.0.113.9");
    assert.equal(visitorKey("1.2.3.4, 203.0.113.9", null), "203.0.113.9");
    assert.equal(visitorKey("1.2.3.4, 5.6.7.8, 203.0.113.9", null), "203.0.113.9");
    assert.equal(visitorKey(null, "198.51.100.4"), "198.51.100.4");
    assert.equal(visitorKey(null, null), "unknown");
  });

  test("turns one visitor away after the limit, until the window passes", () => {
    const limit = createRateLimit({ perVisitor: 2, overall: 100, windowMs: 60_000 });
    assert.equal(limit.take("a", 0), true);
    assert.equal(limit.take("a", 1), true);
    assert.equal(limit.take("a", 2), false);
    assert.equal(limit.take("b", 3), true, "another visitor still gets in");
    assert.equal(limit.take("a", 60_001), true);
  });

  test("turns everyone away once the overall limit is reached", () => {
    const limit = createRateLimit({ perVisitor: 10, overall: 3, windowMs: 60_000 });
    for (const key of ["a", "b", "c"]) assert.equal(limit.take(key, 0), true);
    assert.equal(limit.take("d", 1), false);
  });

  test("links the first and last pages and the ones around this one", () => {
    assert.deepEqual(pageLinks(1, 1), [1]);
    assert.deepEqual(pageLinks(1, 10), [1, 2, 3, 10]);
    assert.deepEqual(pageLinks(6, 10), [1, 4, 5, 6, 7, 8, 10]);
  });
});
