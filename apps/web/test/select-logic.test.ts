import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  choosePopoverSide,
  firstEnabledIndex,
  isTypeAheadKey,
  lastEnabledIndex,
  matchTypeAhead,
  nextTypeAhead,
  stepEnabled,
} from "../lib/select-logic.ts";

const options = [
  { label: "Seconds" },
  { label: "Minutes" },
  { label: "Months" },
  { label: "Hours", disabled: true },
  { label: "Days" },
];

describe("nextTypeAhead", () => {
  test("extends the word within the window", () => {
    const a = nextTypeAhead({ text: "", at: 0 }, "m", 1000);
    const b = nextTypeAhead(a, "o", 1300);
    assert.equal(b.text, "mo");
  });

  test("starts over once the window has passed", () => {
    const a = nextTypeAhead({ text: "", at: 0 }, "m", 1000);
    const b = nextTypeAhead(a, "d", 2000);
    assert.equal(b.text, "d");
  });

  test("lower-cases what is typed", () => {
    assert.equal(nextTypeAhead({ text: "", at: 0 }, "M", 5).text, "m");
  });
});

describe("matchTypeAhead", () => {
  test("finds the first label starting with the letter after the active row", () => {
    assert.equal(matchTypeAhead(options, "m", 0), 1);
  });

  test("pressing the same letter again moves to the next match", () => {
    assert.equal(matchTypeAhead(options, "m", 1), 2);
    assert.equal(matchTypeAhead(options, "mm", 1), 2);
  });

  test("wraps round to the start", () => {
    assert.equal(matchTypeAhead(options, "s", 4), 0);
  });

  test("a longer word narrows the match and may stay on the current row", () => {
    assert.equal(matchTypeAhead(options, "mi", 1), 1);
    assert.equal(matchTypeAhead(options, "mo", 1), 2);
  });

  test("skips disabled rows", () => {
    assert.equal(matchTypeAhead(options, "h", 0), -1);
  });

  test("returns -1 when nothing matches or nothing was typed", () => {
    assert.equal(matchTypeAhead(options, "z", 0), -1);
    assert.equal(matchTypeAhead(options, "", 0), -1);
    assert.equal(matchTypeAhead([], "a", 0), -1);
  });
});

describe("isTypeAheadKey", () => {
  const plain = { ctrlKey: false, metaKey: false, altKey: false };

  test("accepts letters and digits", () => {
    assert.equal(isTypeAheadKey({ key: "a", ...plain }), true);
    assert.equal(isTypeAheadKey({ key: "7", ...plain }), true);
  });

  test("rejects space, named keys and shortcuts", () => {
    assert.equal(isTypeAheadKey({ key: " ", ...plain }), false);
    assert.equal(isTypeAheadKey({ key: "Enter", ...plain }), false);
    assert.equal(isTypeAheadKey({ key: "a", ...plain, ctrlKey: true }), false);
  });
});

describe("moving between rows", () => {
  test("stepEnabled skips disabled rows and stops at the ends", () => {
    assert.equal(stepEnabled(options, 2, 1), 4);
    assert.equal(stepEnabled(options, 4, -1), 2);
    assert.equal(stepEnabled(options, 4, 1), 4);
    assert.equal(stepEnabled(options, 0, -1), 0);
  });

  test("first and last enabled", () => {
    const list = [{ disabled: true }, {}, {}, { disabled: true }];
    assert.equal(firstEnabledIndex(list), 1);
    assert.equal(lastEnabledIndex(list), 2);
    assert.equal(firstEnabledIndex([]), 0);
  });
});

describe("choosePopoverSide", () => {
  test("opens downward when it fits", () => {
    assert.equal(choosePopoverSide({ below: 300, above: 100, height: 200 }), "bottom");
  });

  test("opens upward when it does not fit below but there is more room above", () => {
    assert.equal(choosePopoverSide({ below: 80, above: 400, height: 200 }), "top");
  });

  test("stays below when neither side has more room", () => {
    assert.equal(choosePopoverSide({ below: 120, above: 60, height: 200 }), "bottom");
  });
});
