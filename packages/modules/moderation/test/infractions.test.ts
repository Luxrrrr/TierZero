import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { rankAmong } from "../dist/infractions.js";

describe("rankAmong", () => {
  test("ranks the first id as case 1", () => {
    assert.equal(rankAmong(5, [5]), 1);
  });

  test("counts only ids at or before the given one", () => {
    assert.equal(rankAmong(5, [2, 5, 9]), 2);
  });

  test("is unaffected by ids from other guilds interleaved by row id", () => {
    // Two guilds insert concurrently: ids 10, 11, 12, 13 arrive in file order
    // 10 (guild A), 11 (guild B), 12 (guild A), 13 (guild B). Guild A's own
    // list only ever contains its own ids, so its ranking is unaffected by
    // how the other guild's inserts were interleaved.
    const guildAIds = [10, 12];
    assert.equal(rankAmong(10, guildAIds), 1);
    assert.equal(rankAmong(12, guildAIds), 2);
  });

  test("never produces the same rank for two distinct ids in the same guild", () => {
    const ids = [1, 2, 3, 4, 5];
    const ranks = ids.map((id) => rankAmong(id, ids));
    assert.equal(new Set(ranks).size, ranks.length);
  });

  test("counts the whole list when the id is past every entry", () => {
    // Real callers only ever rank an id that was just inserted, so this id
    // would already be in the list - this just pins down that the function
    // itself has no special case for a missing id, it only compares values.
    assert.equal(rankAmong(99, [1, 2, 3]), 3);
  });

  test("returns zero when nothing has been recorded", () => {
    assert.equal(rankAmong(1, []), 0);
  });

  test("is stable regardless of insertion order of the id list", () => {
    const ascending = [3, 7, 12];
    const shuffled = [12, 3, 7];
    assert.equal(rankAmong(7, ascending), rankAmong(7, shuffled));
  });
});
