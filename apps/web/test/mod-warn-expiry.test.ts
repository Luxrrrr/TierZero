import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { InfractionDto, UserRef } from "@tier0/core";
import { automaticLine, infractionStatus } from "../components/mod/format.ts";
import { describeState, infractionState } from "../app/guilds/[id]/mod/actions/params.ts";
import { automaticFromHref, warnExpiry } from "../app/guilds/[id]/mod/members/[userId]/timeline.ts";

const NOW = new Date("2026-10-17T12:00:00Z");
const user: UserRef = { userId: "100000000000000001", name: "FragMaster", avatarUrl: null, inServer: true };

function entry(action: string, fields: Partial<InfractionDto> = {}): InfractionDto {
  return {
    id: 1,
    caseNumber: 1,
    user,
    moderator: user,
    action,
    reason: null,
    createdAt: "2026-09-01T12:00:00Z",
    expiresAt: null,
    active: true,
    voided: null,
    evidence: [],
    edited: null,
    ...fields,
  };
}

const expired = entry("warn", { warnExpiresAt: "2026-10-01T12:00:00Z" });
const counting = entry("warn", { warnExpiresAt: "2026-11-01T12:00:00Z" });

describe("an expired warning", () => {
  test("reads as expired on the shared pill and in Mod logs", () => {
    assert.equal(infractionStatus(expired, NOW), "expired");
    assert.equal(infractionState(expired, NOW), "expired");
    const state = describeState(expired, NOW);
    assert.equal(state.label, "Expired");
    assert.match(state.detail, /^Stopped counting on Oct 1, 12:00 UTC\./);
  });

  test("an automod warning expires the same way", () => {
    assert.equal(infractionState(entry("automod-warn", { warnExpiresAt: "2026-10-01T12:00:00Z" }), NOW), "expired");
  });

  test("a warning that still counts is on record, and says until when", () => {
    assert.equal(infractionStatus(counting, NOW), "recorded");
    const state = describeState(counting, NOW);
    assert.equal(state.label, "On record");
    assert.equal(state.detail, "Counts until Nov 1, 12:00 UTC.");
  });

  test("a warning on a server without warn expiry stays on record", () => {
    assert.equal(infractionState(entry("warn"), NOW), "recorded");
    assert.equal(infractionState(entry("warn", { warnExpiresAt: null }), NOW), "recorded");
  });

  test("removal still wins", () => {
    const removed = { ...expired, voided: { at: "2026-10-02T00:00:00Z", by: user, reason: null } };
    assert.equal(infractionState(removed, NOW), "removed");
    assert.equal(warnExpiry(removed, NOW), null);
  });

  test("the case card knows when it stopped or will stop counting", () => {
    assert.deepEqual(warnExpiry(expired, NOW), { state: "expired", at: "2026-10-01T12:00:00Z" });
    assert.deepEqual(warnExpiry(counting, NOW), { state: "counting", until: "2026-11-01T12:00:00Z" });
    assert.equal(warnExpiry(entry("timeout", { warnExpiresAt: "2026-10-01T12:00:00Z" }), NOW), null);
  });
});

describe("automatic cases", () => {
  test("say which rule fired and on how many warnings", () => {
    assert.equal(automaticLine({ ruleId: "r1", rule: "Three strikes", warns: 3, windowMs: 30 * 86_400_000, fromCase: 12 }), "Rule: Three strikes, 3 warnings in 30 days");
    assert.equal(automaticLine({ ruleId: "r2", rule: "  ", warns: 1, windowMs: null, fromCase: null }), "Rule: Escalation, 1 warning");
  });

  test("link to the warning that made the count on the same profile", () => {
    assert.equal(automaticFromHref("5", user.userId, 12), `/guilds/5/mod/members/${user.userId}?case=12`);
  });
});
