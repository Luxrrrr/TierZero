import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyFromMessage } from "../dist/convert.js";

const embed = (extra: Record<string, unknown> = {}) => ({
  data: { type: "rich" },
  title: "Rules",
  url: null,
  description: "Be kind",
  hexColor: "#ff0000",
  author: null,
  footer: null,
  image: null,
  thumbnail: null,
  timestamp: null,
  fields: [{ name: "One", value: "No spam", inline: false }],
  ...extra,
});

test("keeps the text and rich embeds of a message", () => {
  const body = bodyFromMessage({ content: "Read this", embeds: [embed()] } as never);
  assert.ok(body);
  assert.equal(body.content, "Read this");
  assert.equal(body.embeds.length, 1);
  assert.equal(body.embeds[0]?.title, "Rules");
  assert.equal(body.embeds[0]?.color, "#ff0000");
  assert.deepEqual(body.embeds[0]?.fields, [{ name: "One", value: "No spam", inline: false }]);
});

test("leaves out link previews", () => {
  const body = bodyFromMessage({ content: "https://example.com", embeds: [embed({ data: { type: "link" } })] } as never);
  assert.ok(body);
  assert.equal(body.embeds.length, 0);
});

test("a message with nothing to keep gives null", () => {
  assert.equal(bodyFromMessage({ content: "  ", embeds: [] } as never), null);
});

test("a message over Discord's limits gives null", () => {
  assert.equal(bodyFromMessage({ content: "x".repeat(2500), embeds: [] } as never), null);
});
