import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isUniqueConflict } from "../dist/case-number.js";

describe("isUniqueConflict", () => {
  test("recognises Prisma's unique constraint code", () => {
    assert.equal(isUniqueConflict({ code: "P2002" }), true);
  });

  test("ignores other errors", () => {
    assert.equal(isUniqueConflict({ code: "P2025" }), false);
    assert.equal(isUniqueConflict(new Error("boom")), false);
    assert.equal(isUniqueConflict(null), false);
  });
});
