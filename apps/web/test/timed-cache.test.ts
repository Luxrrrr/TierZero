import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createTimedCache } from "../lib/timed-cache.ts";

describe("createTimedCache", () => {
  test("returns a value until its time is up", () => {
    const cache = createTimedCache<string>({ ttlMs: 1000, maxEntries: 10 });
    cache.set("a", "one", 0);
    assert.equal(cache.get("a", 999), "one");
    assert.equal(cache.get("a", 1000), undefined);
    assert.equal(cache.get("nothing", 0), undefined);
  });

  test("setting again starts the time over", () => {
    const cache = createTimedCache<string>({ ttlMs: 1000, maxEntries: 10 });
    cache.set("a", "one", 0);
    cache.set("a", "two", 900);
    assert.equal(cache.get("a", 1500), "two");
  });

  test("never holds more than its limit, dropping what has expired before what is still good", () => {
    const cache = createTimedCache<number>({ ttlMs: 1000, maxEntries: 2 });
    cache.set("old", 1, 0);
    cache.set("new", 2, 900);
    cache.set("third", 3, 1100);
    assert.equal(cache.get("old", 1100), undefined);
    assert.equal(cache.get("new", 1100), 2);
    assert.equal(cache.get("third", 1100), 3);
  });

  test("when nothing has expired the oldest entry makes room", () => {
    const cache = createTimedCache<number>({ ttlMs: 10_000, maxEntries: 2 });
    cache.set("a", 1, 0);
    cache.set("b", 2, 1);
    cache.set("c", 3, 2);
    assert.equal(cache.get("a", 3), undefined);
    assert.equal(cache.get("b", 3), 2);
    assert.equal(cache.get("c", 3), 3);
  });
});
