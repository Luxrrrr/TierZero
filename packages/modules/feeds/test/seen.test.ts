import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { selectNew } from "../dist/seen.js";

const item = (id: string) => ({ id });

describe("selectNew", () => {
  test("posts only the newest item the first time a source is read", () => {
    const result = selectNew([item("c"), item("b"), item("a")], null, 5);
    assert.deepEqual(result.post.map((i) => i.id), ["c"]);
    assert.deepEqual(result.seen, ["c", "b", "a"]);
  });

  test("posts nothing the first time when the source is empty", () => {
    assert.deepEqual(selectNew([], null, 5), { post: [], seen: [] });
  });

  test("posts what is new, oldest first, so the channel reads in order", () => {
    const result = selectNew([item("d"), item("c"), item("b")], ["b", "a"], 5);
    assert.deepEqual(result.post.map((i) => i.id), ["c", "d"]);
  });

  test("posts nothing when every item has been seen", () => {
    assert.deepEqual(selectNew([item("b"), item("a")], ["a", "b"], 5).post, []);
  });

  test("caps a flood and keeps the newest items, marking the rest seen", () => {
    const flood = ["f", "e", "d", "c", "b", "a"].map(item);
    const result = selectNew(flood, ["z"], 2);
    assert.deepEqual(result.post.map((i) => i.id), ["e", "f"]);
    assert.ok(result.seen.includes("a"));
  });

  test("remembers ids that dropped out of the feed so a returning item is not reposted", () => {
    const result = selectNew([item("b")], ["a", "b"], 5);
    assert.deepEqual(result.seen, ["b", "a"]);
  });

  test("never remembers more than a bounded number of ids", () => {
    const old = Array.from({ length: 500 }, (_, i) => `old-${i}`);
    assert.equal(selectNew([item("new")], old, 5).seen.length, 200);
  });
});
