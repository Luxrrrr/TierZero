import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ago } from "../dist/ago.js";

const now = new Date("2026-10-10T12:00:00Z");
const before = (ms: number) => new Date(now.getTime() - ms);

describe("ago", () => {
  test("says just now inside the first minute", () => {
    assert.equal(ago(before(20_000), now), "just now");
  });

  test("counts minutes, hours and days, singular and plural", () => {
    assert.equal(ago(before(60_000), now), "1 minute ago");
    assert.equal(ago(before(5 * 60_000), now), "5 minutes ago");
    assert.equal(ago(before(3_600_000), now), "1 hour ago");
    assert.equal(ago(before(26 * 3_600_000), now), "1 day ago");
  });

  test("does not read a clock that is slightly ahead as the future", () => {
    assert.equal(ago(new Date(now.getTime() + 5000), now), "just now");
  });
});
