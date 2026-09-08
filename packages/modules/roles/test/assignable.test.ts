import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isAssignable } from "../dist/assignable.js";

describe("isAssignable", () => {
  test("a role below the bot's highest role is assignable", () => {
    assert.equal(isAssignable(5, 10), true);
  });

  test("a role above the bot's highest role is not assignable", () => {
    assert.equal(isAssignable(15, 10), false);
  });

  test("a role level with the bot's highest role is not assignable", () => {
    assert.equal(isAssignable(10, 10), false);
  });
});
