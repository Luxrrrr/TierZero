import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ticketMessageFromRow, transcriptTree, type TicketMessageRow, type TranscriptElement } from "@tier0/shared-tickets";
import { renderTranscriptNode } from "../lib/transcript-react.ts";
import { archiveRowActions, transcriptPageHref, transcriptsHref } from "../lib/ticket-format.ts";
// The download is rendered by the bot's module; the dashboard must draw the same thing.
import { transcriptNodeHtml } from "../../../packages/modules/tickets/dist/transcript-html.js";

const BOT = "1100000000000000001";
const PLAYER = "1200000000000000002";
const MOD = "1300000000000000003";
const ROLE = "1500000000000000005";

let next = 0;
function row(overrides: Partial<TicketMessageRow>): TicketMessageRow {
  next++;
  return {
    id: next,
    messageId: String(1800000000000000000n + BigInt(next)),
    authorId: PLAYER,
    authorName: "FragHunter",
    authorAvatar: "https://cdn.discordapp.com/embed/avatars/2.png",
    authorIsStaff: false,
    content: "",
    attachments: "[]",
    embeds: "[]",
    createdAt: new Date(Date.UTC(2026, 9, 14, 18, next)),
    editedAt: null,
    deletedAt: null,
    edits: 0,
    source: "discord",
    ...overrides,
  };
}

const rows: TicketMessageRow[] = [
  row({
    authorId: BOT,
    authorName: "TierZero",
    authorBot: true,
    content: `<@${PLAYER}> <@&${ROLE}>`,
    mentions: JSON.stringify({ users: { [PLAYER]: { name: "FragHunter" } }, roles: { [ROLE]: { name: "Moderators", color: "#e67e22" } } }),
    embeds: JSON.stringify([
      {
        title: "Rank reset",
        description: "Opened by **FragHunter**",
        color: 0x5865f2,
        fields: [
          { name: "Game", value: "Apex Arena", inline: true },
          { name: "Platform", value: "PC", inline: true },
          { name: "Notes", value: "Lost Diamond II", inline: false },
        ],
        thumbnailUrl: "https://cdn.discordapp.com/embed/avatars/0.png",
        footer: { text: "Ticket #42" },
        timestamp: "2026-10-14T18:00:00.000Z",
      },
    ]),
    components: JSON.stringify([{ components: [{ kind: "button", style: 4, label: "Close" }, { kind: "button", style: 5, label: "Patch notes", url: "https://example.com" }] }]),
  }),
  row({ content: "lost **Diamond II** <:pog:1700000000000000007> 🎮 ||rollback?||" }),
  row({
    content: "screenshots",
    attachments: JSON.stringify([
      { name: "match.png", url: "https://cdn.discordapp.com/a/match.png", contentType: "image/png", size: 2048 },
      { name: "log.txt", url: "https://cdn.discordapp.com/a/log.txt", contentType: "text/plain", size: 18432 },
    ]),
  }),
  row({
    authorId: MOD,
    authorName: "Raven",
    authorColor: "#e67e22",
    authorIsStaff: true,
    content: "Run this:\n```js\nawait api.sync();\n```\n> quoted\n- one\n- two",
    reactions: JSON.stringify([{ emoji: { name: "👍" }, count: 3 }]),
  }),
  row({ content: "fixed, thanks", replyToId: String(1800000000000000000n + 4n), editedAt: new Date(Date.UTC(2026, 9, 14, 18, 30)), edits: 1 }),
  row({ content: "wrong channel", deletedAt: new Date(Date.UTC(2026, 9, 14, 18, 31)) }),
];

const tree = (messages = rows): TranscriptElement =>
  transcriptTree({
    messages: messages.map(ticketMessageFromRow),
    channelName: "ticket-0042",
    topic: "Opened by FragHunter: Rank reset",
    clock: { now: new Date(Date.UTC(2026, 9, 15, 12)), timeZone: "UTC" },
    activity: [{ key: "e1", at: "2026-10-14T18:02:30.000Z", text: "Raven claimed the ticket", kind: "claimed" }],
  });

const reactHtml = (node: TranscriptElement) => renderToStaticMarkup(renderTranscriptNode(node) as Parameters<typeof renderToStaticMarkup>[0]);

/** Every class attribute in order, and every piece of text in order, which is what "looks the same" comes down to. */
function structure(html: string) {
  const decode = (text: string) =>
    text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
  const classes = [...html.matchAll(/class="([^"]*)"/g)].map((match) => match[1]);
  const text = decode(html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "\u0000"))
    .split("\u0000")
    .filter((part) => part !== "");
  const hrefs = [...html.matchAll(/(?:href|src)="([^"]*)"/g)].map((match) => decode(match[1]!));
  return { classes, text, hrefs };
}

describe("the dashboard and the download draw one transcript", () => {
  test("the same classes, text and addresses, in the same order", () => {
    const fromReact = structure(reactHtml(tree()));
    const fromHtml = structure(transcriptNodeHtml(tree()));
    assert.ok(fromHtml.classes.length > 40, "the fixture should exercise most of the view");
    assert.deepEqual(fromReact.classes, fromHtml.classes);
    assert.deepEqual(fromReact.text, fromHtml.text);
    assert.deepEqual(fromReact.hrefs, fromHtml.hrefs);
  });

  test("the fixture covers what Discord draws", () => {
    const { classes } = structure(transcriptNodeHtml(tree()));
    for (const name of [
      "dt-header",
      "dt-welcome",
      "dt-divider",
      "dt-tag",
      "dt-embed dt-embed-has-thumbnail",
      "dt-embed-field",
      "dt-button dt-button-danger",
      "dt-button dt-button-link",
      "dt-emoji",
      "dt-spoiler",
      "dt-media",
      "dt-file",
      "dt-codeblock",
      "dt-quote",
      "dt-list",
      "dt-reaction",
      "dt-reply",
      "dt-edited",
      "dt-deleted-note",
      "dt-activity",
    ]) {
      assert.ok(classes.includes(name), name);
    }
  });

  test("hostile text stays text in both, and no unsafe address survives either", () => {
    const hostile = [
      row({
        authorName: `"><script>alert(1)</script>`,
        content: `<img src=x onerror=alert(1)> [x](javascript:alert(1)) <javascript:alert(1)> "'><svg onload=alert(1)>`,
        authorAvatar: "javascript:alert(1)",
        embeds: JSON.stringify([{ title: "<b>t</b>", url: "javascript:alert(1)", imageUrl: "data:text/html,x", author: { name: "a", url: "vbscript:x" } }]),
        attachments: JSON.stringify([{ name: `a" onmouseover="alert(1)`, url: "javascript:alert(1)", contentType: "image/png", size: 1 }]),
      }),
    ];
    for (const html of [reactHtml(tree(hostile)), transcriptNodeHtml(tree(hostile))]) {
      assert.ok(!/<script|<img src=x|<svg onload|<b>/i.test(html), html);
      const tags = html.match(/<[a-z][^>]*>/gi) ?? [];
      assert.ok(!tags.some((tag) => /\son[a-z]+=/i.test(tag.replace(/"[^"]*"/g, '""'))), "an event handler attribute was written");
      assert.ok(!/(?:href|src)="(?!https?:)/.test(html), "an unsafe address was written");
    }
  });

  test("a huge message renders in both without hanging", () => {
    const huge = [row({ content: "**__~~||".repeat(5_000) + "x".repeat(100_000) })];
    const started = Date.now();
    reactHtml(tree(huge));
    transcriptNodeHtml(tree(huge));
    assert.ok(Date.now() - started < 3000);
  });
});

describe("reaching a transcript", () => {
  test("an archive row offers to read the transcript first, then its downloads", () => {
    const actions = archiveRowActions("111111111111111111", 42, { status: "closed", q: "rank" });
    assert.deepEqual(
      actions.map((action) => action.kind),
      ["read", "html", "txt"],
    );
    assert.equal(actions[0]!.href, "/guilds/111111111111111111/tickets/transcripts/42?q=rank");
    assert.equal(actions[0]!.download, false);
    assert.equal(actions[1]!.href, "/api/guilds/111111111111111111/tickets/items/42/transcript.html");
  });

  test("the inbox's closed ticket links to the same transcript page the archive opens", () => {
    assert.equal(transcriptPageHref("111111111111111111", 42), transcriptsHref("111111111111111111", {}, 42));
    assert.equal(transcriptPageHref("111111111111111111", 42), "/guilds/111111111111111111/tickets/transcripts/42");
  });
});
