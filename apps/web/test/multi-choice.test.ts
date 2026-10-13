import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  blockMessage,
  chipCaption,
  choiceLayout,
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

describe("choiceLayout", () => {
  test("four options or fewer are chips", () => {
    assert.equal(choiceLayout(3), "chips");
    assert.equal(choiceLayout(4), "chips");
  });

  test("more than four are rows", () => {
    assert.equal(choiceLayout(5), "rows");
  });

  test("the schema's own choice wins", () => {
    assert.equal(choiceLayout(3, "rows"), "rows");
    assert.equal(choiceLayout(9, "chips"), "chips");
  });

  test("ignores a value it does not know", () => {
    assert.equal(choiceLayout(3, "grid"), "chips");
  });
});

describe("chipCaption", () => {
  const options = [
    { value: "delete", description: "Removes the message." },
    { value: "warn", description: "Adds a warning to their record." },
    { value: "timeout" },
  ];

  test("describes the selection in option order when nothing is hovered or focused", () => {
    assert.equal(chipCaption(options, ["warn", "delete"]), "Removes the message. Adds a warning to their record.");
  });

  test("skips an option that has no description", () => {
    assert.equal(chipCaption(options, ["timeout", "delete"]), "Removes the message.");
  });

  test("says what the hovered or focused option does, hover first", () => {
    assert.equal(chipCaption(options, ["delete"], undefined, "warn"), "Adds a warning to their record.");
    assert.equal(chipCaption(options, ["delete"], "delete", "warn"), "Removes the message.");
  });

  test("falls back to the selection for an option with nothing to say", () => {
    assert.equal(chipCaption(options, ["delete"], "timeout"), "Removes the message.");
  });

  test("is empty when nothing is selected", () => {
    assert.equal(chipCaption(options, []), "");
  });
});

describe("chip selection", () => {
  test("refuses to turn off the last chip when a minimum is set", () => {
    const result = toggleChoice(["delete"], "delete", ORDER, { min: 1 });
    assert.equal(result.blocked, "min");
    assert.deepEqual(result.next, ["delete"]);
  });

  test("selections compare equal whatever the order, which decides if Reset shows", () => {
    assert.equal(sameSelection(["delete"], ["delete", "warn"]), false);
    assert.equal(sameSelection(["warn", "delete"], ["delete", "warn"]), true);
  });
});
