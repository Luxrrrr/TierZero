import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  blockMessage,
  normalizeSelection,
  sameSelection,
  toggleChoice,
} from "../lib/multi-choice.ts";

const ORDER = ["delete", "warn", "timeout", "kick"];

describe("normalizeSelection", () => {
  test("follows the order the options are declared in", () => {
    assert.deepEqual(normalizeSelection(["kick", "delete"], ORDER), ["delete", "kick"]);
  });

  test("collapses repeats and drops values that are no longer options", () => {
    assert.deepEqual(normalizeSelection(["warn", "warn", "gone"], ORDER), ["warn"]);
  });
});

describe("toggleChoice", () => {
  test("adds an option that is off", () => {
    assert.deepEqual(toggleChoice(["delete"], "timeout", ORDER).next, ["delete", "timeout"]);
  });

  test("removes an option that is on", () => {
    assert.deepEqual(toggleChoice(["delete", "warn"], "warn", ORDER).next, ["delete"]);
  });

  test("keeps the declared order whatever order they were picked in", () => {
    assert.deepEqual(toggleChoice(["kick"], "delete", ORDER).next, ["delete", "kick"]);
  });

  test("refuses to remove the last option when min is 1", () => {
    const result = toggleChoice(["delete"], "delete", ORDER, { min: 1 });
    assert.equal(result.blocked, "min");
    assert.deepEqual(result.next, ["delete"]);
  });

  test("allows removing down to min but not below", () => {
    assert.equal(toggleChoice(["delete", "warn"], "warn", ORDER, { min: 1 }).blocked, undefined);
    assert.equal(toggleChoice(["delete", "warn"], "warn", ORDER, { min: 2 }).blocked, "min");
  });

  test("refuses to add past max", () => {
    const result = toggleChoice(["delete", "warn"], "kick", ORDER, { max: 2 });
    assert.equal(result.blocked, "max");
    assert.deepEqual(result.next, ["delete", "warn"]);
  });

  test("still allows removing when at max", () => {
    assert.deepEqual(toggleChoice(["delete", "warn"], "warn", ORDER, { max: 2 }).next, ["delete"]);
  });

  test("repeats in the stored value are collapsed by a toggle", () => {
    assert.deepEqual(toggleChoice(["warn", "warn"], "kick", ORDER).next, ["warn", "kick"]);
  });
});

describe("sameSelection", () => {
  test("ignores order", () => {
    assert.equal(sameSelection(["a", "b"], ["b", "a"]), true);
  });

  test("tells different sets apart", () => {
    assert.equal(sameSelection(["a"], ["a", "b"]), false);
    assert.equal(sameSelection(["a", "c"], ["a", "b"]), false);
  });

  test("two empty sets are the same", () => {
    assert.equal(sameSelection([], []), true);
  });
});

describe("blockMessage", () => {
  test("says why the last option stays on", () => {
    assert.equal(blockMessage("min", { min: 1 }), "Pick at least one.");
    assert.equal(blockMessage("min", { min: 3 }), "Pick at least 3.");
  });

  test("says why nothing more can be added", () => {
    assert.equal(blockMessage("max", { max: 2 }), "Only 2 can be picked.");
    assert.equal(blockMessage("max", { max: 1 }), "Only one can be picked.");
  });
});
