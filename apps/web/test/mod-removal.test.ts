import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { removalToast } from "../lib/mod-removal.ts";

describe("removalToast", () => {
  test("says the ban was lifted only when the bot lifted it", () => {
    const toast = removalToast("case 12", { lift: { kind: "ban", result: "lifted" } });
    assert.equal(toast.title, "Removed case 12 from the record and lifted the ban.");
    assert.equal(toast.detail, undefined);
  });

  test("says the Discord ban stayed when another ban case is in force", () => {
    const toast = removalToast("case 12", { lift: { kind: "ban", result: "kept" } });
    assert.equal(toast.title, "Removed case 12 from the record.");
    assert.match(toast.detail ?? "", /stays because another ban case/);
  });

  test("says the lift failed", () => {
    const toast = removalToast("case 12", { lift: { kind: "ban", result: "failed" } });
    assert.doesNotMatch(toast.title, /lifted/);
    assert.match(toast.detail ?? "", /could not be lifted/);
  });

  test("says there was nothing to lift", () => {
    assert.match(removalToast("case 12", { lift: { kind: "ban", result: "nothing" } }).detail ?? "", /nothing to lift/);
    assert.match(removalToast("case 3", { lift: { kind: "timeout", result: "nothing" } }).detail ?? "", /no timeout left/);
  });

  test("a timeout that was lifted reads the same way", () => {
    assert.equal(removalToast("case 3", { lift: { kind: "timeout", result: "lifted" } }).title, "Removed case 3 from the record and lifted the timeout.");
  });

  test("a reply with no outcome, or one that cannot be read, claims nothing about Discord", () => {
    for (const reply of [null, {}, { lift: null }, { lift: { kind: "ban", result: "maybe" } }, "text"]) {
      assert.deepEqual(removalToast("case 12", reply), { title: "Removed case 12 from the record." });
    }
  });
});
