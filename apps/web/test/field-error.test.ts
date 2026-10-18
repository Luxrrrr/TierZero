import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { errorSentence, errorsStillValid, listFieldError, valueAt } from "../lib/field-error.ts";

describe("errorSentence", () => {
  test("makes the bot's phrase a sentence of its own", () => {
    assert.equal(errorSentence("must be at least 1"), "This must be at least 1.");
    assert.equal(errorSentence("is required"), "This is required.");
    assert.equal(errorSentence("must be 28 days or less"), "This must be 28 days or less.");
  });

  test("leaves a sentence alone apart from its full stop", () => {
    assert.equal(errorSentence("Add some text or at least one embed."), "Add some text or at least one embed.");
    assert.equal(errorSentence("A menu needs at least one choice"), "A menu needs at least one choice.");
  });
});

describe("valueAt", () => {
  test("follows dots and indices", () => {
    const root = { rewards: [{ role: "a" }, { role: "b" }], xp: { min: 0 } };
    assert.equal(valueAt(root, "rewards[1].role"), "b");
    assert.equal(valueAt(root, "xp.min"), 0);
    assert.equal(valueAt(root, "missing.path"), undefined);
  });
});

describe("errorsStillValid", () => {
  const sent = { xp: { min: 0, max: 5 }, cooldown: 0 };
  const errors = { "xp.min": "must be at least 1", cooldown: "must be at least 1 minute" };

  test("drops an error once its value is edited, even back to the saved one", () => {
    const kept = errorsStillValid(errors, sent, { xp: { min: 15, max: 5 }, cooldown: 0 });
    assert.deepEqual(kept, { cooldown: "must be at least 1 minute" });
  });

  test("keeps every error while nothing it is about has changed", () => {
    assert.deepEqual(errorsStillValid(errors, sent, { ...sent, other: true }), errors);
  });
});

describe("listFieldError", () => {
  const path = "rules.regex.patterns";
  const items = ["fine", "(unclosed", "(a+)+$"];

  test("names the entry each refusal is about", () => {
    const errors = { [`${path}[1]`]: "is not a valid regular expression", [`${path}[2]`]: "cannot repeat a group that repeats" };
    assert.equal(
      listFieldError(errors, path, items),
      '"(unclosed" is not a valid regular expression. "(a+)+$" cannot repeat a group that repeats.',
    );
  });

  test("shows an error on the whole list as it is", () => {
    assert.equal(listFieldError({ [path]: "must have at most 5 entries" }, path, items), "must have at most 5 entries");
  });

  test("ignores other fields, deeper paths and an empty set", () => {
    assert.equal(listFieldError({}, path, items), undefined);
    assert.equal(listFieldError({ "rules.regex.patterns2[0]": "x", [`${path}[0].name`]: "x", "other[0]": "x" }, path, items), undefined);
  });

  test("shortens a long entry and copes with one that is gone", () => {
    const long = "a".repeat(60);
    assert.equal(listFieldError({ [`${path}[0]`]: "is empty" }, path, [long]), `"${"a".repeat(40)}..." is empty.`);
    assert.equal(listFieldError({ [`${path}[4]`]: "is empty" }, path, []), "Entry 5 is empty.");
  });
});
