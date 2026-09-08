import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseDuration,
  validateTimeoutDuration,
  validateBanDuration,
  deleteMessageSeconds,
  MAX_TIMEOUT_MS,
  BULK_DELETE_WINDOW_MS,
} from "../dist/duration.js";

describe("parseDuration", () => {
  test("parses seconds, minutes, hours and days", () => {
    assert.equal(parseDuration("30s"), 30_000);
    assert.equal(parseDuration("10m"), 600_000);
    assert.equal(parseDuration("2h"), 7_200_000);
    assert.equal(parseDuration("7d"), 604_800_000);
  });

  test("trims surrounding whitespace", () => {
    assert.equal(parseDuration("  5m  "), 300_000);
  });

  test("rejects an unrecognised unit", () => {
    assert.equal(parseDuration("5w"), null);
  });

  test("rejects garbage input", () => {
    assert.equal(parseDuration("soon"), null);
    assert.equal(parseDuration(""), null);
    assert.equal(parseDuration("5"), null);
  });

  test("rejects a zero amount", () => {
    assert.equal(parseDuration("0m"), null);
  });
});

describe("validateTimeoutDuration", () => {
  test("accepts anything up to 28 days", () => {
    const result = validateTimeoutDuration(MAX_TIMEOUT_MS);
    assert.deepEqual(result, { ok: true, ms: MAX_TIMEOUT_MS });
  });

  test("rejects one millisecond past 28 days", () => {
    const result = validateTimeoutDuration(MAX_TIMEOUT_MS + 1);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /28 days/);
  });

  test("rejects zero and negative durations", () => {
    assert.equal(validateTimeoutDuration(0).ok, false);
    assert.equal(validateTimeoutDuration(-1000).ok, false);
  });

  test("rejects non-finite input", () => {
    assert.equal(validateTimeoutDuration(NaN).ok, false);
    assert.equal(validateTimeoutDuration(Infinity).ok, false);
  });

  test("accepts an ordinary duration", () => {
    assert.deepEqual(validateTimeoutDuration(600_000), { ok: true, ms: 600_000 });
  });
});

describe("validateBanDuration", () => {
  test("has no ceiling: a duration far past 28 days is fine", () => {
    const result = validateBanDuration(MAX_TIMEOUT_MS * 10);
    assert.deepEqual(result, { ok: true, ms: MAX_TIMEOUT_MS * 10 });
  });

  test("still rejects zero or negative durations", () => {
    assert.equal(validateBanDuration(0).ok, false);
    assert.equal(validateBanDuration(-1).ok, false);
  });
});

describe("deleteMessageSeconds", () => {
  test("converts days to seconds", () => {
    assert.equal(deleteMessageSeconds(1), 86_400);
    assert.equal(deleteMessageSeconds(7), 604_800);
  });

  test("clamps above 7 days", () => {
    assert.equal(deleteMessageSeconds(30), 604_800);
  });

  test("clamps below 0 days", () => {
    assert.equal(deleteMessageSeconds(-5), 0);
  });

  test("truncates a fractional day", () => {
    assert.equal(deleteMessageSeconds(2.9), 172_800);
  });
});

describe("BULK_DELETE_WINDOW_MS", () => {
  test("is exactly 14 days", () => {
    assert.equal(BULK_DELETE_WINDOW_MS, 14 * 24 * 60 * 60 * 1000);
  });
});
