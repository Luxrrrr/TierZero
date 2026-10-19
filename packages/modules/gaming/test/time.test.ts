import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { discordTime, parseWhen, spokenWait, zonedTime } from "../dist/time.js";

// A Sunday, the day US clocks went back, at noon UTC.
const NOW = new Date("2026-11-01T12:00:00Z");

const at = (input: string, zone = "UTC") => {
  const result = parseWhen(input, NOW, zone);
  assert.ok(result.ok, `${input} was refused: ${result.ok ? "" : result.code}`);
  return result.at.toISOString();
};

const code = (input: string, zone = "UTC") => {
  const result = parseWhen(input, NOW, zone);
  assert.ok(!result.ok, `${input} was accepted`);
  return result.code;
};

describe("a wait", () => {
  test("is counted from now", () => {
    assert.equal(at("in 90m"), "2026-11-01T13:30:00.000Z");
    assert.equal(at("in 2h30m"), "2026-11-01T14:30:00.000Z");
    assert.equal(at("in 1d 3h"), "2026-11-02T15:00:00.000Z");
    assert.equal(at("In 2 hours and 15 minutes"), "2026-11-01T14:15:00.000Z");
  });

  test("needs a unit and a size", () => {
    assert.equal(code("in 0m"), "format");
    assert.equal(code("in soon"), "format");
    assert.equal(code("in 5"), "format");
    assert.equal(code("in 5 parsecs"), "format");
  });
});

describe("a clock time", () => {
  test("is today when it is still ahead and tomorrow when it has passed", () => {
    assert.equal(at("20:00"), "2026-11-01T20:00:00.000Z");
    assert.equal(at("08:00"), "2026-11-02T08:00:00.000Z");
    assert.equal(at("tomorrow 8pm"), "2026-11-02T20:00:00.000Z");
    assert.equal(at("today 9:30pm"), "2026-11-01T21:30:00.000Z");
    assert.equal(at("12am"), "2026-11-02T00:00:00.000Z");
  });

  test("is read in the server's zone", () => {
    // New York is on standard time again from 2am that morning, so noon UTC is 7am there.
    assert.equal(at("20:00", "America/New_York"), "2026-11-02T01:00:00.000Z");
    assert.equal(at("tomorrow 8pm", "America/New_York"), "2026-11-03T01:00:00.000Z");
    assert.equal(at("20:00 utc", "America/New_York"), "2026-11-01T20:00:00.000Z");
  });

  test("refuses a bare number, an impossible hour and an unknown day", () => {
    assert.equal(code("8"), "format");
    assert.equal(code("25:00"), "format");
    assert.equal(code("13pm"), "format");
    assert.equal(code("yesterday 8pm"), "format");
  });

  test("refuses today when today has passed", () => {
    assert.equal(code("today 08:00"), "past");
  });
});

describe("a date", () => {
  test("is read with its time", () => {
    assert.equal(at("2026-11-02 19:30"), "2026-11-02T19:30:00.000Z");
    assert.equal(at("2026-11-02T19:30"), "2026-11-02T19:30:00.000Z");
    assert.equal(at("2027-06-01 12:00", "America/New_York"), "2027-06-01T16:00:00.000Z");
  });

  test("refuses a day that does not exist", () => {
    assert.equal(code("2026-02-30 10:00"), "format");
    assert.equal(code("2026-13-01 10:00"), "format");
  });

  test("refuses the past and a year that is far off", () => {
    assert.equal(code("2026-10-31 19:30"), "past");
    assert.equal(code("2030-01-01 19:30"), "far");
  });
});

describe("a Discord timestamp", () => {
  test("is taken as it is", () => {
    const seconds = Math.floor(NOW.getTime() / 1000) + 3600;
    assert.equal(at(`<t:${seconds}>`), "2026-11-01T13:00:00.000Z");
    assert.equal(at(`<t:${seconds}:F>`), "2026-11-01T13:00:00.000Z");
    assert.equal(at(String(seconds)), "2026-11-01T13:00:00.000Z");
  });
});

describe("zones", () => {
  test("an unknown zone is read as UTC", () => {
    assert.equal(at("20:00", "Mars/Olympus"), "2026-11-01T20:00:00.000Z");
  });

  test("a wall-clock time that does not exist is null", () => {
    assert.equal(zonedTime(2026, 2, 30, 10, 0, "UTC"), null);
  });
});

describe("saying a time", () => {
  test("writes a Discord timestamp", () => {
    assert.equal(discordTime(new Date(1_790_000_000_000), "R"), "<t:1790000000:R>");
  });

  test("speaks a wait", () => {
    assert.equal(spokenWait(90 * 60_000), "1 hour 30 minutes");
    assert.equal(spokenWait(30_000), "1 minute");
    assert.equal(spokenWait(2 * 86_400_000), "2 days");
  });
});
