import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { FieldDescriptor } from "@tier0/core";
import {
  expandedAfterRemove,
  expandedWith,
  expandedWithout,
  stripIndices,
  summarizeChoices,
  summarizeRow,
  type RowLabels,
} from "../lib/row-summary.ts";

const labels: RowLabels = {
  channel: (id) => (id === "c1" ? "#news" : "unknown channel"),
  role: (id) => (id === "r1" ? "@Moderator" : "unknown role"),
  duration: (value) => `dur:${String(value)}`,
};

function fields(shape: Record<string, Record<string, unknown>>) {
  return shape as unknown as Record<string, FieldDescriptor>;
}

describe("summarizeRow title", () => {
  test("takes the first non-empty string", () => {
    const shape = fields({ name: { kind: "string" }, other: { kind: "string" } });
    const result = summarizeRow({ name: "", other: "Second" }, shape, labels);
    assert.equal(result.title, "Second");
  });

  test("uses a choice's option label", () => {
    const shape = fields({
      mode: { kind: "choice", options: [{ value: "a", label: "Alpha" }] },
    });
    assert.equal(summarizeRow({ mode: "a" }, shape, labels).title, "Alpha");
  });

  test("falls back to the first channel as #name", () => {
    const shape = fields({ where: { kind: "channel" }, who: { kind: "role" } });
    const result = summarizeRow({ where: "c1", who: "r1" }, shape, labels);
    assert.equal(result.title, "#news");
    assert.equal(result.detail, "@Moderator");
  });

  test("falls back to the first role as @name when there is no channel", () => {
    const shape = fields({ who: { kind: "role" }, level: { kind: "integer" } });
    const result = summarizeRow({ who: "r1", level: 5 }, shape, labels);
    assert.equal(result.title, "@Moderator");
    assert.equal(result.detail, "Level 5");
  });

  test("a string wins over a channel that comes first", () => {
    const shape = fields({ where: { kind: "channel" }, name: { kind: "string" } });
    const result = summarizeRow({ where: "c1", name: "Daily" }, shape, labels);
    assert.equal(result.title, "Daily");
    assert.equal(result.detail, "#news");
  });

  test("an empty row has no title and no detail", () => {
    const shape = fields({ name: { kind: "string" }, where: { kind: "channel" } });
    assert.deepEqual(summarizeRow({}, shape, labels), { title: undefined, detail: "" });
  });

  test("an id that no longer resolves never shows the raw id", () => {
    const shape = fields({ where: { kind: "channel" } });
    assert.equal(summarizeRow({ where: "123456789" }, shape, labels).title, "unknown channel");
  });
});

describe("summarizeRow detail", () => {
  test("joins the remaining filled-in fields", () => {
    const shape = fields({
      name: { kind: "string" },
      where: { kind: "channel" },
      who: { kind: "role" },
      level: { kind: "integer", label: "At level" },
    });
    const result = summarizeRow({ name: "Daily", where: "c1", who: "r1", level: 3 }, shape, labels);
    assert.equal(result.detail, "#news · @Moderator · At level 3");
  });

  test("skips booleans", () => {
    const shape = fields({ name: { kind: "string" }, on: { kind: "boolean" } });
    assert.equal(summarizeRow({ name: "x", on: true }, shape, labels).detail, "");
  });

  test("skips a duration equal to its default and shows one that differs", () => {
    const shape = fields({
      name: { kind: "string" },
      every: { kind: "duration", default: "10m", label: "Check every" },
    });
    assert.equal(summarizeRow({ name: "x", every: "10m" }, shape, labels).detail, "");
    assert.equal(
      summarizeRow({ name: "x", every: "1h" }, shape, labels).detail,
      "Check every dur:1h",
    );
  });

  test("shows a choice by its label", () => {
    const shape = fields({
      name: { kind: "string" },
      style: { kind: "choice", options: [{ value: "e", label: "Embed" }] },
    });
    assert.equal(summarizeRow({ name: "x", style: "e" }, shape, labels).detail, "Embed");
  });

  test("counts a list of objects under its lowercased label", () => {
    const shape = fields({
      where: { kind: "channel" },
      games: { kind: "array", label: "Games posted here", of: { kind: "object", fields: {} } },
    });
    const result = summarizeRow({ where: "c1", games: [{}, {}, {}] }, shape, labels);
    assert.equal(result.detail, "3 games posted here");
  });

  test("uses the singular when there is exactly one", () => {
    const shape = fields({
      where: { kind: "channel" },
      games: { kind: "array", label: "Games posted here", of: { kind: "object", fields: {} } },
      rewards: { kind: "array", label: "Reward tiers", of: { kind: "object", fields: {} } },
      entries: { kind: "array", label: "Entries", of: { kind: "object", fields: {} } },
    });
    const result = summarizeRow({ where: "c1", games: [{}], rewards: [{}], entries: [{}] }, shape, labels);
    assert.equal(result.detail, "1 game posted here · 1 reward tier · 1 entry");
  });

  test("leaves out an empty list of objects", () => {
    const shape = fields({
      where: { kind: "channel" },
      games: { kind: "array", of: { kind: "object", fields: {} } },
    });
    assert.equal(summarizeRow({ where: "c1", games: [] }, shape, labels).detail, "");
  });

  test("humanizes a field with no label", () => {
    const shape = fields({ name: { kind: "string" }, minLevel: { kind: "integer" } });
    assert.equal(summarizeRow({ name: "x", minLevel: 2 }, shape, labels).detail, "Min level 2");
  });

  test("shortens a long string", () => {
    const shape = fields({ a: { kind: "string" }, b: { kind: "string" } });
    const result = summarizeRow({ a: "title", b: "x".repeat(100) }, shape, labels);
    assert.ok(result.detail.length <= 40);
    assert.ok(result.detail.endsWith("…"));
  });
});

describe("stripIndices", () => {
  test("removes every index", () => {
    assert.equal(
      stripIndices("patchNotes.destinations[0].games"),
      "patchNotes.destinations.games",
    );
    assert.equal(stripIndices("news.feeds[12]"), "news.feeds");
  });

  test("leaves an unindexed path alone", () => {
    assert.equal(stripIndices("news.feeds"), "news.feeds");
  });
});

describe("expanded rows", () => {
  test("removing a row drops it and shifts the later ones down", () => {
    const next = expandedAfterRemove(new Set([0, 2, 3]), 2);
    assert.deepEqual([...next].sort(), [0, 2]);
  });

  test("removing a row leaves earlier ones alone", () => {
    assert.deepEqual([...expandedAfterRemove(new Set([1]), 3)], [1]);
  });

  test("adding a row marks it open without touching the others", () => {
    const before = new Set([0]);
    const next = expandedWith(before, 4);
    assert.deepEqual([...next].sort(), [0, 4]);
    assert.deepEqual([...before], [0]);
  });

  test("collapsing a row keeps the rest open", () => {
    assert.deepEqual([...expandedWithout(new Set([0, 1]), 0)], [1]);
  });
});

describe("summarizeRow with a message field", () => {
  const shape = fields({ reply: { kind: "message" } });

  test("shows the start of the text", () => {
    const row = { reply: { content: "Welcome   aboard,\nfriend", embeds: [] } };
    assert.equal(summarizeRow(row, shape, labels).detail, "Welcome aboard, friend");
  });

  test("reads text saved before the setting was a message", () => {
    assert.equal(summarizeRow({ reply: "Hello there" }, shape, labels).detail, "Hello there");
  });

  test("names the embed when there is no text", () => {
    assert.equal(summarizeRow({ reply: { content: "", embeds: [{ title: "Rules" }] } }, shape, labels).detail, "Rules");
    assert.equal(summarizeRow({ reply: { content: "", embeds: [{ title: "" }] } }, shape, labels).detail, "Embed");
  });

  test("says nothing for a message that is still the default", () => {
    assert.equal(summarizeRow({}, shape, labels).detail, "");
  });

  test("leaves the title to the row's name, as on a role menu", () => {
    const menu = fields({ name: { kind: "string" }, channel: { kind: "channel" }, message: { kind: "message" } });
    const row = { name: "Platforms", channel: "c1", message: { content: "", embeds: [{ title: "Where do you play?" }] } };
    const result = summarizeRow(row, menu, labels);
    assert.equal(result.title, "Platforms");
    assert.ok(result.detail.includes("Where do you play?"));
  });
});

describe("summarizeChoices", () => {
  const options = [
    { value: "delete", label: "Delete the message" },
    { value: "warn", label: "Warn" },
    { value: "timeout", label: "Time out" },
  ];

  test("joins the picked labels in option order", () => {
    assert.equal(summarizeChoices(["timeout", "delete"], options), "Delete the message, Time out");
  });

  test("shows what fits and counts the rest", () => {
    assert.equal(summarizeChoices(["delete", "warn", "timeout"], options, 24), "Delete the message +2");
  });

  test("returns nothing for an empty set", () => {
    assert.equal(summarizeChoices([], options), undefined);
  });

  test("keeps a value that is no longer an option rather than hiding it", () => {
    assert.equal(summarizeChoices(["warn", "old"], options), "Warn, old");
  });

  test("a single label that is too long is cut", () => {
    const long = [{ value: "a", label: "A".repeat(60) }];
    assert.ok((summarizeChoices(["a"], long) ?? "").length <= 40);
  });

  test("a list of choices is summarised inside a row", () => {
    const shape = fields({
      actions: { kind: "array", label: "Actions", of: { kind: "choice", options } },
    });
    const result = summarizeRow({ actions: ["delete", "warn"] }, shape, labels);
    assert.equal(result.detail, "Delete the message, Warn");
  });
});
