import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { AppealLimiter, appealBlock, retryNote } from "../dist/appeals.js";

const NOW = new Date("2026-10-17T12:00:00Z");
const DAY = 86_400_000;
const ban = { id: 7, caseNumber: 42 } as never;

function facts(patch: Record<string, unknown> = {}) {
  return { enabled: true, ban, discordBanned: true, hasPending: false, lastDeniedAt: null, cooldownMs: 7 * DAY, ...patch } as never;
}

describe("appealBlock", () => {
  test("a banned member of a server that takes appeals may appeal", () => {
    const block = appealBlock(facts(), NOW);
    assert.equal(block.kind, "open");
  });

  test("a server with appeals off refuses", () => {
    assert.equal(appealBlock(facts({ enabled: false }), NOW).kind, "closed");
  });

  test("a member with no ban on the record, or already unbanned in Discord, has nothing to appeal", () => {
    assert.equal(appealBlock(facts({ ban: null }), NOW).kind, "notBanned");
    assert.equal(appealBlock(facts({ discordBanned: false }), NOW).kind, "notBanned");
  });

  test("when Discord could not be asked the record decides", () => {
    assert.equal(appealBlock(facts({ discordBanned: null }), NOW).kind, "open");
  });

  test("an appeal still waiting blocks a second", () => {
    const block = appealBlock(facts({ hasPending: true }), NOW);
    assert.deepEqual(block, { kind: "alreadyOpen", caseNumber: 42 });
  });

  test("a denied appeal blocks another until the cooldown has passed", () => {
    const denied = new Date(NOW.getTime() - 2 * DAY);
    const block = appealBlock(facts({ lastDeniedAt: denied }), NOW);
    assert.equal(block.kind, "cooldown");
    if (block.kind === "cooldown") assert.equal(block.until.getTime(), denied.getTime() + 7 * DAY);
    assert.equal(appealBlock(facts({ lastDeniedAt: new Date(NOW.getTime() - 8 * DAY) }), NOW).kind, "open");
  });

  test("a cooldown of 0 lets them appeal again straight away", () => {
    assert.equal(appealBlock(facts({ lastDeniedAt: new Date(NOW.getTime() - 1000), cooldownMs: 0 }), NOW).kind, "open");
  });
});

describe("AppealLimiter", () => {
  test("allows a few presses in the window and then refuses", () => {
    const limiter = new AppealLimiter(3, 60_000);
    assert.deepEqual([0, 1, 2, 3].map((i) => limiter.take("u", i)), [true, true, true, false]);
  });

  test("lets them through again once the window has passed", () => {
    const limiter = new AppealLimiter(2, 60_000);
    limiter.take("u", 0);
    limiter.take("u", 1);
    assert.equal(limiter.take("u", 2), false);
    assert.equal(limiter.take("u", 60_001), true);
  });

  test("members are limited separately", () => {
    const limiter = new AppealLimiter(1, 60_000);
    assert.equal(limiter.take("a", 0), true);
    assert.equal(limiter.take("b", 0), true);
    assert.equal(limiter.take("a", 1), false);
  });
});

describe("retryNote", () => {
  const settings = (cooldown: number) =>
    ({ appeals: { cooldown }, labels: { notes: { appealRetry: "You can appeal again {when}." } } }) as never;

  test("says when they may appeal again, or nothing when there is no wait", () => {
    const at = new Date("2026-10-17T12:00:00Z");
    const seconds = Math.floor((at.getTime() + 7 * DAY) / 1000);
    assert.equal(retryNote(settings(7 * DAY), at), ` You can appeal again <t:${seconds}:R>.`);
    assert.equal(retryNote(settings(0), at), "");
  });
});
