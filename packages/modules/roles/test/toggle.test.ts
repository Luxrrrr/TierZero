import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeToggle } from "../dist/toggle.js";

const ROLES = ["r1", "r2", "r3"];

describe("computeToggle", () => {
  test("pressing an unselected role in a non-exclusive menu adds only it", () => {
    const result = computeToggle([], "r1", ROLES, false);
    assert.deepEqual(result, { toAdd: ["r1"], toRemove: [] });
  });

  test("pressing an already-selected role removes it", () => {
    const result = computeToggle(["r1"], "r1", ROLES, false);
    assert.deepEqual(result, { toAdd: [], toRemove: ["r1"] });
  });

  test("a non-exclusive menu leaves other selections alone", () => {
    const result = computeToggle(["r2"], "r1", ROLES, false);
    assert.deepEqual(result, { toAdd: ["r1"], toRemove: [] });
  });

  test("an exclusive menu clears every other role the menu grants", () => {
    const result = computeToggle(["r2"], "r1", ROLES, true);
    assert.deepEqual(result, { toAdd: ["r1"], toRemove: ["r2"] });
  });

  test("an exclusive menu never touches roles outside the menu", () => {
    const result = computeToggle(["r2", "outside"], "r1", ROLES, true);
    assert.deepEqual(result, { toAdd: ["r1"], toRemove: ["r2"] });
  });

  test("re-pressing the only selected role in an exclusive menu just removes it", () => {
    const result = computeToggle(["r1"], "r1", ROLES, true);
    assert.deepEqual(result, { toAdd: [], toRemove: ["r1"] });
  });
});
