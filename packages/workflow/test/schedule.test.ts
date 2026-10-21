import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TIME, nextRun } from "../dist/schedule.js";

const at = (text: string) => Date.parse(text);

describe("the next time a schedule runs", () => {
  test("every day, later today or tomorrow", () => {
    const rule = { every: "day" as const, time: "20:00", weekday: 1 };
    assert.equal(nextRun(at("2026-10-20T10:00:00Z"), rule, "UTC"), at("2026-10-20T20:00:00Z"));
    assert.equal(nextRun(at("2026-10-20T20:00:00Z"), rule, "UTC"), at("2026-10-21T20:00:00Z"));
    assert.equal(nextRun(at("2026-10-20T23:30:00Z"), rule, "UTC"), at("2026-10-21T20:00:00Z"));
  });

  test("every week, on the day asked for", () => {
    const rule = { every: "week" as const, time: "09:30", weekday: 5 };
    // 2026-10-20 is a Tuesday, so the next Friday is the 23rd.
    assert.equal(nextRun(at("2026-10-20T10:00:00Z"), rule, "UTC"), at("2026-10-23T09:30:00Z"));
    assert.equal(nextRun(at("2026-10-23T09:30:00Z"), rule, "UTC"), at("2026-10-30T09:30:00Z"));
  });

  test("every hour, at the minutes of the time", () => {
    const rule = { every: "hour" as const, time: "00:15", weekday: 0 };
    assert.equal(nextRun(at("2026-10-20T10:05:00Z"), rule, "UTC"), at("2026-10-20T10:15:00Z"));
    assert.equal(nextRun(at("2026-10-20T10:15:00Z"), rule, "UTC"), at("2026-10-20T11:15:00Z"));
    assert.equal(nextRun(at("2026-10-20T23:45:00Z"), rule, "UTC"), at("2026-10-21T00:15:00Z"));
  });

  test("reads the time in the server's zone", () => {
    const rule = { every: "day" as const, time: "20:00", weekday: 0 };
    // Tokyo is nine hours ahead of UTC all year.
    assert.equal(nextRun(at("2026-10-20T10:00:00Z"), rule, "Asia/Tokyo"), at("2026-10-20T11:00:00Z"));
    // New York is on daylight time in October, four hours behind.
    assert.equal(nextRun(at("2026-10-20T10:00:00Z"), rule, "America/New_York"), at("2026-10-21T00:00:00Z"));
  });

  test("follows the clock change", () => {
    const rule = { every: "day" as const, time: "12:00", weekday: 0 };
    // New York goes back an hour on 1 November 2026.
    assert.equal(nextRun(at("2026-10-31T17:00:00Z"), rule, "America/New_York"), at("2026-11-01T17:00:00Z"));
    assert.equal(nextRun(at("2026-11-01T17:00:00Z"), rule, "America/New_York"), at("2026-11-02T17:00:00Z"));
  });

  test("an unknown zone is read as UTC, and a bad time gives nothing", () => {
    const rule = { every: "day" as const, time: "20:00", weekday: 0 };
    assert.equal(nextRun(at("2026-10-20T10:00:00Z"), rule, "Not/AZone"), at("2026-10-20T20:00:00Z"));
    assert.equal(nextRun(0, { ...rule, time: "25:00" }, "UTC"), null);
  });

  test("a time is hours and minutes", () => {
    assert.ok(TIME.test.test("00:00"));
    assert.ok(TIME.test.test("23:59"));
    assert.ok(!TIME.test.test("24:00"));
    assert.ok(!TIME.test.test("7:30"));
  });
});
