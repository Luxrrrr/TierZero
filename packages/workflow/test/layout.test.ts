import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isIf, layoutOf } from "../dist/layout.js";

describe("the shape of steps with ifs in them", () => {
  test("an if finds its else and its end", () => {
    const layout = layoutOf(["message", "ifRole", "message", "else", "message", "endif", "message"]);
    assert.equal(layout.elseOf[1], 3);
    assert.equal(layout.endOf[1], 5);
    assert.equal(layout.endOf[3], 5);
    assert.deepEqual(layout.depth, [0, 0, 1, 0, 1, 0, 0]);
  });

  test("an if without an else only has an end", () => {
    const layout = layoutOf(["ifChance", "message", "endif"]);
    assert.equal(layout.elseOf[0], -1);
    assert.equal(layout.endOf[0], 2);
  });

  test("ifs inside ifs close in order", () => {
    const layout = layoutOf(["ifRole", "ifChannel", "message", "endif", "else", "message", "endif"]);
    assert.equal(layout.endOf[1], 3);
    assert.equal(layout.elseOf[0], 4);
    assert.equal(layout.endOf[0], 6);
    assert.deepEqual(layout.depth, [0, 1, 2, 1, 0, 1, 0]);
  });

  test("an if that is never closed runs to the end of the list", () => {
    const layout = layoutOf(["ifRole", "message"]);
    assert.equal(layout.endOf[0], 2);
  });

  test("an else or end with no if is marked as stray", () => {
    const layout = layoutOf(["else", "message", "endif"]);
    assert.deepEqual(layout.matched, [false, true, false]);
  });

  test("a second else in one if is stray", () => {
    const layout = layoutOf(["ifRole", "else", "else", "endif"]);
    assert.equal(layout.matched[2], false);
    assert.equal(layout.elseOf[0], 1);
  });

  test("knows which kinds are ifs", () => {
    assert.ok(isIf("ifVariable"));
    assert.ok(!isIf("else"));
    assert.ok(!isIf("message"));
  });
});
