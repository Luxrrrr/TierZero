import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  describeDuration,
  formatDuration,
  toDurationString,
  toMilliseconds,
} from "../lib/duration.ts";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

describe("toMilliseconds", () => {
  test("passes a stored millisecond value straight through", () => {
    assert.equal(toMilliseconds(900_000), 900_000);
  });

  test("reads the written form a schema default uses", () => {
    assert.equal(toMilliseconds("15m"), 15 * MINUTE);
    assert.equal(toMilliseconds("28d"), 28 * DAY);
  });

  test("returns null for anything that is not a duration", () => {
    assert.equal(toMilliseconds("soon"), null);
    assert.equal(toMilliseconds(undefined), null);
    assert.equal(toMilliseconds(-5), null);
  });
});

describe("formatDuration", () => {
  test("uses the largest unit that divides the value evenly", () => {
    assert.deepEqual(formatDuration(2 * HOUR), { amount: 2, unit: "h" });
    assert.deepEqual(formatDuration(7 * DAY), { amount: 7, unit: "d" });
    assert.deepEqual(formatDuration(30_000), { amount: 30, unit: "s" });
  });

  test("keeps 90 minutes as minutes rather than rounding to hours", () => {
    assert.deepEqual(formatDuration(90 * MINUTE), { amount: 90, unit: "m" });
  });

  test("accepts the written form as readily as milliseconds", () => {
    assert.deepEqual(formatDuration("10m"), { amount: 10, unit: "m" });
  });

  test("falls back to zero seconds for a missing or unreadable value", () => {
    assert.deepEqual(formatDuration(undefined), { amount: 0, unit: "s" });
    assert.deepEqual(formatDuration("later"), { amount: 0, unit: "s" });
    assert.deepEqual(formatDuration(0), { amount: 0, unit: "s" });
  });
});

describe("toDurationString", () => {
  test("writes the form the control API accepts", () => {
    assert.equal(toDurationString({ amount: 15, unit: "m" }), "15m");
  });

  test("round-trips a stored value", () => {
    assert.equal(toDurationString(formatDuration(2 * HOUR)), "2h");
    assert.equal(toDurationString(formatDuration(24 * HOUR)), "1d");
  });
});

describe("describeDuration", () => {
  test("spells the unit out for hint text", () => {
    assert.equal(describeDuration("15m"), "15 minutes");
    assert.equal(describeDuration("28d"), "28 days");
  });

  test("drops the plural for a single unit", () => {
    assert.equal(describeDuration("1h"), "1 hour");
    assert.equal(describeDuration(1000), "1 second");
  });
});
