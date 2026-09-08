import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AutomodState } from "../dist/state.js";

describe("AutomodState", () => {
  test("returns no history for a member's first message", () => {
    const state = new AutomodState();
    const history = state.recordAndGetHistory("guild-1", "user-1", {
      content: "hi",
      timestamp: 1000,
    });
    assert.deepEqual(history, []);
  });

  test("returns prior messages, not including the one just recorded", () => {
    const state = new AutomodState();
    state.recordAndGetHistory("guild-1", "user-1", { content: "one", timestamp: 1000 });
    const history = state.recordAndGetHistory("guild-1", "user-1", {
      content: "two",
      timestamp: 1100,
    });
    assert.deepEqual(history, [{ content: "one", timestamp: 1000 }]);
  });

  test("keeps guilds and members separate", () => {
    const state = new AutomodState();
    state.recordAndGetHistory("guild-1", "user-1", { content: "one", timestamp: 1000 });
    const otherGuild = state.recordAndGetHistory("guild-2", "user-1", {
      content: "two",
      timestamp: 1000,
    });
    const otherUser = state.recordAndGetHistory("guild-1", "user-2", {
      content: "three",
      timestamp: 1000,
    });
    assert.deepEqual(otherGuild, []);
    assert.deepEqual(otherUser, []);
  });

  test("prunes entries older than the retention window", () => {
    const state = new AutomodState();
    state.recordAndGetHistory("guild-1", "user-1", { content: "old", timestamp: 0 });
    const history = state.recordAndGetHistory("guild-1", "user-1", {
      content: "new",
      timestamp: 11 * 60 * 1000,
    });
    assert.deepEqual(history, []);
  });

  test("caps how many messages one member can accumulate", () => {
    const state = new AutomodState();
    for (let i = 0; i < 25; i++) {
      state.recordAndGetHistory("guild-1", "user-1", { content: `m${i}`, timestamp: i });
    }
    const history = state.recordAndGetHistory("guild-1", "user-1", { content: "last", timestamp: 25 });
    assert.ok(history.length <= 20);
  });

  test("the returned history is a copy the caller cannot use to corrupt state", () => {
    const state = new AutomodState();
    state.recordAndGetHistory("guild-1", "user-1", { content: "one", timestamp: 1000 });
    const history = state.recordAndGetHistory("guild-1", "user-1", {
      content: "two",
      timestamp: 1100,
    });
    history.push({ content: "tampered", timestamp: 9999 });
    const next = state.recordAndGetHistory("guild-1", "user-1", {
      content: "three",
      timestamp: 1200,
    });
    assert.equal(
      next.some((m) => m.content === "tampered"),
      false,
    );
  });

  test("forgetting a guild drops its tracked members", () => {
    const state = new AutomodState();
    state.recordAndGetHistory("guild-1", "user-1", { content: "one", timestamp: 1000 });
    state.forgetGuild("guild-1");
    const history = state.recordAndGetHistory("guild-1", "user-1", {
      content: "two",
      timestamp: 1100,
    });
    assert.deepEqual(history, []);
  });

  test("a guild at its member cap evicts the least recently seen member", () => {
    const state = new AutomodState();
    // Fill the guild to capacity with distinct members, then confirm the
    // very first one (least recently seen) is gone once a new member joins.
    for (let i = 0; i < 5000; i++) {
      state.recordAndGetHistory("guild-1", `user-${i}`, { content: "hi", timestamp: i });
    }
    state.recordAndGetHistory("guild-1", "user-5000", { content: "hi", timestamp: 5000 });
    const history = state.recordAndGetHistory("guild-1", "user-0", {
      content: "back again",
      timestamp: 6000,
    });
    // Evicted means this counts as a brand new member: no prior history.
    assert.deepEqual(history, []);
  });
});
