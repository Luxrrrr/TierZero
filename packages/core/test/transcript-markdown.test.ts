import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isEmojiOnly,
  markdownPlainText,
  parseDiscordMarkdown,
  readTicketComponents,
  readTicketMentions,
  ticketMessageFromRow,
  transcriptFullTime,
  transcriptMessageTime,
  transcriptTimestamp,
  transcriptTree,
  type MarkdownNode,
  type TicketMessageDto,
  type TranscriptElement,
  type TranscriptNode,
} from "../dist/index.js";

const PLAYER = "400000000000000001";
const ROLE = "300000000000000001";
const CHANNEL = "200000000000000001";

const parse = (text: string) => parseDiscordMarkdown(text, { users: { [PLAYER]: { name: "FragHunter" } }, roles: { [ROLE]: { name: "Mods", color: "#E67E22" } }, channels: { [CHANNEL]: { name: "rules" } } });

/** The node types in order, nested in brackets, to compare shapes without the noise. */
function shape(nodes: readonly MarkdownNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return JSON.stringify(node.value);
      if (node.type === "list") return `list[${node.items.map((item) => shape(item)).join("|")}]`;
      if ("children" in node) return `${node.type}[${shape(node.children)}]`;
      if (node.type === "code" || node.type === "codeblock") return `${node.type}(${JSON.stringify(node.value)})`;
      if (node.type === "mention") return `${node.kind}(${node.name})`;
      return node.type;
    })
    .join(" ");
}

describe("parseDiscordMarkdown", () => {
  test("inline formatting, including bold italics closing on the last two stars", () => {
    assert.equal(shape(parse("***clutch*** __*under*__ ~~nerfed~~ ||spoiler||")), 'strong[em["clutch"]] " " underline[em["under"]] " " strike["nerfed"] " " spoiler["spoiler"]');
  });

  test("underscores inside a word are not italics", () => {
    assert.equal(shape(parse("snake_case_name and _whole_")), '"snake_case_name and " em["whole"]');
  });

  test("a backslash keeps a delimiter as typed", () => {
    assert.equal(shape(parse("\\*not italic\\*")), '"*not italic*"');
  });

  test("inline code and fenced blocks keep their text untouched", () => {
    assert.equal(shape(parse("`**raw**`")), 'code("**raw**")');
    const [block] = parse("```ts\nconst hp = 100;\n```");
    assert.deepEqual(block, { type: "codeblock", lang: "ts", value: "const hp = 100;" });
  });

  test("headings, subtext, quotes and lists only count at the start of a line", () => {
    assert.equal(shape(parse("# Patch notes\n-# small print\n> quoted\nnot # a heading")), 'heading["Patch notes"] subtext["small print"] quote["quoted"] "not # a heading"');
    assert.equal(shape(parse("- one\n- two\n  - nested\n1. first")), 'list["one"|"two" list["nested"]] list["first"]');
  });

  test("mentions resolve to stored names, and unknown ids read as Discord shows them", () => {
    const nodes = parse(`<@${PLAYER}> <@!${PLAYER}> <@&${ROLE}> <#${CHANNEL}> <@100000000000000009> @everyone @here`);
    assert.equal(shape(nodes), 'user(FragHunter) " " user(FragHunter) " " role(Mods) " " channel(rules) " " user(unknown-user) " " everyone(everyone) " " here(here)');
    const role = nodes.find((node) => node.type === "mention" && node.kind === "role");
    assert.equal(role?.type === "mention" ? role.color : null, "#e67e22");
  });

  test("custom emoji, unicode emoji and timestamps", () => {
    const nodes = parse("<a:dance:500000000000000001> 🎮👍🏽 <t:1700000000:R>");
    assert.deepEqual(nodes[0], { type: "emoji", animated: true, name: "dance", id: "500000000000000001" });
    assert.deepEqual(
      nodes.filter((node) => node.type === "unicodeEmoji").map((node) => (node.type === "unicodeEmoji" ? node.value : "")),
      ["🎮", "👍🏽"],
    );
    assert.deepEqual(nodes[nodes.length - 1], { type: "timestamp", unix: 1700000000, style: "R" });
  });

  test("links: bare, in angle brackets and masked, and only http or https", () => {
    const nodes = parse("see https://example.com/a_(b). or <https://x.y> or [patch](https://x.y/p) or [bad](javascript:alert(1))");
    const links = nodes.filter((node): node is Extract<MarkdownNode, { type: "link" }> => node.type === "link");
    assert.deepEqual(
      links.map((link) => link.url),
      ["https://example.com/a_(b)", "https://x.y/", "https://x.y/p"],
    );
    assert.ok(markdownPlainText(nodes).includes("[bad](javascript:alert(1))"));
  });

  test("a message of only emoji is drawn large", () => {
    assert.equal(isEmojiOnly(parse("🎮 <:gg:500000000000000001>")), true);
    assert.equal(isEmojiOnly(parse("gg 🎮")), false);
  });

  test("markup is text, never markup", () => {
    const nodes = parse("<script>alert(1)</script><img src=x onerror=alert(1)>");
    assert.equal(markdownPlainText(nodes), "<script>alert(1)</script><img src=x onerror=alert(1)>");
  });

  test("finishes quickly on hostile input", () => {
    const hostile = [
      "*".repeat(200_000),
      "**a".repeat(50_000),
      "[".repeat(100_000),
      "||**__~~*_".repeat(20_000) + "x",
      "<".repeat(100_000),
      "<@".repeat(50_000),
      "https://a ".repeat(20_000),
      "`".repeat(100_000),
      "> ".repeat(50_000),
      "- ".repeat(50_000),
    ];
    for (const text of hostile) {
      const started = Date.now();
      parseDiscordMarkdown(text);
      assert.ok(Date.now() - started < 1000, `took too long on ${JSON.stringify(text.slice(0, 12))}`);
    }
  });

  test("deep nesting stops at a limit instead of recursing forever", () => {
    const deep = "**__~~||".repeat(500) + "core" + "||~~__**".repeat(500);
    let depth = 0;
    const walk = (nodes: readonly MarkdownNode[], level: number) => {
      for (const node of nodes) {
        depth = Math.max(depth, level);
        if ("children" in node) walk(node.children, level + 1);
      }
    };
    walk(parseDiscordMarkdown(deep), 1);
    assert.ok(depth <= 10, `nested ${depth} deep`);
  });
});

describe("stored message parts", () => {
  test("components keep only buttons and menus, and only safe links", () => {
    assert.deepEqual(
      readTicketComponents(JSON.stringify([{ components: [{ kind: "button", style: 9, label: "x", url: "javascript:1" }, { kind: "weird" }] }, { components: [] }])),
      [{ components: [{ kind: "button", style: 2, label: "x", emoji: null, url: null, disabled: false }] }],
    );
  });

  test("mentions drop ids that are not Discord ids and colours that are not colours", () => {
    assert.deepEqual(readTicketMentions(JSON.stringify({ users: { abc: { name: "x" }, [PLAYER]: { name: "FragHunter", color: "red" } } })), {
      users: { [PLAYER]: { name: "FragHunter", color: null } },
      roles: {},
      channels: {},
    });
  });
});

describe("times", () => {
  const clock = { now: new Date("2026-10-15T12:00:00Z"), timeZone: "UTC" };

  test("a message reads Today, Yesterday or its date", () => {
    assert.equal(transcriptMessageTime(new Date("2026-10-15T09:05:00Z"), clock), "Today at 9:05 AM");
    assert.equal(transcriptMessageTime(new Date("2026-10-14T21:30:00Z"), clock), "Yesterday at 9:30 PM");
    assert.equal(transcriptMessageTime(new Date("2026-10-01T21:30:00Z"), clock), "1 Oct 2026 9:30 PM");
  });

  test("a file writes the date with the day first and names the zone", () => {
    assert.equal(transcriptMessageTime(new Date("2026-10-15T09:05:00Z"), { now: null, timeZone: "UTC" }), "15 Oct 2026 9:05 AM UTC");
    assert.equal(transcriptFullTime(new Date("2026-10-15T09:05:00Z"), "UTC"), "Thursday, October 15, 2026 at 9:05 AM UTC");
  });

  test("timestamps in each style", () => {
    const unix = Date.parse("2026-10-14T18:30:00Z") / 1000;
    assert.equal(transcriptTimestamp(unix, "t", clock), "6:30 PM");
    assert.equal(transcriptTimestamp(unix, "d", clock), "10/14/2026");
    assert.equal(transcriptTimestamp(unix, "D", clock), "October 14, 2026");
    assert.equal(transcriptTimestamp(unix, "f", clock), "October 14, 2026 6:30 PM");
    assert.equal(transcriptTimestamp(unix, "R", clock), "18 hours ago");
  });
});

const message = (overrides: Partial<TicketMessageDto> & { author?: Partial<TicketMessageDto["author"]> } = {}): TicketMessageDto => {
  const base = ticketMessageFromRow({
    id: 1,
    messageId: "900000000000000001",
    authorId: PLAYER,
    authorName: "FragHunter",
    authorAvatar: null,
    authorIsStaff: false,
    content: "gg",
    attachments: "[]",
    embeds: "[]",
    createdAt: new Date("2026-10-14T18:00:00Z"),
    editedAt: null,
    deletedAt: null,
    edits: 0,
    source: "discord",
  });
  return { ...base, ...overrides, author: { ...base.author, ...overrides.author } };
};

function classes(node: TranscriptNode, out: string[] = []): string[] {
  if (typeof node === "string") return out;
  if (typeof node.attrs.class === "string") out.push(node.attrs.class);
  for (const child of node.children) classes(child, out);
  return out;
}

describe("transcriptTree", () => {
  const tree = (messages: TicketMessageDto[]): TranscriptElement =>
    transcriptTree({ messages, channelName: "ticket-0042", topic: "Rank reset", clock: { now: null, timeZone: "UTC" } });

  test("groups one author's messages within seven minutes, as Discord does", () => {
    const list = classes(
      tree([
        message({ messageId: "900000000000000001", createdAt: "2026-10-14T18:00:00.000Z" }),
        message({ messageId: "900000000000000002", createdAt: "2026-10-14T18:06:00.000Z" }),
        message({ messageId: "900000000000000003", createdAt: "2026-10-14T18:14:00.000Z" }),
        message({ messageId: "900000000000000004", createdAt: "2026-10-14T18:15:00.000Z", replyTo: "900000000000000001" }),
      ]),
    ).filter((name) => name === "dt-message" || name.startsWith("dt-message "));
    assert.deepEqual(list, ["dt-message dt-message-start", "dt-message", "dt-message dt-message-start", "dt-message dt-message-start dt-message-reply"]);
  });

  test("has the channel header, the welcome and a divider per day", () => {
    const list = classes(tree([message()]));
    for (const name of ["dt-header", "dt-header-topic", "dt-welcome-title", "dt-divider"]) assert.ok(list.includes(name), name);
  });

  test("ticket activity appears only when asked for, in its own style", () => {
    const withActivity = transcriptTree({
      messages: [message()],
      channelName: "ticket-0042",
      clock: { now: null, timeZone: "UTC" },
      activity: [{ key: "e1", at: "2026-10-14T18:01:00.000Z", text: "Raven claimed the ticket", kind: "claimed" }],
    });
    assert.ok(classes(withActivity).includes("dt-activity"));
    assert.ok(!classes(tree([message()])).includes("dt-activity"));
  });

  test("an empty ticket says so", () => {
    assert.ok(classes(tree([])).includes("dt-empty"));
  });

  test("a thread ticket is headed as a thread, not as a channel", () => {
    const thread = transcriptTree({ messages: [], channelName: "ticket-0042", clock: { now: null, timeZone: "UTC" }, thread: true });
    assert.equal(thread.attrs["data-thread"], "true");
    const strings: string[] = [];
    const walk = (node: TranscriptNode) => {
      if (typeof node === "string") strings.push(node);
      else node.children.forEach(walk);
    };
    walk(thread);
    assert.ok(strings.includes("This is the start of the ticket-0042 thread."));
    assert.ok(!strings.some((text) => text.includes("#ticket-0042")));
    assert.equal(tree([]).attrs["data-thread"], undefined);
  });
});
