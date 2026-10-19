import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { forbid, grant, limitedTo } from "../dist/overwrites.js";

describe("overwrites", () => {
  test("a grant adds an entry for someone new", () => {
    assert.deepEqual(grant([], "u", 1, 0b101n), [{ id: "u", type: 1, allow: 0b101n, deny: 0n }]);
  });

  test("a grant merges with the entry someone already has and lifts a denial of the same bits", () => {
    const list = [{ id: "u", type: 1 as const, allow: 0b001n, deny: 0b110n }];
    assert.deepEqual(grant(list, "u", 1, 0b010n), [{ id: "u", type: 1, allow: 0b011n, deny: 0b100n }]);
  });

  test("a role and a member with the same id are different entries", () => {
    assert.equal(grant([{ id: "x", type: 0, allow: 1n, deny: 0n }], "x", 1, 2n).length, 2);
  });

  test("a denial removes the same bits from what was granted", () => {
    const list = [{ id: "u", type: 1 as const, allow: 0b011n, deny: 0n }];
    assert.deepEqual(forbid(list, "u", 1, 0b010n), [{ id: "u", type: 1, allow: 0b001n, deny: 0b010n }]);
  });

  test("the list given is not changed", () => {
    const list = [{ id: "u", type: 1 as const, allow: 1n, deny: 0n }];
    grant(list, "u", 1, 2n);
    assert.equal(list[0]?.allow, 1n);
  });

  test("a grant is limited to what the bot holds", () => {
    assert.equal(limitedTo(0b111n, 0b101n), 0b101n);
  });
});
