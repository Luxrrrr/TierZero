import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { ReasonPresetDto } from "@tier0/core";
import {
  ACTION_REASON_LIMIT,
  BAN_PRESETS,
  DAY_MS,
  DISCORD_TIMEOUT_MAX_MS,
  HOUR_MS,
  TIMEOUT_PRESETS,
  applyPreset,
  clampedPresetText,
  presetDescription,
  readContext,
  readPresets,
} from "../app/guilds/[id]/mod/members/[userId]/actions.ts";

const spam: ReasonPresetDto = { name: "Spam", reason: "Spamming the LFG channel", durationMs: HOUR_MS };
const toxic: ReasonPresetDto = { name: "Toxic", reason: "Flaming teammates in voice", durationMs: null };
const limits = { timeoutMax: DISCORD_TIMEOUT_MAX_MS, banMax: 30 * DAY_MS, presets: TIMEOUT_PRESETS };

describe("readPresets", () => {
  test("reads presets in the order the owner listed them", () => {
    assert.deepEqual(readPresets([spam, toxic]), [spam, toxic]);
  });

  test("an older bot that sends none reads as none", () => {
    assert.deepEqual(readPresets(undefined), []);
    assert.deepEqual(readContext({ moduleEnabled: true })?.reasonPresets, []);
  });

  test("drops damaged entries and lengths that are not lengths", () => {
    assert.deepEqual(
      readPresets([{ name: " ", reason: "x" }, { name: "Afk", reason: "" }, null, "Spam", { name: " Grief ", reason: "Griefing builds", durationMs: -5 }]),
      [{ name: "Grief", reason: "Griefing builds", durationMs: null }],
    );
  });

  test("the context carries them through", () => {
    const context = readContext({ moduleEnabled: true, reasonPresets: [spam] });
    assert.deepEqual(context?.reasonPresets, [spam]);
  });
});

describe("applyPreset", () => {
  test("fills the reason for any action", () => {
    for (const kind of ["warn", "kick", "unban", "timeout-clear"] as const) {
      assert.deepEqual(applyPreset(spam, kind, limits), { reason: spam.reason, duration: null, banLength: null, clampedTo: null });
    }
  });

  test("a timeout preset sets the length, on the matching quick pick", () => {
    const applied = applyPreset(spam, "timeout", limits);
    assert.deepEqual(applied.duration, { choice: HOUR_MS, amount: "1", unit: "h" });
    assert.equal(applied.clampedTo, null);
  });

  test("a length with no quick pick becomes a custom one", () => {
    const applied = applyPreset({ ...spam, durationMs: 90 * 60_000 }, "timeout", limits);
    assert.deepEqual(applied.duration, { choice: "custom", amount: "90", unit: "m" });
  });

  test("a timeout longer than the ceiling is cut to the ceiling, and says so", () => {
    const applied = applyPreset({ ...spam, durationMs: 60 * DAY_MS }, "timeout", { ...limits, timeoutMax: 7 * DAY_MS });
    assert.equal(applied.clampedTo, 7 * DAY_MS);
    assert.deepEqual(applied.duration, { choice: 7 * DAY_MS, amount: "7", unit: "d" });
    assert.equal(
      clampedPresetText(60 * DAY_MS, 7 * DAY_MS, "timeout"),
      "The preset asks for 60 days, longer than this server allows for a timeout, so the length is set to 7 days.",
    );
  });

  test("a ban preset with a length turns the ban temporary", () => {
    const applied = applyPreset({ ...spam, durationMs: 3 * DAY_MS }, "ban", { ...limits, presets: BAN_PRESETS });
    assert.equal(applied.banLength, "temporary");
    assert.deepEqual(applied.duration, { choice: 3 * DAY_MS, amount: "3", unit: "d" });
  });

  test("a ban preset leaves the length alone where only permanent bans are allowed", () => {
    const applied = applyPreset({ ...spam, durationMs: 3 * DAY_MS }, "ban", { ...limits, banMax: 0 });
    assert.equal(applied.banLength, null);
    assert.equal(applied.duration, null);
  });

  test("a preset without a length leaves the length alone", () => {
    assert.equal(applyPreset(toxic, "timeout", limits).duration, null);
    assert.equal(applyPreset(toxic, "ban", limits).banLength, null);
  });

  test("a reason longer than the form takes is cut to fit", () => {
    assert.equal(applyPreset({ ...toxic, reason: "x".repeat(ACTION_REASON_LIMIT + 50) }, "warn", limits).reason.length, ACTION_REASON_LIMIT);
  });
});

describe("presetDescription", () => {
  test("shows the reason, with the length where the action uses one", () => {
    assert.equal(presetDescription(spam, "warn"), "Spamming the LFG channel");
    assert.equal(presetDescription(spam, "timeout"), "Spamming the LFG channel (1 hour)");
    assert.equal(presetDescription(toxic, "ban"), "Flaming teammates in voice");
  });

  test("cuts a long reason to one line", () => {
    const text = presetDescription({ ...toxic, reason: `Line one\n${"y".repeat(200)}` }, "warn", 30);
    assert.equal(text.length, 30);
    assert.equal(text.includes("\n"), false);
  });
});
