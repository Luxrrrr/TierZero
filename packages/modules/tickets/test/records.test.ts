import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { emptyEmbed, plainReply } from "@tier0/core";
import { CATEGORY_CHANNEL_LIMIT } from "@tier0/shared-tickets";
import {
  attachmentsJson,
  attributedReply,
  chooseCategory,
  componentsJson,
  embedsJson,
  mentionsJson,
  reactionsJson,
  isResponse,
  isSnowflake,
  relativeTime,
  replyMentions,
  spokenDuration,
} from "../dist/records.js";
import { withAnswers } from "../dist/welcome.js";
import { actionError, TicketActionError } from "../dist/outcome.js";

const room = (id: string, children = 0) => ({ id, exists: true, children });

describe("the category a new ticket goes in", () => {
  test("is the type's own while it has room", () => {
    assert.deepEqual(chooseCategory(room("a"), room("b")), { ok: true, id: "a" });
  });

  test("is the overflow once the first is full or deleted", () => {
    assert.deepEqual(chooseCategory(room("a", CATEGORY_CHANNEL_LIMIT), room("b")), { ok: true, id: "b" });
    assert.deepEqual(chooseCategory({ id: "a", exists: false, children: 0 }, room("b")), { ok: true, id: "b" });
  });

  test("says why when there is nowhere to go", () => {
    assert.deepEqual(chooseCategory(null, null), { ok: false, code: "noCategory" });
    assert.deepEqual(chooseCategory({ id: "a", exists: false, children: 0 }, null), { ok: false, code: "categoryGone" });
    assert.deepEqual(chooseCategory(room("a", 50), room("b", 50)), { ok: false, code: "categoryFull" });
  });
});

describe("a stored message", () => {
  test("keeps a link to each attachment and the text of each embed", () => {
    assert.deepEqual(JSON.parse(attachmentsJson([{ name: null, url: "https://cdn.example/a.png", size: 12 }])), [
      { name: "file", url: "https://cdn.example/a.png", contentType: null, size: 12 },
    ]);
    assert.deepEqual(JSON.parse(embedsJson([{ title: "Hi", description: null }, { title: null, description: null }])), [
      {
        type: "rich",
        title: "Hi",
        description: "",
        url: null,
        color: null,
        author: null,
        provider: null,
        fields: [],
        thumbnailUrl: null,
        imageUrl: null,
        footer: null,
        timestamp: null,
      },
    ]);
  });

  test("answers the opener when someone else who is not a bot wrote it", () => {
    assert.equal(isResponse({ id: "1", bot: false }, "2"), true);
    assert.equal(isResponse({ id: "2", bot: false }, "2"), false);
    assert.equal(isResponse({ id: "1", bot: true }, "2"), false);
  });
});

describe("a dashboard reply", () => {
  test("may only ping the people in the ticket and its staff roles", () => {
    assert.deepEqual(replyMentions(["1", "1", "2"], ["9"]), { parse: [], users: ["1", "2"], roles: ["9"] });
  });

  test("sent as the bot names the staff member in bold", () => {
    assert.deepEqual(attributedReply("Grace", "Hello"), { head: "**Grace**\n", parts: ["Hello"] });
    assert.equal(attributedReply("*Gr_ace*", "x").head, "**Grace**\n");
  });

  test("too long with the name on top goes out in two parts, cut at a space, with nothing lost", () => {
    const content = `${"word ".repeat(399)}last`;
    const { head, parts } = attributedReply("Grace", content);
    assert.equal(parts.length, 2);
    assert.ok(head.length + parts[0]!.length <= 2000);
    assert.ok(parts[1]!.length <= 2000);
    assert.equal(parts.join(" "), content);
    const solid = "x".repeat(2000);
    assert.equal(attributedReply("Grace", solid).parts.join(""), solid);
  });
});

describe("times", () => {
  test("read as a person would say them", () => {
    assert.equal(spokenDuration(30_000), "1 minute");
    assert.equal(spokenDuration(45 * 60_000), "45 minutes");
    assert.equal(spokenDuration(3 * 3_600_000), "3 hours");
    assert.equal(spokenDuration(3 * 86_400_000), "3 days");
  });

  test("relative times are Discord timestamps", () => {
    assert.equal(relativeTime(new Date(1_700_000_000_500)), "<t:1700000000:R>");
  });

  test("only member ids count as members", () => {
    assert.equal(isSnowflake("123456789012345678"), true);
    assert.equal(isSnowflake("auto-close"), false);
  });
});

describe("the first message", () => {
  const body = { ...plainReply(""), embeds: [{ ...emptyEmbed(), title: "{title}" }] };
  const answers = [
    { label: "What happened?", value: "Locked out" },
    { label: "Order number", value: "" },
  ];

  test("shows each given answer as a field", () => {
    const shown = withAnswers(body, answers, true);
    assert.deepEqual(shown.embeds[0]?.fields.map((f) => [f.name, f.value]), [["What happened?", "Locked out"]]);
  });

  test("is left alone when the type does not show answers or has no embed", () => {
    assert.deepEqual(withAnswers(body, answers, false), body);
    assert.deepEqual(withAnswers(plainReply("hi"), answers, true), plainReply("hi"));
  });
});

describe("a refusal from the dashboard", () => {
  test("carries a code and the dashboard's own sentence", () => {
    const error = actionError({ key: "alreadyClaimed" });
    assert.ok(error instanceof TicketActionError);
    assert.equal(error.code, "conflict");
    assert.deepEqual(error.toJSON(), { error: error.message, code: "conflict" });
    assert.equal(actionError({ key: "notATicket" }).code, "notFound");
  });
});

describe("a stored message in full", () => {
  test("keeps a whole embed the way discord.js gives it", () => {
    const [embed] = JSON.parse(
      embedsJson([
        {
          title: "Scrim results",
          color: 0x57f287,
          author: { name: "Scoreboard", iconURL: "https://cdn.discordapp.com/a.png" },
          fields: [{ name: "Winner", value: "Team Nova", inline: true }],
          thumbnail: { url: "https://cdn.discordapp.com/t.png" },
          footer: { text: "Week 3", iconURL: null },
          timestamp: "2026-10-14T18:00:00.000Z",
        },
      ]),
    );
    assert.equal(embed.color, 0x57f287);
    assert.deepEqual(embed.author, { name: "Scoreboard", url: null, iconUrl: "https://cdn.discordapp.com/a.png" });
    assert.deepEqual(embed.fields, [{ name: "Winner", value: "Team Nova", inline: true }]);
    assert.equal(embed.thumbnailUrl, "https://cdn.discordapp.com/t.png");
    assert.deepEqual(embed.footer, { text: "Week 3", iconUrl: null });
  });

  test("keeps rows of buttons and menus and leaves out the newer layout parts", () => {
    const rows = JSON.parse(
      componentsJson([
        {
          type: 1,
          components: [
            { type: 2, style: 4, label: "Close", emoji: { name: "🔒" } },
            { type: 2, style: 5, label: "Patch notes", url: "https://example.com" },
            { type: 3, placeholder: "Pick a map" },
          ],
        },
        { type: 17, components: [{ type: 10 }] },
      ]),
    );
    assert.deepEqual(rows, [
      {
        components: [
          { kind: "button", style: 4, label: "Close", emoji: { id: null, name: "🔒", animated: false }, url: null, disabled: false },
          { kind: "button", style: 5, label: "Patch notes", emoji: null, url: "https://example.com", disabled: false },
          { kind: "select", placeholder: "Pick a map", disabled: false },
        ],
      },
    ]);
  });

  test("keeps the names behind the mentions it can resolve, once each", () => {
    const lookup = {
      user: (id: string) => (id === "400000000000000001" ? { name: "FragHunter", color: "#e67e22" } : undefined),
      role: (id: string) => (id === "300000000000000001" ? { name: "Moderators", color: null } : undefined),
      channel: (id: string) => (id === "200000000000000001" ? { name: "rules" } : undefined),
    };
    const stored = JSON.parse(
      mentionsJson(["<@400000000000000001> <@!400000000000000001> <@&300000000000000001>", "<#200000000000000001> <@500000000000000009>"], lookup),
    );
    assert.deepEqual(stored, {
      users: { "400000000000000001": { name: "FragHunter", color: "#e67e22" } },
      roles: { "300000000000000001": { name: "Moderators" } },
      channels: { "200000000000000001": { name: "rules" } },
    });
  });

  test("keeps reactions that have a count", () => {
    assert.deepEqual(JSON.parse(reactionsJson([{ emoji: { name: "👍" }, count: 3 }, { emoji: { name: "" }, count: 1 }, { emoji: { name: "🎮" }, count: 0 }])), [
      { emoji: { id: null, name: "👍", animated: false }, count: 3 },
    ]);
  });
});
