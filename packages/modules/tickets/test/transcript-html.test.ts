import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  plainMentions,
  renderStoredTranscriptText,
  renderTranscriptHtml,
  safeUrl,
  type StoredTranscriptMessage,
  type StoredTranscriptTicket,
} from "../dist/transcript-html.js";
import { DEFAULT_TRANSCRIPT_TEXTS } from "../dist/transcript.js";

const OPENER = "400000000000000001";
const STAFF = "500000000000000001";

const TICKET: StoredTranscriptTicket = {
  id: 12,
  guildName: "Test Guild",
  channelName: "ticket-ada",
  typeName: "Billing",
  subject: "Refund",
  status: "closed",
  priority: "high",
  openerId: OPENER,
  openerName: "Ada",
  claimedByName: "Grace",
  openedAt: new Date("2026-10-01T10:00:00.000Z"),
  closedAt: new Date("2026-10-02T11:00:00.000Z"),
  closedBy: STAFF,
  closedByName: "Grace",
  closeReason: "Solved",
  answers: [{ label: "Order number", value: "A-1" }],
  rating: 5,
};

let next = 1;
function message(overrides: Partial<StoredTranscriptMessage> = {}): StoredTranscriptMessage {
  return {
    messageId: String(700000000000000000 + next++),
    authorId: OPENER,
    authorName: "Ada",
    authorAvatar: "https://cdn.discordapp.com/avatars/1/a.png",
    authorIsStaff: false,
    content: "Hello",
    attachments: "[]",
    embeds: "[]",
    createdAt: new Date("2026-10-01T10:01:00.000Z"),
    editedAt: null,
    deletedAt: null,
    edits: 0,
    source: "discord",
    ...overrides,
  };
}

const NOW = { now: new Date("2026-10-03T00:00:00.000Z") };

/** Everything inside <body>, where member text ends up. */
const bodyOf = (html: string) => html.slice(html.indexOf("<body"));

describe("escapeHtml and safeUrl", () => {
  test("escapes every character that matters in text and attributes", () => {
    assert.equal(escapeHtml(`<a href="x" onclick='y'>&</a>`), "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });

  test("only http and https addresses are kept", () => {
    assert.equal(safeUrl("https://cdn.discordapp.com/a.png"), "https://cdn.discordapp.com/a.png");
    assert.equal(safeUrl("javascript:alert(1)"), null);
    assert.equal(safeUrl("JaVaScRiPt:alert(1)"), null);
    assert.equal(safeUrl("data:text/html,<script>alert(1)</script>"), null);
    assert.equal(safeUrl("vbscript:x"), null);
    assert.equal(safeUrl("not a url"), null);
    assert.equal(safeUrl(null), null);
  });
});

describe("renderTranscriptHtml", () => {
  test("a script in a message is text, and the document has no script of its own", () => {
    const html = renderTranscriptHtml(TICKET, [message({ content: "<script>alert(document.cookie)</script>" })], NOW);
    assert.ok(!/<script/i.test(html));
    assert.ok(html.includes("&lt;script&gt;alert(document.cookie)&lt;/script&gt;"));
  });

  test("markup in names, subjects, answers, embeds, buttons and file names is escaped", () => {
    const evil = `"><img src=x onerror=alert(1)>`;
    const html = renderTranscriptHtml(
      { ...TICKET, openerName: evil, subject: evil, typeName: evil, closeReason: evil, answers: [{ label: evil, value: evil }], guildName: evil, channelName: evil },
      [
        message({
          authorName: evil,
          embeds: JSON.stringify([{ title: evil, description: evil, fields: [{ name: evil, value: evil }], footer: { text: evil }, author: { name: evil } }]),
          attachments: JSON.stringify([{ name: evil, url: "https://cdn.discordapp.com/f.txt", contentType: "text/plain", size: 10 }]),
          components: JSON.stringify([{ components: [{ kind: "button", style: 1, label: evil }, { kind: "select", placeholder: evil }] }]),
          stickers: JSON.stringify([{ id: "", name: evil, format: 3 }]),
        }),
      ],
      NOW,
    );
    assert.ok(!html.includes("<img src=x"));
    assert.ok(!html.includes("onerror=alert(1)>"));
    assert.ok(html.includes("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"));
  });

  test("a dangerous address is never linked or loaded, wherever it is stored", () => {
    const html = renderTranscriptHtml(
      TICKET,
      [
        message({
          content: "[click](javascript:alert(1)) <javascript:alert(1)> [x](data:text/html,hi)",
          authorAvatar: "javascript:alert(1)",
          attachments: JSON.stringify([
            { name: "x.png", url: "javascript:alert(1)", contentType: "image/png", size: 1 },
            { name: "y.html", url: "data:text/html,hi", contentType: "text/html", size: 1 },
          ]),
          embeds: JSON.stringify([
            { title: "t", url: "javascript:alert(1)", imageUrl: "javascript:alert(2)", thumbnailUrl: "vbscript:x", author: { name: "a", url: "javascript:x", iconUrl: "data:image/png,x" } },
          ]),
          components: JSON.stringify([{ components: [{ kind: "button", style: 5, label: "go", url: "javascript:alert(1)" }] }]),
        }),
      ],
      NOW,
    );
    assert.ok(!/href="(?!https?:)/.test(html));
    assert.ok(!/src="(?!https?:)/.test(html));
    // Without a picture of their own, the author gets Discord's default one.
    assert.ok(html.includes("https://cdn.discordapp.com/embed/avatars/"));
  });

  test("an image attachment gets a preview and a file gets Discord's file card", () => {
    const html = renderTranscriptHtml(
      TICKET,
      [
        message({
          attachments: JSON.stringify([
            { name: "shot.png", url: "https://cdn.discordapp.com/attachments/1/2/shot.png", contentType: "image/png", size: 2048 },
            { name: "log.txt", url: "https://cdn.discordapp.com/attachments/1/2/log.txt", contentType: "text/plain", size: 10 },
          ]),
        }),
      ],
      NOW,
    );
    assert.ok(html.includes('<img class="dt-media-image" src="https://cdn.discordapp.com/attachments/1/2/shot.png" alt="shot.png"'));
    assert.ok(html.includes('class="dt-file-name" href="https://cdn.discordapp.com/attachments/1/2/log.txt"'));
    assert.ok(html.includes("10 bytes"));
  });

  test("markdown is drawn as Discord draws it", () => {
    const html = bodyOf(renderTranscriptHtml(TICKET, [message({ content: "**bold** *it* `code` ||secret|| [link](https://example.com)" })], NOW));
    assert.ok(html.includes("<strong>bold</strong>"));
    assert.ok(html.includes("<em>it</em>"));
    assert.ok(html.includes('<code class="dt-code">code</code>'));
    assert.ok(html.includes('<input class="dt-spoiler-input" type="checkbox"'));
    assert.ok(html.includes('href="https://example.com/"'));
  });

  test("mentions read as the names stored with the message, or the opener's", () => {
    const html = renderTranscriptHtml(
      TICKET,
      [
        message({
          content: `hi <@${OPENER}> <@&300000000000000001> <#200000000000000001> <@100000000000000009> @everyone`,
          mentions: JSON.stringify({ roles: { "300000000000000001": { name: "Mods", color: "#e67e22" } }, channels: { "200000000000000001": { name: "rules" } } }),
        }),
      ],
      NOW,
    );
    assert.ok(html.includes(">@Ada</span>"));
    assert.ok(html.includes('style="color:#e67e22;background-color:rgba(230, 126, 34, 0.1)">@Mods</span>'));
    assert.ok(html.includes(">#rules</span>"));
    assert.ok(html.includes(">@unknown-user</span>"));
    assert.ok(html.includes(">@everyone</span>"));
  });

  test("edited and deleted messages are marked, and a webhook reply carries the APP tag", () => {
    const html = renderTranscriptHtml(
      TICKET,
      [
        message({ editedAt: new Date("2026-10-01T10:02:00.000Z"), edits: 1 }),
        message({ deletedAt: new Date("2026-10-01T10:03:00.000Z") }),
        message({ authorId: STAFF, authorName: "Grace", authorIsStaff: true, authorBot: true, source: "dashboard" }),
      ],
      NOW,
    );
    assert.ok(html.includes("(edited)"));
    assert.ok(html.includes("dt-message-deleted"));
    assert.ok(html.includes("Deleted in Discord. Only staff can still see it here."));
    assert.ok(html.includes('<span class="dt-tag">APP</span>'));
    assert.ok(html.includes('<span class="dt-via" title="Sent from the dashboard">via dashboard</span>'));
  });

  test("a dashboard reply and a message the same person typed never share a header, and only the reply is marked", () => {
    const at = (minute: number) => new Date(`2026-10-01T10:0${minute}:00.000Z`);
    const html = renderTranscriptHtml(
      TICKET,
      [
        message({ authorId: STAFF, authorName: "Grace", authorIsStaff: true, content: "typed in Discord", createdAt: at(1) }),
        message({ authorId: STAFF, authorName: "Grace", authorIsStaff: true, authorBot: true, source: "dashboard", content: "sent from the dashboard", createdAt: at(2) }),
        message({ authorId: STAFF, authorName: "Grace", authorIsStaff: true, content: "typed again", createdAt: at(3) }),
        message({ authorId: STAFF, authorName: "Grace", authorIsStaff: true, content: "and again", createdAt: at(4) }),
      ],
      NOW,
    );
    const body = bodyOf(html);
    assert.equal(body.split("dt-message-start").length - 1, 3);
    assert.equal(body.split("dt-via").length - 1, 1);
    assert.equal(body.split('class="dt-tag"').length - 1, 1);
    const native = body.slice(body.indexOf("typed in Discord") - 600, body.indexOf("typed in Discord"));
    assert.ok(!native.includes("dt-via") && !native.includes("dt-tag"));
  });

  test("a reply under the team's name shows the team, and names the sender only when the line was shown", () => {
    const team = JSON.stringify({ name: "Support Team", avatarUrl: null, staffLine: false });
    const named = JSON.stringify({ name: "Support Team", avatarUrl: null, staffLine: true });
    const hidden = renderTranscriptHtml(
      TICKET,
      [message({ authorId: STAFF, authorName: "Grace", authorBot: true, source: "dashboard", sentAs: team, content: "On it" })],
      NOW,
    );
    assert.ok(hidden.includes(">Support Team</span>"));
    assert.ok(!bodyOf(hidden).split("dt-after")[0]!.includes("Grace"));
    assert.ok(hidden.includes("via dashboard"));
    const shown = renderTranscriptHtml(
      TICKET,
      [message({ authorId: STAFF, authorName: "Grace", authorBot: true, source: "dashboard", sentAs: named, content: "On it" })],
      NOW,
    );
    assert.ok(bodyOf(shown).includes("Replied by Grace"));

    const txt = renderStoredTranscriptText(TICKET, [message({ authorId: STAFF, authorName: "Grace", source: "dashboard", sentAs: named, content: "On it" })]);
    assert.ok(txt.includes("Support Team"));
    assert.ok(txt.includes("-# Replied by Grace"));
    const quiet = renderStoredTranscriptText(TICKET, [message({ authorId: STAFF, authorName: "Grace", source: "dashboard", sentAs: team, content: "On it" })]);
    assert.ok(!quiet.includes("Replied by"));
  });

  test("the details carry the ticket's facts and the server's own wording", () => {
    const texts = { ...DEFAULT_TRANSCRIPT_TEXTS, title: "Fiche {number} de {server}" };
    const html = renderTranscriptHtml(TICKET, [], { ...NOW, texts });
    assert.ok(html.includes("<title>Fiche 12 de Test Guild</title>"));
    assert.ok(html.includes("Opened by Ada at 2026-10-01 10:00:00 UTC"));
    assert.ok(html.includes("Closed by Grace at 2026-10-02 11:00:00 UTC"));
    for (const value of ["Billing", "high", "Grace", "Solved", "5 / 5", "Order number", "A-1"]) assert.ok(html.includes(value), value);
    assert.ok(html.includes(DEFAULT_TRANSCRIPT_TEXTS.empty));
    assert.ok(html.includes("Welcome to #ticket-ada!"));
  });

  test("an open ticket has no closing line", () => {
    const html = renderTranscriptHtml({ ...TICKET, status: "open", closedAt: null, closedByName: null, closedBy: null }, [], NOW);
    assert.ok(!html.includes("Closed by"));
    assert.ok(html.includes("<dd>Open</dd>"));
  });

  test("a value with a variable in it is not filled in a second time", () => {
    const html = renderTranscriptHtml({ ...TICKET, openerName: "{time}" }, [], NOW);
    assert.ok(html.includes("Opened by {time} at"));
  });

  test("one date divider per day, in UTC", () => {
    const html = renderTranscriptHtml(
      TICKET,
      [
        message({ createdAt: new Date("2026-10-01T10:00:00.000Z") }),
        message({ createdAt: new Date("2026-10-01T23:00:00.000Z") }),
        message({ createdAt: new Date("2026-10-02T01:00:00.000Z") }),
      ],
      NOW,
    );
    assert.equal(html.match(/class="dt-divider"/g)?.length, 2);
    assert.ok(html.includes("October 2, 2026"));
  });

  test("Discord's dark theme, a restrictive policy, and no outside styles or fonts", () => {
    const html = renderTranscriptHtml(TICKET, [message()], NOW);
    assert.ok(html.includes("--dt-bg:#313338"));
    assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;/);
    assert.ok(!/<link /.test(html));
    assert.ok(!/@import|@font-face|url\(/.test(html));
    assert.ok(html.startsWith("<!doctype html>"));
  });

  test("damaged stored JSON reads as nothing rather than failing", () => {
    const html = renderTranscriptHtml(TICKET, [message({ attachments: "{nope", embeds: "[1,2", components: "x", mentions: "[", reactions: "{}" })], NOW);
    assert.ok(html.includes("Hello"));
  });

  test("a row stored before the full message was kept still renders", () => {
    const old: StoredTranscriptMessage = {
      messageId: "700000000000009999",
      authorId: OPENER,
      authorName: "Ada",
      authorAvatar: null,
      authorIsStaff: false,
      content: "",
      attachments: "[]",
      embeds: JSON.stringify([{ title: "Old", description: "Only text" }]),
      createdAt: new Date("2026-10-01T10:01:00.000Z"),
      editedAt: null,
      deletedAt: null,
      edits: 0,
      source: "discord",
    };
    const html = renderTranscriptHtml(TICKET, [old], NOW);
    assert.ok(html.includes("Only text"));
    assert.ok(html.includes('class="dt-embed"'));
  });

  test("a large ticket renders quickly and whole", () => {
    const many = Array.from({ length: 20_000 }, (_, index) =>
      message({ content: `message ${index} <b>`, createdAt: new Date(Date.parse("2026-10-01T00:00:00.000Z") + index * 60_000) }),
    );
    const started = Date.now();
    const html = renderTranscriptHtml(TICKET, many, NOW);
    assert.ok(Date.now() - started < 5000, "took too long");
    assert.equal(html.match(/<li class="dt-message/g)?.length, 20_000);
    assert.ok(html.includes("message 19999 &lt;b&gt;"));
    assert.ok(!html.includes("<b>"));
  });
});

describe("renderStoredTranscriptText", () => {
  test("follows the posted file's layout and wording", () => {
    const text = renderStoredTranscriptText(TICKET, [
      message({ content: "Hi <script>", createdAt: new Date("2026-10-01T10:01:00.000Z") }),
      message({
        authorId: STAFF,
        authorName: "Grace",
        content: "",
        attachments: JSON.stringify([{ name: "a.png", url: "https://cdn.discordapp.com/a.png", contentType: "image/png", size: 1 }]),
        editedAt: new Date(),
      }),
    ]);
    const lines = text.split("\n");
    assert.equal(lines[0], "Ticket #12 - Test Guild / #ticket-ada");
    assert.equal(lines[1], "Opened by Ada at 2026-10-01 10:00:00 UTC");
    assert.equal(lines[2], "Subject: Refund");
    assert.equal(lines[3], "Closed by Grace at 2026-10-02 11:00:00 UTC");
    assert.ok(text.includes(`[2026-10-01 10:01:00 UTC] Ada (${OPENER})\nHi <script>`));
    assert.ok(text.includes(`Grace (${STAFF}) (edited)`));
    assert.ok(text.includes("  attachment: https://cdn.discordapp.com/a.png"));
    assert.ok(text.endsWith("\n"));
  });

  test("embeds are written out and deleted messages marked", () => {
    const text = renderStoredTranscriptText(TICKET, [
      message({ content: "", embeds: JSON.stringify([{ title: "Welcome", description: "Tell us more" }]), deletedAt: new Date() }),
    ]);
    assert.ok(text.includes("(deleted)"));
    assert.ok(text.includes("  | Welcome\n  | Tell us more"));
  });

  test("an empty ticket and an open ticket", () => {
    const text = renderStoredTranscriptText({ ...TICKET, status: "open", closedAt: null }, []);
    assert.ok(!text.includes("Closed by"));
    assert.ok(text.includes(DEFAULT_TRANSCRIPT_TEXTS.empty));
  });

  test("a message with nothing stored says so", () => {
    const text = renderStoredTranscriptText(TICKET, [message({ content: "" })]);
    assert.ok(text.includes(DEFAULT_TRANSCRIPT_TEXTS.unavailable));
  });
});

describe("plainMentions", () => {
  const USER = "231000000001885878";
  const ROLE = "120000000000000001";
  const NOBODY = "999000000000000001";

  test("writes a timestamp as the date and time it stands for", () => {
    const text = plainMentions("starts <t:1791792000:F> or <t:1791792000:R>", null);
    assert.ok(!text.includes("<t:"));
    assert.match(text, /2026/);
    assert.match(text, /UTC/);
  });

  test("falls back to the name a person posted under in the ticket", () => {
    assert.equal(plainMentions(`hi <@${USER}>`, null, { [USER]: "Ada" }), "hi @Ada");
  });

  test("never leaves a bare id for someone who cannot be named", () => {
    assert.equal(plainMentions(`<@${NOBODY}> <@&${ROLE}> <#${ROLE}>`, null), "@unknown user @unknown role #unknown channel");
  });

  test("keeps the stored name over the poster's", () => {
    const stored = JSON.stringify({ users: { [USER]: { name: "Stored" } }, roles: {}, channels: {} });
    assert.equal(plainMentions(`<@${USER}>`, stored, { [USER]: "Poster" }), "@Stored");
  });
});

describe("closeRequestEnding", () => {
  test("adds a full stop only when the reason has no punctuation of its own", async () => {
    const { closeRequestEnding } = await import("../dist/working.js");
    assert.equal(closeRequestEnding(null), ".");
    assert.equal(closeRequestEnding("  "), ".");
    assert.equal(closeRequestEnding("all sorted"), ": all sorted.");
    assert.equal(closeRequestEnding("Looks sorted, ok to close?"), ": Looks sorted, ok to close?");
    assert.equal(closeRequestEnding("Done."), ": Done.");
  });
});
