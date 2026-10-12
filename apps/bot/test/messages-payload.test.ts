import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { emptyEmbed } from "@tier0/core";
import { toDiscordPayload } from "../src/control/message-payload.ts";

describe("toDiscordPayload", () => {
  test("leaves out empty text so an embed-only message sends no content", () => {
    const payload = toDiscordPayload({ content: "  ", embeds: [{ ...emptyEmbed(), title: "Rules" }], buttons: [], selects: [], reactions: [] });
    assert.equal("content" in payload, false);
    assert.equal(payload.embeds.length, 1);
  });

  test("carries every part of an embed across", () => {
    const [embed] = toDiscordPayload({
      content: "hello",
      embeds: [
        {
          ...emptyEmbed(),
          title: "Rules",
          description: "Be kind.",
          color: "#e3b34a",
          authorName: "Staff",
          footerText: "Read them",
          imageUrl: "https://example.com/a.png",
          thumbnailUrl: "https://example.com/b.png",
          timestamp: "now",
          fields: [{ name: "One", value: "1", inline: true }],
        },
      ],
      buttons: [],
      selects: [],
      reactions: [],
    }).embeds.map((builder) => builder.toJSON());
    assert.equal(embed?.title, "Rules");
    assert.equal(embed?.color, 0xe3b34a);
    assert.equal(embed?.author?.name, "Staff");
    assert.equal(embed?.footer?.text, "Read them");
    assert.equal(embed?.image?.url, "https://example.com/a.png");
    assert.equal(embed?.thumbnail?.url, "https://example.com/b.png");
    assert.ok(embed?.timestamp);
    assert.deepEqual(embed?.fields, [{ name: "One", value: "1", inline: true }]);
  });

  test("uses a chosen time when one is set", () => {
    const [embed] = toDiscordPayload({
      content: "",
      embeds: [{ ...emptyEmbed(), title: "Later", timestamp: "2026-12-25T09:00:00.000Z" }],
      buttons: [],
      selects: [],
      reactions: [],
    }).embeds.map((builder) => builder.toJSON());
    assert.equal(embed?.timestamp, "2026-12-25T09:00:00.000Z");
  });

  test("lays link buttons out five to a row", () => {
    const buttons = Array.from({ length: 7 }, (_, i) => ({ label: `b${i}`, url: "https://example.com", emoji: i === 0 ? "👍" : "", style: "link" as const, disabled: false, action: { type: "none" as const } }));
    const { components } = toDiscordPayload({ content: "hi", embeds: [], buttons, selects: [], reactions: [] });
    assert.equal(components.length, 2);
    assert.equal(components[0]?.components.length, 5);
    assert.equal(components[1]?.components.length, 2);
    const first = components[0]?.components[0]?.toJSON();
    assert.equal(first?.type, 2);
    assert.equal((first as { url?: string }).url, "https://example.com");
  });

  test("a coloured button carries an id the bot can look up, and a link carries its address", () => {
    const { components } = toDiscordPayload({
      content: "hi",
      embeds: [],
      buttons: [
        { label: "Join", emoji: "", style: "success", url: "", disabled: false, action: { type: "none" } },
        { label: "Rules", emoji: "", style: "link", url: "https://example.com", disabled: false, action: { type: "none" } },
        { label: "Off", emoji: "", style: "danger", url: "", disabled: true, action: { type: "none" } },
      ],
      selects: [],
      reactions: [],
    });
    const [success, link, danger] = (components[0]?.components ?? []).map((c) => c.toJSON() as Record<string, unknown>);
    assert.equal(success?.custom_id, "tzmsg:b:0");
    assert.equal(success?.style, 3);
    assert.equal(link?.url, "https://example.com");
    assert.equal(link?.custom_id, undefined);
    assert.equal(danger?.disabled, true);
  });

  test("a menu takes a row of its own, after the buttons", () => {
    const empty = { description: "", emoji: "", default: false, action: { type: "none" as const } };
    const { components } = toDiscordPayload({
      content: "hi",
      embeds: [],
      buttons: [{ label: "A", emoji: "", style: "primary", url: "", disabled: false, action: { type: "none" } }],
      selects: [
        { kind: "string", placeholder: "Pick", minValues: 1, maxValues: 2, disabled: false, channelTypes: [], limitTo: [], action: { type: "none" }, options: [{ ...empty, label: "Red", value: "red" }, { ...empty, label: "Blue", value: "blue", default: true }] },
        { kind: "channel", placeholder: "", minValues: 1, maxValues: 1, disabled: false, channelTypes: [0], limitTo: [], options: [], action: { type: "none" } },
      ],
      reactions: [],
    });
    assert.equal(components.length, 3);
    const menu = components[1]?.components[0]?.toJSON() as Record<string, unknown>;
    assert.equal(menu.custom_id, "tzmsg:s:0");
    assert.equal(menu.max_values, 2);
    assert.equal((menu.options as { value: string; default?: boolean }[])[1]?.default, true);
    const channel = components[2]?.components[0]?.toJSON() as Record<string, unknown>;
    assert.equal(channel.custom_id, "tzmsg:s:1");
    assert.deepEqual(channel.channel_types, [0]);
  });

  test("a menu limited to particular channels becomes a menu of just those, named", () => {
    const names = { channels: new Map([["123456789012345678", "rules"], ["223456789012345678", "news"]]), roles: new Map<string, string>() };
    const { components } = toDiscordPayload(
      {
        content: "hi",
        embeds: [],
        buttons: [],
        selects: [{ kind: "channel", placeholder: "", minValues: 1, maxValues: 5, disabled: false, channelTypes: [0], options: [], limitTo: ["123456789012345678", "223456789012345678", "999999999999999999"], action: { type: "none" } }],
        reactions: [],
      },
      names,
    );
    const menu = components[0]?.components[0]?.toJSON() as Record<string, unknown>;
    assert.equal(menu.type, 3);
    const options = menu.options as { label: string; value: string }[];
    assert.deepEqual(options.map((o) => o.label), ["# rules", "# news"]);
    assert.equal(menu.max_values, 2);
  });
});
