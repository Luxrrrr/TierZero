import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  bucketFor,
  bucketSeries,
  computeStats,
  dayMs,
  parseStatsRange,
  type StatsInfraction,
  type StatsPoint,
} from "../src/control/mod/stats-calc.ts";

const NOW = new Date("2026-10-09T15:30:00Z");

let counter = 0;
function row(at: string, overrides: Partial<StatsInfraction> = {}): StatsInfraction {
  counter++;
  return {
    userId: `griefer${counter}`,
    moderatorId: "raidlead",
    action: "warn",
    createdAt: new Date(at),
    expiresAt: null,
    active: false,
    voidedAt: null,
    ...overrides,
  };
}

const q = (text: string) => new URLSearchParams(text);

describe("parseStatsRange", () => {
  test("reads days, clamped to 1..365 with 30 as the default", () => {
    assert.deepEqual(parseStatsRange(q("days=7"), NOW), { kind: "days", days: 7 });
    assert.deepEqual(parseStatsRange(q("days=9999"), NOW), { kind: "days", days: 365 });
    assert.deepEqual(parseStatsRange(q(""), NOW), { kind: "days", days: 30 });
    assert.deepEqual(parseStatsRange(q("days=abc"), NOW), { kind: "days", days: 30 });
  });

  test("range=all wins over everything else", () => {
    assert.deepEqual(parseStatsRange(q("range=all&days=7&from=2026-01-01&to=2026-02-01"), NOW), { kind: "all" });
  });

  test("accepts a valid custom range", () => {
    assert.deepEqual(parseStatsRange(q("from=2026-09-01&to=2026-09-30"), NOW), {
      kind: "custom",
      from: "2026-09-01",
      to: "2026-09-30",
    });
    assert.deepEqual(parseStatsRange(q("from=2026-10-09&to=2026-10-09"), NOW), {
      kind: "custom",
      from: "2026-10-09",
      to: "2026-10-09",
    });
  });

  test("pulls an end in the future back to today", () => {
    assert.deepEqual(parseStatsRange(q("from=2026-10-01&to=2027-01-01"), NOW), {
      kind: "custom",
      from: "2026-10-01",
      to: "2026-10-09",
    });
  });

  test("falls back to days for bad, reversed, future or too long ranges", () => {
    const fallback = { kind: "days", days: 30 };
    assert.deepEqual(parseStatsRange(q("from=2026-02-30&to=2026-03-10"), NOW), fallback);
    assert.deepEqual(parseStatsRange(q("from=2026-9-1&to=2026-09-10"), NOW), fallback);
    assert.deepEqual(parseStatsRange(q("from=2026-09-10&to=2026-09-01"), NOW), fallback);
    assert.deepEqual(parseStatsRange(q("from=2026-11-01&to=2026-12-01"), NOW), fallback);
    assert.deepEqual(parseStatsRange(q("from=2020-01-01&to=2026-10-01"), NOW), fallback);
    assert.deepEqual(parseStatsRange(q("from=2026-09-01"), NOW), fallback);
    assert.deepEqual(parseStatsRange(q("from=2026-09-10&to=2026-09-01&days=7"), NOW), { kind: "days", days: 7 });
  });

  test("dayMs rejects anything that is not a real date", () => {
    assert.equal(dayMs("2026-10-09"), Date.UTC(2026, 9, 9));
    assert.equal(dayMs("2026-13-01"), null);
    assert.equal(dayMs("2026-10-09T00:00:00Z"), null);
    assert.equal(dayMs(null), null);
  });
});

describe("bucketing", () => {
  test("days up to three months, weeks up to two years, months beyond", () => {
    assert.equal(bucketFor(7), "day");
    assert.equal(bucketFor(92), "day");
    assert.equal(bucketFor(93), "week");
    assert.equal(bucketFor(731), "week");
    assert.equal(bucketFor(732), "month");
  });

  const days = (start: string, count: number): StatsPoint[] =>
    Array.from({ length: count }, (_, i) => ({
      date: new Date(dayMs(start)! + i * 86_400_000).toISOString().slice(0, 10),
      warn: 1,
      timeout: 0,
      kick: 0,
      ban: 0,
      other: 0,
    }));

  test("weeks start on Monday and the ends are clipped to the range", () => {
    // 2026-10-01 is a Thursday.
    const weeks = bucketSeries(days("2026-10-01", 12), "week");
    assert.deepEqual(
      weeks.map((w) => [w.date, w.end, w.warn]),
      [
        ["2026-10-01", "2026-10-04", 4],
        ["2026-10-05", "2026-10-11", 7],
        ["2026-10-12", "2026-10-12", 1],
      ],
    );
  });

  test("months follow the calendar", () => {
    const months = bucketSeries(days("2026-01-30", 32), "month");
    assert.deepEqual(
      months.map((m) => [m.date, m.end, m.warn]),
      [
        ["2026-01-30", "2026-01-31", 2],
        ["2026-02-01", "2026-02-28", 28],
        ["2026-03-01", "2026-03-02", 2],
      ],
    );
  });

  test("day buckets are passed through untouched", () => {
    const input = days("2026-10-01", 3);
    assert.equal(bucketSeries(input, "day"), input);
  });
});

describe("computeStats with all time", () => {
  test("starts on the day of the earliest entry or note and has no comparison", () => {
    const stats = computeStats({
      infractions: [row("2026-08-20T10:00:00Z"), row("2026-10-08T10:00:00Z")],
      notes: [{ authorId: "raidlead", createdAt: new Date("2026-08-15T22:00:00Z") }],
      now: NOW,
      range: { kind: "all" },
    });
    assert.equal(stats.range, "all");
    assert.equal(stats.since, "2026-08-15T00:00:00.000Z");
    assert.equal(stats.until, "2026-10-09");
    assert.equal(stats.days, 56);
    assert.equal(stats.bucket, "day");
    assert.equal(stats.previous, null);
    assert.equal(stats.automod.previousTotal, null);
    assert.equal(stats.totals.actions, 2);
    assert.equal(stats.totals.notes, 1);
  });

  test("a long history comes back as months", () => {
    const stats = computeStats({
      infractions: [row("2024-03-14T10:00:00Z"), row("2025-06-01T10:00:00Z"), row("2026-10-09T10:00:00Z")],
      notes: [],
      now: NOW,
      range: { kind: "all" },
    });
    assert.equal(stats.bucket, "month");
    assert.equal(stats.perDay[0]!.date, "2024-03-14");
    assert.equal(stats.perDay[0]!.end, "2024-03-31");
    assert.equal(stats.perDay.at(-1)!.date, "2026-10-01");
    assert.equal(stats.perDay.at(-1)!.end, "2026-10-09");
    assert.equal(stats.perDay.length, 32);
    assert.equal(stats.perDay.reduce((sum, p) => sum + p.warn, 0), 3);
  });

  test("with nothing recorded it is just today", () => {
    const stats = computeStats({ infractions: [], notes: [], now: NOW, range: { kind: "all" } });
    assert.equal(stats.days, 1);
    assert.equal(stats.perDay.length, 1);
    assert.equal(stats.previous, null);
  });
});

describe("computeStats with a custom range", () => {
  test("covers both dates in full and nothing outside", () => {
    const stats = computeStats({
      infractions: [
        row("2026-09-01T00:00:00Z"),
        row("2026-09-10T23:59:59.999Z"),
        row("2026-08-31T23:59:59.999Z"),
        row("2026-09-11T00:00:00Z"),
      ],
      notes: [],
      now: NOW,
      range: { kind: "custom", from: "2026-09-01", to: "2026-09-10" },
    });
    assert.equal(stats.range, "custom");
    assert.equal(stats.days, 10);
    assert.equal(stats.until, "2026-09-10");
    assert.equal(stats.perDay.length, 10);
    assert.equal(stats.totals.actions, 2);
  });

  test("compares with the same number of days just before it", () => {
    const stats = computeStats({
      infractions: [row("2026-08-25T12:00:00Z"), row("2026-08-22T12:00:00Z"), row("2026-08-21T12:00:00Z"), row("2026-09-05T12:00:00Z")],
      notes: [],
      now: NOW,
      range: { kind: "custom", from: "2026-09-01", to: "2026-09-10" },
    });
    // The previous window is 22 Aug to 31 Aug.
    assert.equal(stats.previous?.actions, 2);
    assert.equal(stats.totals.actions, 1);
  });

  test("a range ending today stops at now", () => {
    const stats = computeStats({
      infractions: [row("2026-10-09T15:00:00Z"), row("2026-10-09T16:00:00Z")],
      notes: [],
      now: NOW,
      range: { kind: "custom", from: "2026-10-01", to: "2026-10-09" },
    });
    assert.equal(stats.totals.actions, 1);
  });

  test("a range longer than three months is grouped by week", () => {
    const stats = computeStats({
      infractions: [],
      notes: [],
      now: NOW,
      range: { kind: "custom", from: "2026-01-01", to: "2026-06-30" },
    });
    assert.equal(stats.bucket, "week");
    assert.equal(stats.perDay[0]!.date, "2026-01-01");
    assert.equal(stats.perDay[0]!.end, "2026-01-04");
  });
});
