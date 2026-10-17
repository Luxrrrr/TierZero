import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { duplicated, indexAfterMove, moved, setAfterInsert, setAfterMove } from "../lib/list-order.ts";
import { withFreshIds } from "../lib/row-defaults.ts";

describe("moved", () => {
  test("moves one entry up or down and keeps the rest in order", () => {
    assert.deepEqual(moved(["a", "b", "c", "d"], 2, 0), ["c", "a", "b", "d"]);
    assert.deepEqual(moved(["a", "b", "c", "d"], 0, 3), ["b", "c", "d", "a"]);
    assert.deepEqual(moved(["a", "b"], 1, 0), ["b", "a"]);
  });

  test("returns the same order for a move off either end", () => {
    assert.deepEqual(moved(["a", "b"], 0, -1), ["a", "b"]);
    assert.deepEqual(moved(["a", "b"], 1, 2), ["a", "b"]);
  });
});

describe("which rows stay open after a move", () => {
  test("follows each row to its new position", () => {
    assert.equal(indexAfterMove(2, 2, 0), 0);
    assert.equal(indexAfterMove(0, 2, 0), 1);
    assert.equal(indexAfterMove(3, 2, 0), 3);
    assert.equal(indexAfterMove(1, 0, 2), 0);
    assert.deepEqual([...setAfterMove(new Set([0, 3]), 0, 3)].sort(), [2, 3]);
  });

  test("makes room for a copy", () => {
    assert.deepEqual([...setAfterInsert(new Set([0, 2]), 1)].sort(), [0, 3]);
  });
});

describe("duplicated", () => {
  test("places a copy right after the row, not shared with it", () => {
    const rows = [{ label: "EU" }, { label: "NA" }];
    const next = duplicated(rows, 0, (row) => row);
    assert.deepEqual(next, [{ label: "EU" }, { label: "EU" }, { label: "NA" }]);
    assert.notEqual(next[1], rows[0]);
  });

  test("gives every generated id in the copy a fresh value, at any depth", () => {
    const fields = {
      id: { kind: "string", generated: true },
      name: { kind: "string" },
      types: { kind: "array", of: { kind: "object", fields: { id: { kind: "string", generated: true }, name: { kind: "string" } } } },
    } as never;
    let count = 0;
    const make = () => `new${(count += 1)}`;
    const panel = { id: "p1", name: "Support", types: [{ id: "t1", name: "Help" }, { id: "t2", name: "Report" }] };
    const [, copy] = duplicated([panel], 0, (row) => withFreshIds(row, fields, make) as typeof panel);
    assert.equal(copy?.name, "Support");
    assert.equal(copy?.id, "new1");
    assert.deepEqual(copy?.types.map((type) => type.id), ["new2", "new3"]);
    assert.equal(panel.types[0]?.id, "t1");
  });
});
