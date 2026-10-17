import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { customEmojiParts, customEmojiUrl, normalizeEmojiInput, searchEmoji, UNICODE_EMOJI } from "../lib/emoji.ts";
import { s } from "@tier0/core";

const SERVER = [
  { id: "123456789012345678", name: "pogchamp", animated: false, url: "https://cdn.example/1.png" },
  { id: "223456789012345678", name: "spin", animated: true, url: "https://cdn.example/2.gif" },
];

describe("normalizeEmojiInput", () => {
  test("turns :name: into the server's emoji in the stored form", () => {
    assert.equal(normalizeEmojiInput(":pogchamp:", SERVER), "<:pogchamp:123456789012345678>");
    assert.equal(normalizeEmojiInput(":spin:", SERVER), "<a:spin:223456789012345678>");
    assert.equal(normalizeEmojiInput(" :PogChamp: ", SERVER), "<:pogchamp:123456789012345678>");
  });

  test("turns a standard name into the emoji itself", () => {
    assert.equal(normalizeEmojiInput(":trophy:", SERVER), "🏆");
  });

  test("leaves an unknown name alone so the field can say so", () => {
    assert.equal(normalizeEmojiInput(":nothere:", SERVER), ":nothere:");
  });

  test("passes Discord's own form and unicode through", () => {
    assert.equal(normalizeEmojiInput("<:x1:323456789012345678>", SERVER), "<:x1:323456789012345678>");
    assert.equal(normalizeEmojiInput("🎮", SERVER), "🎮");
  });

  test("produces only what the schema accepts, or what it refuses with its own message", () => {
    const field = s.emoji();
    for (const typed of [":pogchamp:", ":trophy:", "🎮"]) {
      assert.equal(field.parse(normalizeEmojiInput(typed, SERVER)).ok, true, typed);
    }
    assert.equal(field.parse(normalizeEmojiInput(":nothere:", SERVER)).ok, false);
  });
});

describe("the standard set", () => {
  test("holds only values the schema accepts, each once", () => {
    const field = s.emoji();
    const names = new Set<string>();
    for (const emoji of UNICODE_EMOJI) {
      assert.equal(field.parse(emoji.char).ok, true, emoji.name);
      assert.equal(names.has(emoji.name), false, `${emoji.name} is listed twice`);
      names.add(emoji.name);
    }
  });
});

describe("custom emoji", () => {
  test("splits the stored form and builds its image address", () => {
    const parts = customEmojiParts("<a:spin:223456789012345678>");
    assert.deepEqual(parts, { animated: true, name: "spin", id: "223456789012345678" });
    assert.equal(customEmojiUrl(parts!), "https://cdn.discordapp.com/emojis/223456789012345678.gif");
    assert.equal(customEmojiParts("🎮"), null);
  });
});

describe("searchEmoji", () => {
  test("finds by name and keyword, server emoji included", () => {
    const found = searchEmoji("pog", SERVER);
    assert.deepEqual(found.server.map((emoji) => emoji.name), ["pogchamp"]);
    assert.ok(searchEmoji("controller", SERVER).unicode.some((emoji) => emoji.char === "🎮"));
    assert.ok(searchEmoji(":trophy:", SERVER).unicode.some((emoji) => emoji.char === "🏆"));
  });

  test("lists everything for an empty search", () => {
    const found = searchEmoji("  ", SERVER);
    assert.equal(found.server.length, 2);
    assert.equal(found.unicode.length, UNICODE_EMOJI.length);
  });
});
