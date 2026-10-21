import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { emptyEmbed, parseMessage } from "@tier0/core";
import { fromCode, toCode } from "../lib/message-code.ts";

const embed = () => ({
  ...emptyEmbed(),
  name: "Rules",
  title: "Server rules",
  description: "Be kind.",
  color: "#5865f2",
  footerText: "Thanks",
  authorName: "Staff",
  authorIconUrl: "https://example.com/a.png",
  imageUrl: "https://example.com/i.png",
  timestamp: "now",
  fields: [{ name: "One", value: "No spam", inline: true }],
});

describe("toCode", () => {
  test("writes the JSON Discord's API uses and leaves out what is empty", () => {
    const code = JSON.parse(toCode({ content: "", embeds: [embed()] }));
    assert.equal(code.content, undefined);
    assert.deepEqual(code.embeds[0], {
      title: "Server rules",
      description: "Be kind.",
      color: 0x5865f2,
      author: { name: "Staff", icon_url: "https://example.com/a.png" },
      image: { url: "https://example.com/i.png" },
      fields: [{ name: "One", value: "No spam", inline: true }],
      footer: { text: "Thanks" },
      timestamp: "now",
    });
  });
});

describe("fromCode", () => {
  test("a message written out reads back the same", () => {
    const draft = { content: "Hello", embeds: [embed()] };
    const result = fromCode(toCode(draft), draft);
    assert.ok(result.ok);
    assert.deepEqual(result.value, draft);
  });

  test("takes a single embed on its own and keeps the text", () => {
    const result = fromCode(JSON.stringify({ title: "Hi", color: "#00ff00" }), { content: "Keep me", embeds: [] });
    assert.ok(result.ok);
    assert.equal(result.value.content, "Keep me");
    assert.equal(result.value.embeds[0]?.title, "Hi");
    assert.equal(result.value.embeds[0]?.color, "#00ff00");
  });

  test("takes a list of embeds and an embed key", () => {
    const list = fromCode(JSON.stringify([{ title: "A" }, { title: "B" }]), { content: "", embeds: [] });
    assert.ok(list.ok);
    assert.equal(list.value.embeds.length, 2);
    const one = fromCode(JSON.stringify({ content: "x", embed: { title: "A" } }), { content: "", embeds: [] });
    assert.ok(one.ok);
    assert.equal(one.value.content, "x");
    assert.equal(one.value.embeds.length, 1);
  });

  test("reads a colour given as a number or as a hex string", () => {
    const result = fromCode(JSON.stringify({ embeds: [{ color: 16711680 }, { color: "FF0000" }, { color: "nope" }] }), { content: "", embeds: [] });
    assert.ok(result.ok);
    assert.deepEqual(result.value.embeds.map((entry) => entry.color), ["#ff0000", "#ff0000", ""]);
  });

  test("says what is wrong instead of throwing", () => {
    for (const text of ["{", "42", "{}", "[1]"]) {
      const result = fromCode(text, { content: "", embeds: [] });
      assert.equal(result.ok, false, text);
    }
  });

  test("what it reads passes the message checks", () => {
    const result = fromCode(toCode({ content: "", embeds: [embed()] }), { content: "", embeds: [] });
    assert.ok(result.ok);
    assert.ok(parseMessage({ ...result.value, buttons: [], selects: [], reactions: [] }).ok);
  });
});
