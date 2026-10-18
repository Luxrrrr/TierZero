import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { raisedDurations, s } from "../dist/index.js";

const schema = s.object({
  timeout: s.duration({ min: "1m", default: "10m" }),
  cooldown: s.duration({ default: "0s" }),
  rules: s.object({
    window: s.duration({ min: "1s", default: "5s" }),
  }),
  panels: s.array(s.object({ reminder: s.duration({ min: "1m", default: "1h" }) })),
});

describe("raisedDurations", () => {
  test("lists stored numbers below the minimum, by dashboard path", () => {
    const found = raisedDurations(schema.describe(), {
      timeout: 5_000,
      cooldown: 0,
      rules: { window: 200 },
      panels: [{ reminder: 120_000 }, { reminder: 20_000 }],
    });
    assert.deepEqual(found, [
      { path: "timeout", min: "1m" },
      { path: "rules.window", min: "1s" },
      { path: "panels[1].reminder", min: "1m" },
    ]);
  });

  test("ignores values at or above the minimum, and missing ones", () => {
    assert.deepEqual(raisedDurations(schema.describe(), { timeout: 60_000 }), []);
    assert.deepEqual(raisedDurations(schema.describe(), {}), []);
  });

  test("agrees with what parsing does to the value", () => {
    const parsed = schema.parse({ timeout: 5_000, rules: { window: 5000 }, panels: [] });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.timeout, 60_000);
  });
});
