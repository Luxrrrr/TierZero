import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  APPEAL_LIMITS,
  can,
  caseStateOf,
  describeAutomatic,
  isAppealStatus,
  isCounting,
  isInForce,
  isWarning,
  presetNamed,
  readAutomatic,
  warnExpiresAt,
} from "../dist/mod.js";

const DAY = 86_400_000;
const NOW = new Date("2026-10-17T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

describe("warn expiry", () => {
  test("only warnings expire, and never when the server has no expiry", () => {
    assert.equal(warnExpiresAt("warn", daysAgo(1), null), null);
    assert.equal(warnExpiresAt("warn", daysAgo(1), 0), null);
    assert.equal(warnExpiresAt("kick", daysAgo(1), 30 * DAY), null);
    assert.equal(warnExpiresAt("ban", daysAgo(1), 30 * DAY), null);
    assert.equal(isWarning("warn"), true);
    assert.equal(isWarning("automod-warn"), true);
    assert.equal(isWarning("timeout"), false);
  });

  test("a warning expires its length after it was given", () => {
    const ends = warnExpiresAt("warn", daysAgo(10), 30 * DAY);
    assert.equal(ends?.getTime(), daysAgo(10).getTime() + 30 * DAY);
  });

  test("a warning counts until its expiry has passed, and an automod warning the same", () => {
    for (const action of ["warn", "automod-warn"]) {
      const fresh = { action, active: true, expiresAt: null, removed: false, warnExpiresAt: warnExpiresAt(action, daysAgo(10), 30 * DAY) };
      const old = { action, active: true, expiresAt: null, removed: false, warnExpiresAt: warnExpiresAt(action, daysAgo(31), 30 * DAY) };
      assert.equal(isCounting(fresh, NOW), true, action);
      assert.equal(isCounting(old, NOW), false, action);
    }
  });

  test("with no expiry every warning counts, and a removed one never does", () => {
    const entry = { action: "warn", active: true, expiresAt: null, removed: false, warnExpiresAt: null };
    assert.equal(isCounting(entry, NOW), true);
    assert.equal(isCounting({ ...entry, removed: true }, NOW), false);
  });

  test("an expired warning reads as expired, a current one as on record, and neither is ever in force", () => {
    const old = { action: "warn", active: true, expiresAt: null, removed: false, warnExpiresAt: warnExpiresAt("warn", daysAgo(31), 30 * DAY) };
    const fresh = { ...old, warnExpiresAt: warnExpiresAt("warn", daysAgo(2), 30 * DAY) };
    assert.equal(caseStateOf(old, NOW), "expired");
    assert.equal(caseStateOf(fresh, NOW), "on record");
    assert.equal(isInForce(old, NOW), false);
    assert.equal(isInForce(fresh, NOW), false);
    assert.equal(caseStateOf({ ...old, removed: true }, NOW), "removed");
  });
});

describe("presetNamed", () => {
  const presets = [
    { name: "Spam", reason: "Posting spam" },
    { name: "Raid  ", reason: "Part of a raid" },
  ];

  test("finds a preset by name without regard to case or surrounding space", () => {
    assert.equal(presetNamed("spam", presets)?.reason, "Posting spam");
    assert.equal(presetNamed("  SPAM ", presets)?.reason, "Posting spam");
    assert.equal(presetNamed("raid", presets)?.reason, "Part of a raid");
  });

  test("text that is not a preset's name is not a preset", () => {
    assert.equal(presetNamed("Posting spam", presets), null);
    assert.equal(presetNamed("", presets), null);
    assert.equal(presetNamed(null, presets), null);
    assert.equal(presetNamed(undefined, presets), null);
  });
});

describe("automatic cases", () => {
  test("a stored case reads back, and damaged text reads as none", () => {
    const stored = JSON.stringify({ ruleId: "r1", rule: "Three strikes", warns: 3, windowMs: 30 * DAY, fromCase: 12 });
    assert.deepEqual(readAutomatic(stored), { ruleId: "r1", rule: "Three strikes", warns: 3, windowMs: 30 * DAY, fromCase: 12 });
    assert.equal(readAutomatic(null), null);
    assert.equal(readAutomatic(""), null);
    assert.equal(readAutomatic("{not json"), null);
    assert.equal(readAutomatic(JSON.stringify({ warns: 3 })), null);
  });

  test("describes the count and its window", () => {
    const base = { ruleId: "r", rule: "x", fromCase: null };
    assert.equal(describeAutomatic({ ...base, warns: 3, windowMs: null }), "3 warnings");
    assert.equal(describeAutomatic({ ...base, warns: 1, windowMs: DAY }), "1 warning in 1 day");
    assert.equal(describeAutomatic({ ...base, warns: 4, windowMs: 30 * DAY }), "4 warnings in 30 days");
    assert.equal(describeAutomatic({ ...base, warns: 2, windowMs: 3_600_000 * 6 }), "2 warnings in 6 hours");
  });
});

describe("appeal, lockdown and mass action permissions", () => {
  test("only admins and the owner may decide appeals, lock channels and act in bulk", () => {
    for (const permission of ["appeals.manage", "raid.lockdown", "raid.mass"] as const) {
      assert.equal(can("mod", permission), false, `mod ${permission}`);
      assert.equal(can("admin", permission), true, `admin ${permission}`);
      assert.equal(can("owner", permission), true, `owner ${permission}`);
    }
  });

  test("appeal statuses and limits", () => {
    assert.equal(isAppealStatus("pending"), true);
    assert.equal(isAppealStatus("accepted"), true);
    assert.equal(isAppealStatus("denied"), true);
    assert.equal(isAppealStatus("withdrawn"), false);
    assert.equal(isAppealStatus(null), false);
    assert.ok(APPEAL_LIMITS.text <= 4000, "a modal holds at most 4000 characters");
  });
});
