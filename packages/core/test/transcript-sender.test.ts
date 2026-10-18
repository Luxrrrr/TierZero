import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ticketMessageFromRow, transcriptTree, type TicketMessageRow, type TranscriptNode } from "../dist/index.js";

const KAIRO = "130000000000000002";
let next = 0;

function row(over: Partial<TicketMessageRow>): TicketMessageRow {
  next++;
  return {
    id: next,
    messageId: String(1800000000000000000n + BigInt(next)),
    authorId: KAIRO,
    authorName: "Kairo",
    authorAvatar: null,
    authorIsStaff: true,
    content: `message ${next}`,
    attachments: "[]",
    embeds: "[]",
    createdAt: new Date(Date.UTC(2026, 9, 18, 12, next)),
    editedAt: null,
    deletedAt: null,
    edits: 0,
    source: "discord",
    ...over,
  };
}

const text = (node: TranscriptNode): string => (typeof node === "string" ? node : node.children.map(text).join(""));
const find = (node: TranscriptNode, test: (tag: string, cls: string) => boolean, out: TranscriptNode[] = []): TranscriptNode[] => {
  if (typeof node === "string") return out;
  if (test(node.tag, String(node.attrs.class ?? ""))) out.push(node);
  for (const child of node.children) find(child, test, out);
  return out;
};
const tree = (rows: TicketMessageRow[], showSender = false) =>
  transcriptTree({ messages: rows.map(ticketMessageFromRow), channelName: "ticket-1", topic: null, clock: { now: null, timeZone: "UTC" }, showSender });
const classed = (root: TranscriptNode, cls: string) => find(root, (_, c) => c.split(" ").includes(cls));

describe("a dashboard reply beside a message the same person typed", () => {
  const dashboard = (over: Partial<TicketMessageRow> = {}) => row({ source: "dashboard", authorBot: true, ...over });

  test("never share a header, whichever comes first", () => {
    const rows = [row({}), dashboard(), dashboard(), row({}), row({})];
    assert.equal(classed(tree(rows), "dt-message-start").length, 3);
    assert.equal(classed(tree([dashboard(), row({})]), "dt-message-start").length, 2);
  });

  test("two dashboard replies in a row still group", () => {
    assert.equal(classed(tree([dashboard(), dashboard(), dashboard()]), "dt-message-start").length, 1);
  });

  test("only the dashboard reply is marked, with the pill and the APP tag, and the native one has neither", () => {
    const root = tree([row({}), dashboard()]);
    assert.equal(classed(root, "dt-via").length, 1);
    assert.equal(classed(root, "dt-tag").length, 1);
    assert.equal(text(classed(root, "dt-via")[0]!), "via dashboard");
    const native = classed(root, "dt-message")[0]!;
    assert.equal(classed(native, "dt-via").length + classed(native, "dt-tag").length, 0);
  });

  test("a native message from a bot still has the APP tag and no dashboard mark", () => {
    const root = tree([row({ authorBot: true, authorName: "TierZero" })]);
    assert.equal(classed(root, "dt-tag").length, 1);
    assert.equal(classed(root, "dt-via").length, 0);
  });
});

describe("a reply under the team's name", () => {
  const sentAs = (staffLine: boolean) => JSON.stringify({ name: "Support Team", avatarUrl: null, staffLine });
  const reply = (staffLine: boolean) => row({ source: "dashboard", authorBot: true, sentAs: sentAs(staffLine), content: "On it" });

  test("the dashboard names who sent it beside the header", () => {
    const root = tree([reply(false)], true);
    assert.equal(text(classed(root, "dt-name")[0]!), "Support Team");
    assert.equal(text(classed(root, "dt-sender")[0]!), "sent by Kairo");
    assert.match(String((classed(root, "dt-via")[0] as { attrs: Record<string, unknown> }).attrs.title), /Kairo/);
  });

  test("a transcript shows what Discord showed: the team, no sender mark, and the line only when it was there", () => {
    const quiet = tree([reply(false)]);
    assert.equal(classed(quiet, "dt-sender").length, 0);
    assert.ok(!text(quiet).includes("Kairo"));
    assert.ok(!String((classed(quiet, "dt-via")[0] as { attrs: Record<string, unknown> }).attrs.title).includes("Kairo"));
    const named = tree([reply(true)]);
    assert.ok(text(named).includes("Replied by Kairo"));
    assert.ok(!text(tree([reply(true)], true)).includes("Replied by"));
  });
});
