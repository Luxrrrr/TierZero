import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { applyPreset, presetDtos, presetLength, presetSuggestions } from "../dist/presets.js";

const MIN = 60_000;
const DAY = 86_400_000;

const presets = [
  { name: "Spam", reason: "Posting spam links", duration: 60 * MIN },
  { name: "Raid", reason: "Part of a raid", duration: undefined },
  { name: "Long", reason: "Repeated trouble", duration: 90 * DAY },
];

describe("presetDtos", () => {
  test("keeps the owner's order and gives a missing length as null", () => {
    assert.deepEqual(presetDtos(presets), [
      { name: "Spam", reason: "Posting spam links", durationMs: 60 * MIN },
      { name: "Raid", reason: "Part of a raid", durationMs: null },
      { name: "Long", reason: "Repeated trouble", durationMs: 90 * DAY },
    ]);
  });
});

describe("presetLength", () => {
  test("a timeout takes the length when it fits one, a ban always, and nothing else takes it", () => {
    assert.equal(presetLength(presets[0]!, "timeout"), 60 * MIN);
    assert.equal(presetLength(presets[2]!, "timeout"), null);
    assert.equal(presetLength(presets[2]!, "ban"), 90 * DAY);
    assert.equal(presetLength(presets[0]!, "kick"), null);
    assert.equal(presetLength(presets[0]!, "warn"), null);
    assert.equal(presetLength(presets[1]!, "ban"), null);
    assert.equal(presetLength(null, "ban"), null);
  });
});

describe("applyPreset", () => {
  test("a preset's name becomes its reason and length", () => {
    assert.deepEqual(applyPreset("spam", presets, "timeout"), { reason: "Posting spam links", durationMs: 60 * MIN });
  });

  test("text that is not a name is the reason as typed", () => {
    assert.deepEqual(applyPreset("Spamming in general", presets, "timeout"), { reason: "Spamming in general", durationMs: null });
    assert.deepEqual(applyPreset(null, presets, "ban"), { reason: null, durationMs: null });
  });

  test("a server with no presets leaves every reason alone", () => {
    assert.deepEqual(applyPreset("Spam", [], "ban"), { reason: "Spam", durationMs: null });
  });
});

describe("presetSuggestions", () => {
  test("an empty box lists the presets with the name as the value", () => {
    const choices = presetSuggestions("", presets);
    assert.equal(choices.length, 3);
    assert.deepEqual(choices[0], { name: "Spam: Posting spam links", value: "Spam" });
  });

  test("typing filters by name or reason and offers the typed text first", () => {
    const choices = presetSuggestions("link", presets);
    assert.deepEqual(choices.map((choice) => choice.value), ["link", "Spam"]);
  });

  test("the typed text is not offered twice when it is a preset's name", () => {
    assert.deepEqual(presetSuggestions("raid", presets).map((choice) => choice.value), ["Raid"]);
  });

  test("never more than 25 suggestions, and none longer than Discord allows", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `Preset ${i}`, reason: "x".repeat(300), duration: undefined }));
    const choices = presetSuggestions("", many);
    assert.equal(choices.length, 25);
    assert.ok(choices.every((choice) => choice.name.length <= 100 && choice.value.length <= 100));
  });

  test("text too long for a suggestion is not offered back", () => {
    const long = "y".repeat(150);
    assert.equal(presetSuggestions(long, presets).some((choice) => choice.value === long), false);
  });
});
