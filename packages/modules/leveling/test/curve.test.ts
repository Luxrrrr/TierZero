import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  applyMultiplier,
  canAward,
  highestMultiplierPercent,
  levelForXp,
  progressFor,
  renderProgressBar,
  resolveRewardRoles,
  totalXpForLevel,
  xpForMessage,
  xpForNextLevel,
} from "../dist/curve.js";

describe("totalXpForLevel", () => {
  test("is zero at level 0", () => {
    assert.equal(totalXpForLevel(0), 0);
  });

  test("is zero below level 0", () => {
    assert.equal(totalXpForLevel(-5), 0);
  });

  test("is monotonic across a wide range", () => {
    let previous = totalXpForLevel(0);
    for (let level = 1; level <= 500; level++) {
      const current = totalXpForLevel(level);
      assert.ok(current > previous, `level ${level} did not increase over ${level - 1}`);
      previous = current;
    }
  });

  test("matches known values", () => {
    assert.equal(totalXpForLevel(1), 100);
    assert.equal(totalXpForLevel(2), 300);
    assert.equal(totalXpForLevel(3), 600);
  });
});

describe("xpForNextLevel", () => {
  test("equals the difference between consecutive totals", () => {
    for (let level = 0; level <= 200; level++) {
      assert.equal(
        xpForNextLevel(level),
        totalXpForLevel(level + 1) - totalXpForLevel(level),
      );
    }
  });

  test("grows level over level", () => {
    for (let level = 0; level < 200; level++) {
      assert.ok(xpForNextLevel(level + 1) > xpForNextLevel(level));
    }
  });
});

describe("levelForXp", () => {
  test("is level 0 at zero and below", () => {
    assert.equal(levelForXp(0), 0);
    assert.equal(levelForXp(-100), 0);
  });

  test("sits exactly on a level's own threshold", () => {
    for (let level = 0; level <= 300; level++) {
      assert.equal(levelForXp(totalXpForLevel(level)), level);
    }
  });

  test("is one level down just below a threshold", () => {
    for (let level = 1; level <= 300; level++) {
      assert.equal(levelForXp(totalXpForLevel(level) - 1), level - 1);
    }
  });

  test("is unchanged one xp above its threshold", () => {
    for (let level = 0; level <= 300; level++) {
      assert.equal(levelForXp(totalXpForLevel(level) + 1), level);
    }
  });

  test("is a consistent inverse of totalXpForLevel across a wide range", () => {
    const samples = [
      0, 1, 5, 50, 99, 100, 101, 299, 300, 301, 599, 600, 601, 1_000, 50_000, 1_000_000,
      123_456_789, 9_999_999_999,
    ];
    for (const xp of samples) {
      const level = levelForXp(xp);
      assert.ok(
        totalXpForLevel(level) <= xp,
        `level ${level} claims too little xp for ${xp}`,
      );
      assert.ok(
        xp < totalXpForLevel(level + 1),
        `level ${level} claims too much xp for ${xp}`,
      );
    }
  });
});

describe("progressFor", () => {
  test("starts a level at zero progress", () => {
    for (let level = 0; level <= 50; level++) {
      const progress = progressFor(totalXpForLevel(level));
      assert.equal(progress.level, level);
      assert.equal(progress.into, 0);
      assert.equal(progress.need, xpForNextLevel(level));
    }
  });

  test("tracks partial progress within a level", () => {
    const progress = progressFor(totalXpForLevel(4) + 37);
    assert.equal(progress.level, 4);
    assert.equal(progress.into, 37);
    assert.equal(progress.need, xpForNextLevel(4));
  });
});

describe("renderProgressBar", () => {
  test("is empty at zero progress", () => {
    assert.equal(renderProgressBar(0, 100, 10), "░░░░░░░░░░");
  });

  test("is full once the requirement is met", () => {
    assert.equal(renderProgressBar(100, 100, 10), "██████████");
  });

  test("does not fill until progress is actually complete", () => {
    assert.equal(renderProgressBar(99, 100, 10), "█████████░");
  });

  test("fills proportionally", () => {
    assert.equal(renderProgressBar(50, 100, 10), "█████░░░░░");
    assert.equal(renderProgressBar(30, 100, 10), "███░░░░░░░");
  });

  test("respects a custom size", () => {
    assert.equal(renderProgressBar(1, 4, 4), "█░░░");
  });

  test("treats a non-positive requirement as complete", () => {
    assert.equal(renderProgressBar(0, 0, 5), "█████");
  });

  test("clamps out-of-range progress instead of overflowing", () => {
    assert.equal(renderProgressBar(500, 100, 5), "█████");
  });
});

describe("xpForMessage", () => {
  test("returns the minimum when rng rolls zero", () => {
    assert.equal(xpForMessage(15, 25, () => 0), 15);
  });

  test("returns the maximum when rng rolls just under one", () => {
    assert.equal(xpForMessage(15, 25, () => 0.999999), 25);
  });

  test("stays within range across the rng domain", () => {
    for (let i = 0; i <= 10; i++) {
      const value = xpForMessage(10, 20, () => i / 10 - (i === 10 ? 1e-9 : 0));
      assert.ok(value >= 10 && value <= 20, `${value} outside [10, 20]`);
    }
  });

  test("tolerates a min greater than max by swapping them", () => {
    assert.equal(xpForMessage(25, 15, () => 0), 15);
    assert.equal(xpForMessage(25, 15, () => 0.999999), 25);
  });

  test("handles a fixed amount when min equals max", () => {
    assert.equal(xpForMessage(20, 20, () => Math.random()), 20);
  });
});

describe("applyMultiplier", () => {
  test("100 percent leaves the amount unchanged", () => {
    assert.equal(applyMultiplier(20, 100), 20);
  });

  test("200 percent doubles it", () => {
    assert.equal(applyMultiplier(20, 200), 40);
  });

  test("0 percent zeroes it out", () => {
    assert.equal(applyMultiplier(20, 0), 0);
  });

  test("rounds, does not truncate", () => {
    assert.equal(applyMultiplier(10, 125), 13);
  });

  test("never goes negative", () => {
    assert.equal(applyMultiplier(10, -50), 0);
  });
});

describe("highestMultiplierPercent", () => {
  test("is 100 with no matching roles", () => {
    assert.equal(
      highestMultiplierPercent(["a", "b"], [{ role: "c", percent: 200 }]),
      100,
    );
  });

  test("is 100 with no configured multipliers", () => {
    assert.equal(highestMultiplierPercent(["a"], []), 100);
  });

  test("picks the highest of several matching roles", () => {
    const multipliers = [
      { role: "booster", percent: 150 },
      { role: "vip", percent: 300 },
      { role: "unrelated", percent: 500 },
    ];
    assert.equal(highestMultiplierPercent(["booster", "vip"], multipliers), 300);
  });

  test("ignores a high multiplier for a role the member lacks", () => {
    const multipliers = [{ role: "vip", percent: 300 }];
    assert.equal(highestMultiplierPercent(["booster"], multipliers), 100);
  });
});

describe("canAward", () => {
  test("refuses inside the cooldown window", () => {
    assert.equal(canAward(1000, 1030, 60_000), false);
  });

  test("allows exactly at the boundary", () => {
    assert.equal(canAward(1000, 61_000, 60_000), true);
  });

  test("allows once the cooldown has fully elapsed", () => {
    assert.equal(canAward(1000, 100_000, 60_000), true);
  });

  test("allows a zero cooldown immediately", () => {
    assert.equal(canAward(1000, 1000, 0), true);
  });
});

describe("resolveRewardRoles", () => {
  const rewards = [
    { level: 5, role: "bronze" },
    { level: 10, role: "silver" },
    { level: 20, role: "gold" },
  ];

  test("grants nothing below the first threshold", () => {
    assert.deepEqual(resolveRewardRoles(4, rewards, true), []);
    assert.deepEqual(resolveRewardRoles(4, rewards, false), []);
  });

  test("stacking keeps every reward earned so far", () => {
    const roles = resolveRewardRoles(12, rewards, true).sort();
    assert.deepEqual(roles, ["bronze", "silver"]);
  });

  test("stacking includes all rewards once every threshold is passed", () => {
    const roles = resolveRewardRoles(25, rewards, true).sort();
    assert.deepEqual(roles, ["bronze", "gold", "silver"]);
  });

  test("non-stacking keeps only the highest reward earned", () => {
    assert.deepEqual(resolveRewardRoles(12, rewards, false), ["silver"]);
    assert.deepEqual(resolveRewardRoles(25, rewards, false), ["gold"]);
    assert.deepEqual(resolveRewardRoles(5, rewards, false), ["bronze"]);
  });

  test("deduplicates two rewards that share a role", () => {
    const duplicate = [
      { level: 5, role: "same" },
      { level: 10, role: "same" },
    ];
    assert.deepEqual(resolveRewardRoles(15, duplicate, true), ["same"]);
  });

  test("handles no rewards configured", () => {
    assert.deepEqual(resolveRewardRoles(50, [], true), []);
    assert.deepEqual(resolveRewardRoles(50, [], false), []);
  });
});
