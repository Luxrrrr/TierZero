import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { emptyEmbed, parseMessage } from "@tier0/core";
import { fromCode, toCode } from "../lib/message-code.ts";
import type { MessageDraft } from "../components/messages/MessageForm.tsx";

const blank = (extra: Partial<MessageDraft> = {}): MessageDraft => ({ content: "", embeds: [], buttons: [], selects: [], reactions: [], ...extra });

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
    const code = JSON.parse(toCode(blank({ embeds: [embed()] })));
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
    const draft = blank({ content: "Hello", embeds: [embed()] });
    const result = fromCode(toCode(draft), draft);
    assert.ok(result.ok);
    assert.deepEqual(result.value, draft);
  });

  test("takes a single embed on its own and keeps the text", () => {
    const result = fromCode(JSON.stringify({ title: "Hi", color: "#00ff00" }), blank({ content: "Keep me" }));
    assert.ok(result.ok);
    assert.equal(result.value.content, "Keep me");
    assert.equal(result.value.embeds[0]?.title, "Hi");
    assert.equal(result.value.embeds[0]?.color, "#00ff00");
  });

  test("takes a list of embeds and an embed key", () => {
    const list = fromCode(JSON.stringify([{ title: "A" }, { title: "B" }]), blank());
    assert.ok(list.ok);
    assert.equal(list.value.embeds.length, 2);
    const one = fromCode(JSON.stringify({ content: "x", embed: { title: "A" } }), blank());
    assert.ok(one.ok);
    assert.equal(one.value.content, "x");
    assert.equal(one.value.embeds.length, 1);
  });

  test("reads a colour given as a number or as a hex string", () => {
    const result = fromCode(JSON.stringify({ embeds: [{ color: 16711680 }, { color: "FF0000" }, { color: "nope" }] }), blank());
    assert.ok(result.ok);
    assert.deepEqual(result.value.embeds.map((entry) => entry.color), ["#ff0000", "#ff0000", ""]);
  });

  test("says what is wrong instead of throwing", () => {
    for (const text of ["{", "42", "{}", "[1]"]) {
      const result = fromCode(text, blank());
      assert.equal(result.ok, false, text);
    }
  });

  test("what it reads passes the message checks", () => {
    const result = fromCode(toCode(blank({ embeds: [embed()] })), blank());
    assert.ok(result.ok);
    assert.ok(parseMessage({ ...result.value, buttons: [], selects: [], reactions: [] }).ok);
  });
});


const menu = () => ({
  kind: "string" as const,
  placeholder: "Pick",
  minValues: 1,
  maxValues: 2,
  disabled: false,
  options: [
    { label: "One", value: "one", description: "", emoji: "", default: false, action: { type: "reply" as const, reply: { content: "", embeds: [embed()], ephemeral: true, dm: true } } },
  ],
  channelTypes: [],
  limitTo: [],
  action: { type: "none" as const },
});

describe("buttons, menus and reactions", () => {
  test("are part of the code and read back the same", () => {
    const draft = blank({ embeds: [embed()], selects: [menu()], reactions: ["👍"] });
    const code = JSON.parse(toCode(draft));
    assert.equal(code.selects[0].options[0].action.reply.dm, true);
    assert.deepEqual(code.reactions, ["👍"]);
    const result = fromCode(toCode(draft), draft);
    assert.ok(result.ok);
    assert.deepEqual(result.value, draft);
  });

  test("are left out of the code while there are none", () => {
    const code = JSON.parse(toCode(blank({ embeds: [embed()] })));
    assert.equal("buttons" in code, false);
    assert.equal("selects" in code, false);
    assert.equal("reactions" in code, false);
  });

  test("stay as they are when the code doesn't mention them", () => {
    const current = blank({ selects: [menu()], reactions: ["👍"] });
    const result = fromCode(JSON.stringify({ embeds: [{ title: "New" }] }), current);
    assert.ok(result.ok);
    assert.deepEqual(result.value.selects, current.selects);
    assert.deepEqual(result.value.reactions, ["👍"]);
    assert.equal(result.value.embeds[0]?.title, "New");
  });

  test("can be the only thing the code brings, and an empty list clears them", () => {
    const current = blank({ embeds: [embed()], selects: [menu()] });
    const added = fromCode(JSON.stringify({ selects: [menu()] }), blank({ embeds: [embed()] }));
    assert.ok(added.ok);
    assert.equal(added.value.selects.length, 1);
    assert.equal(added.value.embeds.length, 1);
    assert.deepEqual(added.value.embeds, [embed()]);
    const cleared = fromCode(JSON.stringify({ selects: [] }), current);
    assert.ok(cleared.ok);
    assert.equal(cleared.value.selects.length, 0);
  });
});
