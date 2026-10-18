import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { settleToggle, type ToggleState } from "../lib/serial-toggle.ts";

describe("settleToggle", () => {
  test("sends only the last wanted state after rapid presses", async () => {
    const state: ToggleState = { wanted: true, confirmed: false };
    const sent: boolean[] = [];
    const run = settleToggle(state, async (target) => {
      sent.push(target);
      return { ok: true };
    });
    state.wanted = false;
    state.wanted = true;
    state.wanted = false;
    state.wanted = true;
    const outcome = await run;
    assert.deepEqual(sent, [true]);
    assert.equal(state.confirmed, true);
    assert.equal(outcome.changed, true);
  });

  test("follows a press made while a request is in flight", async () => {
    const state: ToggleState = { wanted: true, confirmed: false };
    const sent: boolean[] = [];
    const outcome = await settleToggle(state, async (target) => {
      sent.push(target);
      if (sent.length === 1) state.wanted = false;
      return { ok: true };
    });
    assert.deepEqual(sent, [true, false]);
    assert.equal(state.confirmed, false);
    assert.equal(outcome.changed, true);
  });

  test("sends nothing when the wanted state is already confirmed", async () => {
    const state: ToggleState = { wanted: true, confirmed: true };
    const outcome = await settleToggle(state, async () => {
      throw new Error("not expected");
    });
    assert.deepEqual(outcome, { changed: false });
  });

  test("falls back to the confirmed state on a refusal", async () => {
    const state: ToggleState = { wanted: true, confirmed: false };
    const outcome = await settleToggle(state, async () => ({ ok: false, detail: "no" }));
    assert.equal(state.wanted, false);
    assert.deepEqual(outcome.failure, { target: true, detail: "no" });
    assert.equal(outcome.changed, false);
  });
});
