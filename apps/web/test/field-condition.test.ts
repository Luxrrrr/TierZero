import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { conditionMet } from "../lib/field-condition.ts";

describe("conditionMet", () => {
  test("is met when there is no condition", () => {
    assert.equal(conditionMet(undefined, {}), true);
  });

  test("equals compares the sibling exactly", () => {
    const condition = { field: "mode", equals: "timeout" };
    assert.equal(conditionMet(condition, { mode: "timeout" }), true);
    assert.equal(conditionMet(condition, { mode: "delete" }), false);
    assert.equal(conditionMet(condition, {}), false);
  });

  test("equals false is a real value, not an absent one", () => {
    const condition = { field: "enabled", equals: false };
    assert.equal(conditionMet(condition, { enabled: false }), true);
    assert.equal(conditionMet(condition, { enabled: true }), false);
  });

  test("with neither, any filled sibling meets it", () => {
    const condition = { field: "channel" };
    assert.equal(conditionMet(condition, { channel: "123" }), true);
    assert.equal(conditionMet(condition, { channel: "" }), false);
    assert.equal(conditionMet(condition, { channel: [] }), false);
    assert.equal(conditionMet(condition, { channel: ["a"] }), true);
    assert.equal(conditionMet(condition, {}), false);
  });

  test("includes is met when the sibling list contains the value", () => {
    const condition = { field: "actions", includes: "timeout" };
    assert.equal(conditionMet(condition, { actions: ["delete", "timeout"] }), true);
    assert.equal(conditionMet(condition, { actions: ["delete"] }), false);
    assert.equal(conditionMet(condition, { actions: [] }), false);
  });

  test("includes is not met by a sibling that is not a list", () => {
    const condition = { field: "actions", includes: "timeout" };
    assert.equal(conditionMet(condition, { actions: "timeout" }), false);
    assert.equal(conditionMet(condition, { actions: undefined }), false);
    assert.equal(conditionMet(condition, {}), false);
  });

  test("includes takes precedence when a condition names both", () => {
    const condition = { field: "actions", equals: "x", includes: "timeout" };
    assert.equal(conditionMet(condition, { actions: ["timeout"] }), true);
  });
});
