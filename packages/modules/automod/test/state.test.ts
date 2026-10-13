import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AutomodState, MAX_MESSAGES_PER_MEMBER, MAX_MESSAGE_AGE_MS } from "../dist/state.js";
import { settings } from "../dist/settings.js";

const msg = (fingerprint: string, timestamp: number) => ({ fingerprint, timestamp });

describe("AutomodState", () => {
  test("returns no history for a member's first message", () => {
    const state = new AutomodState();
    assert.deepEqual(state.recordAndGetHistory("guild-1", "user-1", msg("hi", 1000)), []);
  });

  test("returns prior messages, not including the one just recorded", () => {
    const state = new AutomodState();
    state.recordAndGetHistory("guild-1", "user-1", msg("one", 1000));
    assert.deepEqual(state.recordAndGetHistory("guild-1", "user-1", msg("two", 1100)), [msg("one", 1000)]);
  });

  test("keeps guilds and members separate", () => {
    const state = new AutomodState();
    state.recordAndGetHistory("guild-1", "user-1", msg("one", 1000));
    assert.deepEqual(state.recordAndGetHistory("guild-2", "user-1", msg("two", 1000)), []);
    assert.deepEqual(state.recordAndGetHistory("guild-1", "user-2", msg("three", 1000)), []);
  });

  test("prunes entries older than the retention window", () => {
    const state = new AutomodState();
    state.recordAndGetHistory("guild-1", "user-1", msg("old", 0));
    assert.deepEqual(state.recordAndGetHistory("guild-1", "user-1", msg("new", MAX_MESSAGE_AGE_MS + 1)), []);
  });

  test("caps how many messages one member can accumulate", () => {
    const state = new AutomodState();
    for (let i = 0; i < MAX_MESSAGES_PER_MEMBER + 5; i++) {
      state.recordAndGetHistory("guild-1", "user-1", msg(`m${i}`, i));
    }
    const history = state.recordAndGetHistory("guild-1", "user-1", msg("last", MAX_MESSAGES_PER_MEMBER + 5));
    assert.equal(history.length, MAX_MESSAGES_PER_MEMBER);
    assert.equal(history[0]?.fingerprint, "m5", "the oldest are the ones dropped");
  });

  test("the returned history is a copy the caller cannot use to corrupt state", () => {
    const state = new AutomodState();
    state.recordAndGetHistory("guild-1", "user-1", msg("one", 1000));
    const history = state.recordAndGetHistory("guild-1", "user-1", msg("two", 1100));
    history.push(msg("tampered", 9999));
    const next = state.recordAndGetHistory("guild-1", "user-1", msg("three", 1200));
    assert.equal(next.some((m) => m.fingerprint === "tampered"), false);
  });

  test("forgetting a guild drops its tracked members", () => {
    const state = new AutomodState();
    state.recordAndGetHistory("guild-1", "user-1", msg("one", 1000));
    state.forgetGuild("guild-1");
    assert.deepEqual(state.recordAndGetHistory("guild-1", "user-1", msg("two", 1100)), []);
  });

  test("a guild at its member cap evicts the least recently seen member", () => {
    const state = new AutomodState();
    for (let i = 0; i < 5000; i++) {
      state.recordAndGetHistory("guild-1", `user-${i}`, msg("hi", i));
    }
    // user-0 speaks again, so user-1 is now the one quiet longest.
    state.recordAndGetHistory("guild-1", "user-0", msg("hi", 5000));
    state.recordAndGetHistory("guild-1", "user-5000", msg("hi", 5001));
    assert.equal(state.recordAndGetHistory("guild-1", "user-0", msg("again", 6000)).length, 2, "kept");
    assert.deepEqual(state.recordAndGetHistory("guild-1", "user-1", msg("back", 6001)), [], "evicted");
  });
});

describe("what is retained covers what the settings allow", () => {
  const parsed = (patch: Record<string, unknown>) => settings.parse(patch);

  test("the largest rate limit the settings accept can still trip", () => {
    const largest = parsed({ rateLimit: { limit: 100 } });
    assert.equal(largest.ok, true);
    assert.equal(parsed({ rateLimit: { limit: 101 } }).ok, false);
    // A limit of N trips on the (N + 1)th message, so N earlier ones must survive.
    assert.ok(MAX_MESSAGES_PER_MEMBER >= 100);
  });

  test("the longest repeat window the settings accept is kept in full", () => {
    assert.equal(parsed({ repeatedText: { repeatWindow: "1h" } }).ok, true);
    assert.equal(parsed({ repeatedText: { repeatWindow: "61m" } }).ok, false);
    assert.ok(MAX_MESSAGE_AGE_MS >= 60 * 60 * 1000);
  });

  test("a member who sends the most the rate limit allows keeps every one of them", () => {
    const state = new AutomodState();
    for (let i = 0; i < 100; i++) state.recordAndGetHistory("g", "u", msg(`m${i}`, i * 1000));
    assert.equal(state.recordAndGetHistory("g", "u", msg("next", 100_000)).length, 100);
  });
});

describe("handled messages", () => {
  test("remembers a message by its id and what it said", () => {
    const state = new AutomodState();
    assert.equal(state.wasHandled("m1", "a"), false);
    state.markHandled("m1", "a");
    assert.equal(state.wasHandled("m1", "a"), true);
    assert.equal(state.wasHandled("m1", "b"), false, "an edit that changed the text is new");
    assert.equal(state.wasHandled("m2", "a"), false);
  });

  test("forgets the oldest once it holds too many", () => {
    const state = new AutomodState();
    for (let i = 0; i < 5001; i++) state.markHandled(`m${i}`, "a");
    assert.equal(state.wasHandled("m0", "a"), false);
    assert.equal(state.wasHandled("m1", "a"), true);
    assert.equal(state.wasHandled("m5000", "a"), true);
  });
});
