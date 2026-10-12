import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { RECENT_LIMITS, RecentMessages } from "../dist/recent-messages.js";

const make = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  channelId: "c1",
  channelName: "general",
  authorId: "u1",
  content: "hello " + id,
  attachments: [],
  createdAt: 1_000_000,
  deleted: false,
  ...patch,
});

describe("RecentMessages", () => {
  test("keeps a member's messages newest first, per server", () => {
    const store = new RecentMessages(() => 1_000_000);
    store.record("g1", make("a", { createdAt: 1_000_000 }));
    store.record("g1", make("b", { createdAt: 1_000_001 }));
    store.record("g2", make("c"));
    assert.deepEqual(store.forMember("g1", "u1").map((m) => m.id), ["b", "a"]);
    assert.deepEqual(store.forMember("g2", "u1").map((m) => m.id), ["c"]);
    assert.deepEqual(store.forMember("g1", "u2"), []);
  });

  test("keeps only the latest few for each member", () => {
    const store = new RecentMessages(() => 1_000_000);
    for (let i = 0; i < RECENT_LIMITS.perMember + 5; i += 1) store.record("g", make(String(i)));
    const kept = store.forMember("g", "u1");
    assert.equal(kept.length, RECENT_LIMITS.perMember);
    assert.equal(kept[0]?.id, String(RECENT_LIMITS.perMember + 4));
    assert.equal(store.find("0"), undefined);
  });

  test("forgets messages older than the time limit", () => {
    let now = 1_000_000;
    const store = new RecentMessages(() => now);
    store.record("g", make("old", { createdAt: now }));
    now += RECENT_LIMITS.ttlMs + 1;
    store.record("g", make("new", { createdAt: now }));
    assert.deepEqual(store.forMember("g", "u1").map((m) => m.id), ["new"]);
    assert.equal(store.find("old"), undefined);
  });

  test("a deleted message stays, marked, so it can still be shown", () => {
    const store = new RecentMessages(() => 1_000_000);
    store.record("g", make("a"));
    store.markDeleted("a");
    assert.equal(store.forMember("g", "u1")[0]?.deleted, true);
  });

  test("an edit changes what is remembered", () => {
    const store = new RecentMessages(() => 1_000_000);
    store.record("g", make("a"));
    store.edit("a", "changed");
    assert.equal(store.find("a")?.content, "changed");
  });

  test("very long content is cut", () => {
    const store = new RecentMessages(() => 1_000_000);
    store.record("g", make("a", { content: "x".repeat(RECENT_LIMITS.content + 500) }));
    assert.equal(store.find("a")?.content.length, RECENT_LIMITS.content);
  });

  test("the least recently active member is dropped first when full", () => {
    const store = new RecentMessages(() => 1_000_000);
    for (let i = 0; i <= RECENT_LIMITS.members; i += 1) store.record("g", make("m" + i, { authorId: "user" + i }));
    assert.equal(store.size, RECENT_LIMITS.members);
    assert.deepEqual(store.forMember("g", "user0"), []);
    assert.equal(store.forMember("g", "user" + RECENT_LIMITS.members).length, 1);
  });
});
