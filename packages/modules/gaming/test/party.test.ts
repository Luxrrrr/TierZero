import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { canJoin, canLeave, cooldownLeft, expiryOf, partyLines, partyOf } from "../dist/party.js";

const post = (extra = {}) => ({ status: "open", needed: 2, authorId: "a", joined: [] as string[], ...extra });

describe("the party", () => {
  test("counts the author as the first player", () => {
    assert.deepEqual(partyOf(3, 0), { capacity: 4, filled: 1, open: 3, full: false });
    assert.deepEqual(partyOf(3, 2), { capacity: 4, filled: 3, open: 1, full: false });
    assert.deepEqual(partyOf(3, 3), { capacity: 4, filled: 4, open: 0, full: true });
  });

  test("never reports more than its places", () => {
    assert.equal(partyOf(1, 5).filled, 2);
    assert.equal(partyOf(1, 5).open, 0);
  });
});

describe("joining", () => {
  test("is allowed while there is room", () => {
    assert.equal(canJoin(post(), "b"), "ok");
    assert.equal(canJoin(post({ joined: ["b"] }), "c"), "ok");
  });

  test("is refused for the author, for someone already in and for a full or ended post", () => {
    assert.equal(canJoin(post(), "a"), "author");
    assert.equal(canJoin(post({ joined: ["b"] }), "b"), "already");
    assert.equal(canJoin(post({ joined: ["b", "c"] }), "d"), "full");
    assert.equal(canJoin(post({ status: "full" }), "d"), "full");
    assert.equal(canJoin(post({ status: "closed" }), "d"), "ended");
    assert.equal(canJoin(post({ status: "expired" }), "d"), "ended");
  });
});

describe("leaving", () => {
  test("is for someone in the party", () => {
    assert.equal(canLeave(post({ joined: ["b"] }), "b"), "ok");
    assert.equal(canLeave(post(), "b"), "notIn");
    assert.equal(canLeave(post(), "a"), "author");
    assert.equal(canLeave(post({ status: "full", joined: ["b"] }), "b"), "ended");
  });
});

describe("expiry", () => {
  const hour = 3_600_000;
  const postedAt = new Date("2026-11-01T12:00:00Z");

  test("counts from the posting when there is no start", () => {
    assert.equal(expiryOf(postedAt, null, 2 * hour).toISOString(), "2026-11-01T14:00:00.000Z");
  });

  test("counts from the start when it is later", () => {
    assert.equal(expiryOf(postedAt, new Date("2026-11-01T20:00:00Z"), 2 * hour).toISOString(), "2026-11-01T22:00:00.000Z");
  });

  test("ignores a start that has already passed", () => {
    assert.equal(expiryOf(postedAt, new Date("2026-11-01T10:00:00Z"), 2 * hour).toISOString(), "2026-11-01T14:00:00.000Z");
  });
});

describe("the wait between posts", () => {
  const now = new Date("2026-11-01T12:10:00Z");

  test("is what is left of it", () => {
    assert.equal(cooldownLeft(new Date("2026-11-01T12:05:00Z"), 10 * 60_000, now), 5 * 60_000);
  });

  test("is nothing when it has passed, when there was no post or when it is off", () => {
    assert.equal(cooldownLeft(new Date("2026-11-01T11:00:00Z"), 10 * 60_000, now), 0);
    assert.equal(cooldownLeft(null, 10 * 60_000, now), 0);
    assert.equal(cooldownLeft(new Date("2026-11-01T12:09:00Z"), 0, now), 0);
  });
});

test("the party list puts the author first", () => {
  assert.equal(partyLines("a", ["b", "c"]), "<@a>\n<@b>\n<@c>");
});
