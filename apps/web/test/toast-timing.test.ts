import { test } from "node:test";
import assert from "node:assert/strict";
import { TOAST_MAX_MS, TOAST_MIN_MS, toastLifetime } from "../lib/toast-timing.ts";

test("a short message stays at least six seconds", () => {
  assert.equal(toastLifetime("Saved"), TOAST_MIN_MS);
  assert.ok(TOAST_MIN_MS >= 6000);
});

test("longer text stays longer", () => {
  const short = toastLifetime("Note added");
  const long = toastLifetime("Note added", "The note is visible to every staff member on this server and kept with its full edit history.");
  assert.ok(long > short);
});

test("the lifetime is capped", () => {
  assert.equal(toastLifetime("word ".repeat(500)), TOAST_MAX_MS);
});
