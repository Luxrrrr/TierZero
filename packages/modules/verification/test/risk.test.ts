import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { HIGH_AT, MEDIUM_AT, RAID_BONUS, REMOVE_AT, RecentJoins, assess, challengeFor, clearlyRaid, riskNote, tierOf, withRaid } from "../dist/risk.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const now = 1_800_000_000_000;

const settled = { created: now - 400 * DAY, name: "Ada", defaultAvatar: false };
const fresh = { created: now - 2 * HOUR, name: "Newcomer", defaultAvatar: true };

/** Accounts made within the same hour, with names from one batch, that joined a few seconds apart. */
function batch(count: number, created = now - 3 * HOUR) {
  return Array.from({ length: count }, (_, i) => ({ at: now - (count - i) * 1000, created: created + i * 60_000, name: `raider${100000 + i}` }));
}

describe("an ordinary member", () => {
  test("an old account with a picture scores nothing", () => {
    const result = assess(settled, now, []);
    assert.equal(result.score, 0);
    assert.equal(result.tier, "low");
    assert.deepEqual(result.reasons, []);
  });

  test("an old account with no picture is still low", () => {
    assert.equal(assess({ ...settled, defaultAvatar: true }, now, []).tier, "low");
  });

  test("a brand new account with no picture, and a name full of numbers, is medium and not high", () => {
    const result = assess({ created: now - 5 * HOUR, name: "player12345", defaultAvatar: true }, now, []);
    assert.equal(result.tier, "medium");
    assert.ok(result.score < HIGH_AT);
  });

  test("an old account in a crowd of old accounts, as when an invite goes round, stays low", () => {
    const crowd = Array.from({ length: 30 }, (_, i) => ({ at: now - i * 1000, created: now - (200 + i * 30) * DAY, name: `member${i}` }));
    const result = assess(settled, now, crowd);
    assert.equal(result.tier, "low");
    assert.ok(result.score <= 10);
  });

  test("a new account is a little suspect, more so the newer it is", () => {
    const scoreAt = (days: number) => assess({ ...settled, created: now - days * DAY }, now, []).score;
    assert.ok(scoreAt(0.5) > scoreAt(2));
    assert.ok(scoreAt(2) > scoreAt(5));
    assert.ok(scoreAt(5) > scoreAt(20));
    assert.equal(scoreAt(60), 0);
  });
});

describe("a raid", () => {
  test("new accounts made around the same time, joining together, score high", () => {
    const result = assess({ created: now - 3 * HOUR + 7 * 60_000, name: "raider100099", defaultAvatar: true }, now, batch(8));
    assert.equal(result.tier, "high");
    assert.ok(result.clustered);
    assert.ok(result.reasons.some((reason) => reason.includes("made within an hour")));
  });

  test("the first of a batch cannot be told from anyone else, which is the cost of seeing only what came before", () => {
    const result = assess({ created: now - 3 * HOUR, name: "raider100000", defaultAvatar: true }, now, []);
    assert.equal(result.clustered, false);
    assert.equal(result.tier, "medium");
  });

  test("accounts made at different times do not count as a batch", () => {
    const spread = Array.from({ length: 8 }, (_, i) => ({ at: now - i * 1000, created: now - (10 + i * 40) * DAY, name: `other${i}` }));
    assert.equal(assess(fresh, now, spread).clustered, false);
  });

  test("names from one batch count against a member even when the accounts are not new", () => {
    const names = [1, 2, 3].map((i) => ({ at: now - i * 1000, created: now - (100 + i * 50) * DAY, name: `grabber${i}x` }));
    const result = assess({ ...settled, name: "grabber9x" }, now, names);
    assert.ok(result.reasons.some((reason) => reason.includes("name is like")));
    assert.equal(result.score, 20);
  });

  test("raid protection being on counts against everyone who joins then", () => {
    const base = assess(settled, now, []);
    const during = withRaid(base, true);
    assert.equal(during.score, base.score + RAID_BONUS);
    assert.equal(during.tier, "medium");
    assert.deepEqual(withRaid(base, false), base);
  });

  test("a score never goes over a hundred", () => {
    const result = withRaid(assess(fresh, now, batch(10)), true);
    assert.equal(result.score, 100);
  });
});

describe("removing the clearest cases", () => {
  test("takes a new account that joined in a batch and scores very high", () => {
    const result = assess({ created: now - 3 * HOUR + 9 * 60_000, name: "raider100099", defaultAvatar: true }, now, batch(8));
    assert.ok(result.score >= REMOVE_AT);
    assert.ok(clearlyRaid(result));
  });

  test("leaves a high score that did not come from a batch", () => {
    const result = withRaid(assess({ created: now - 5 * HOUR, name: "player12345", defaultAvatar: true }, now, []), true);
    assert.ok(result.score >= HIGH_AT);
    assert.equal(clearlyRaid(result), false);
  });

  test("leaves a batch that does not score high enough", () => {
    const result = assess({ ...settled, created: now - 40 * DAY, defaultAvatar: false }, now, batch(1));
    assert.equal(clearlyRaid(result), false);
  });
});

describe("the tiers", () => {
  test("change at the scores set", () => {
    assert.equal(tierOf(MEDIUM_AT - 1), "low");
    assert.equal(tierOf(MEDIUM_AT), "medium");
    assert.equal(tierOf(HIGH_AT - 1), "medium");
    assert.equal(tierOf(HIGH_AT), "high");
  });

  test("give an ordinary member fewer and easier rounds, and a suspect more and harder ones", () => {
    const low = challengeFor("low", 2);
    const medium = challengeFor("medium", 2);
    const high = challengeFor("high", 2);
    assert.deepEqual([low.rounds, medium.rounds, high.rounds], [1, 2, 3]);
    assert.deepEqual([...high.types], ["colour", "motion", "tiles"]);
    assert.deepEqual([...medium.types], ["text", "colour", "tiles"]);
    assert.ok(low.types.every((type) => type === "text" || type === "block"));
  });

  test("keep the number of rounds between one and five", () => {
    assert.equal(challengeFor("low", 1).rounds, 1);
    assert.equal(challengeFor("high", 5).rounds, 5);
  });
});

describe("the note in the log", () => {
  test("is empty for an ordinary member", () => {
    assert.equal(riskNote(assess(settled, now, [])), "");
  });

  test("names the level and the reasons for anyone else", () => {
    const note = riskNote(assess(fresh, now, []));
    assert.match(note, /^\nRisk: \*\*medium\*\*: account is 2 hours old, no profile picture\.$/);
  });
});

describe("recent joins", () => {
  test("give the ones from the last minute, not including the one being recorded", () => {
    const joins = new RecentJoins();
    assert.deepEqual(joins.record("g", { at: 0, created: 1, name: "a" }), []);
    assert.equal(joins.record("g", { at: 30_000, created: 1, name: "b" }).length, 1);
    assert.equal(joins.record("g", { at: 50_000, created: 1, name: "c" }).length, 2);
  });

  test("let go of the ones that are over a minute old", () => {
    const joins = new RecentJoins();
    joins.record("g", { at: 0, created: 1, name: "a" });
    joins.record("g", { at: 40_000, created: 1, name: "b" });
    assert.deepEqual(joins.record("g", { at: 70_000, created: 1, name: "c" }).map((other) => other.name), ["b"]);
  });

  test("keep servers apart", () => {
    const joins = new RecentJoins();
    joins.record("g", { at: 0, created: 1, name: "a" });
    assert.deepEqual(joins.record("h", { at: 1000, created: 1, name: "b" }), []);
  });
});
