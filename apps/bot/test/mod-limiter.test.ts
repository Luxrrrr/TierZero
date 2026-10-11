import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createLimiter } from "../dist/control/mod/limiter.js";
import { rememberBounded } from "../dist/control/mod/names.js";

describe("createLimiter", () => {
  function clocked(limit: number, windowMs: number) {
    let at = 1_000_000;
    const limiter = createLimiter({ limit, windowMs, now: () => at });
    return { limiter, advance: (ms: number) => void (at += ms) };
  }

  test("allows up to the limit and then refuses with a wait time", () => {
    const { limiter, advance } = clocked(3, 60_000);
    for (let i = 0; i < 3; i++) {
      assert.deepEqual(limiter.take("a"), { ok: true });
      advance(1000);
    }
    const refused = limiter.take("a");
    assert.equal(refused.ok, false);
    assert.equal(refused.ok === false && refused.retryAfterMs, 57_000);
  });

  test("lets calls through again as old ones leave the window", () => {
    const { limiter, advance } = clocked(2, 10_000);
    limiter.take("a");
    advance(5000);
    limiter.take("a");
    assert.equal(limiter.take("a").ok, false);
    advance(5000);
    assert.equal(limiter.take("a").ok, true);
    assert.equal(limiter.take("a").ok, false);
  });

  test("a refused call is not counted against the next window", () => {
    const { limiter, advance } = clocked(1, 10_000);
    limiter.take("a");
    for (let i = 0; i < 5; i++) limiter.take("a");
    advance(10_000);
    assert.equal(limiter.take("a").ok, true);
  });

  test("keys are independent", () => {
    const { limiter } = clocked(1, 10_000);
    assert.equal(limiter.take("a").ok, true);
    assert.equal(limiter.take("b").ok, true);
    assert.equal(limiter.take("a").ok, false);
  });

  test("idle keys are dropped so the map cannot grow forever", () => {
    const { limiter, advance } = clocked(1, 1000);
    for (let i = 0; i < 1500; i++) limiter.take(`k${i}`);
    advance(5000);
    limiter.take("fresh");
    assert.ok(limiter.size() <= 2);
  });
});

describe("rememberBounded", () => {
  test("drops the oldest entries once the cap is passed", () => {
    const map = new Map<string, number>();
    for (let i = 0; i < 10; i++) rememberBounded(map, `k${i}`, i, 4);
    assert.deepEqual([...map.keys()], ["k6", "k7", "k8", "k9"]);
  });

  test("a refreshed key counts as the newest", () => {
    const map = new Map<string, number>();
    for (const key of ["a", "b", "c"]) rememberBounded(map, key, 0, 3);
    rememberBounded(map, "a", 1, 3);
    rememberBounded(map, "d", 0, 3);
    assert.deepEqual([...map.keys()], ["c", "a", "d"]);
  });
});
