import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry } from "@tier0/core";
import verification from "../dist/index.js";
import { JoinWindow } from "../dist/raid.js";

describe("counting joins", () => {
  test("counts the joins inside the window, this one included", () => {
    const window = new JoinWindow();
    assert.equal(window.record("g", 1_000, 60_000), 1);
    assert.equal(window.record("g", 2_000, 60_000), 2);
    assert.equal(window.record("g", 3_000, 60_000), 3);
  });

  test("lets old joins fall out of the window", () => {
    const window = new JoinWindow();
    window.record("g", 0, 60_000);
    window.record("g", 30_000, 60_000);
    assert.equal(window.record("g", 61_000, 60_000), 2);
    assert.equal(window.count("g", 200_000, 60_000), 0);
  });

  test("keeps servers apart", () => {
    const window = new JoinWindow();
    window.record("a", 0, 60_000);
    window.record("a", 1, 60_000);
    assert.equal(window.record("b", 2, 60_000), 1);
  });
});

describe("the raid settings", () => {
  const registry = new ModuleRegistry();
  registry.register(verification);
  const resolve = (stored: unknown) => {
    const result = registry.resolveSettings("verification", stored);
    assert.ok(result.ok);
    return (result.value as { raid: Record<string, unknown> }).raid;
  };

  test("are off until switched on, and start with protections that Discord enforces", () => {
    const raid = resolve({});
    assert.equal(raid.enabled, false);
    assert.equal(raid.joins, 10);
    assert.equal(raid.within, 60_000);
    assert.equal(raid.raiseLevel, true);
    assert.equal(raid.pauseInvites, true);
    assert.equal(raid.lastsFor, 30 * 60_000);
  });

  test("refuse a threshold too low to tell a raid from a busy minute", () => {
    assert.equal(registry.resolveSettings("verification", { raid: { joins: 1 } }).ok, false);
  });
});
