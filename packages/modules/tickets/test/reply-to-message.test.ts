import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ada, grace, linus, mod, open, prisma, setup } from "./ticket-world.ts";
import { GUILD, interaction } from "./fake-discord.ts";

const { replyToTicket } = mod;

const actor = { userId: grace.id, name: "Grace", avatarUrl: null };
const TARGET = "140000000000000001";

async function store(ticketId: number, over: Record<string, unknown> = {}) {
  return prisma.ticketMessage.create({
    data: {
      ticketId,
      messageId: TARGET,
      authorId: ada.id,
      authorName: "Ada",
      authorAvatar: null,
      authorIsStaff: false,
      content: "I **still** cannot log in <@130000000000000009> see https://example.com/a",
      createdAt: new Date(),
      ...over,
    },
  });
}

describe("a dashboard reply to one message", () => {
  test("the webhook message opens with a quiet quote linking the original, and no one new is pinged", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    await store(row.id);
    const result = await replyToTicket(w.ctx, row.id, "Try a reset", actor, [], [], TARGET);
    const sent = ch.webhookSent[0]!;
    const link = `https://discord.com/channels/${GUILD}/${row.channelId}/${TARGET}`;
    assert.equal(sent.content, `-# ↩ [replying to @Ada: I still cannot log in @user see link](<${link}>)\nTry a reset`);
    assert.deepEqual((sent.allowedMentions as { parse: string[] }).parse, []);
    const stored = await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId: row.id, source: "dashboard" } });
    assert.equal(stored.replyToId, TARGET);
    assert.equal(stored.content, "Try a reset");
    assert.equal(result.message.replyTo, TARGET);
  });

  test("a reply with only an embed still opens with the quote", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    await store(row.id);
    const embed = { ...(await import("@tier0/core")).emptyEmbed(), title: "Steps" };
    await replyToTicket(w.ctx, row.id, "", actor, [], [embed], TARGET);
    assert.match(String(ch.webhookSent[0]!.content), /^-# ↩ \[replying to @Ada: .*\]\(<https:\/\/discord\.com\/channels\/[^>]+>\)$/);
  });

  test("the quote shows the name the conversation shows, not the staff member behind it", async () => {
    const w = setup({ general: { replies: { identity: "team", teamName: "Northwind Support" } } });
    const { row, channel: ch } = await open(w);
    await store(row.id, { authorName: "Grace", authorId: grace.id, authorIsStaff: true, sentAs: JSON.stringify({ name: "Northwind Support", avatarUrl: null, staffLine: false }) });
    await replyToTicket(w.ctx, row.id, "Following up", actor, [], [], TARGET);
    assert.match(String(ch.webhookSent[0]!.content), /^-# ↩ \[replying to @Northwind Support: /);
    assert.equal(ch.webhookSent[0]!.username, "Northwind Support");
  });

  test("a long original is cut to 80 characters in the quote", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    await store(row.id, { content: "word ".repeat(60) });
    await replyToTicket(w.ctx, row.id, "ok", actor, [], [], TARGET);
    const snippet = /replying to @Ada: (.*)\]\(/.exec(String(ch.webhookSent[0]!.content))![1]!;
    assert.ok(snippet.length <= 80);
    assert.ok(snippet.endsWith("…"));
  });

  test("the quote leaves room, so a long reply still fits in two messages", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    await store(row.id);
    await replyToTicket(w.ctx, row.id, "x".repeat(1990), actor, [], [], TARGET);
    assert.equal(ch.webhookSent.length, 2);
    assert.ok(ch.webhookSent.every((message) => String(message.content).length <= 2000));
  });

  test("sent as the bot it is a real reply that does not ping the author", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    await store(row.id);
    ch.webhooks = "denied";
    const result = await replyToTicket(w.ctx, row.id, "Try a reset", actor, [], [], TARGET);
    assert.equal(result.delivery, "bot");
    const options = ch.sent.at(-1)!.options as { content: string; reply?: { messageReference: string }; allowedMentions: { repliedUser?: boolean } };
    assert.equal(options.reply?.messageReference, TARGET);
    assert.equal(options.allowedMentions.repliedUser, false);
    assert.ok(!options.content.includes("↩"));
  });

  test("a message that is not in this ticket, or was deleted, is refused and nothing is posted", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    await assert.rejects(() => replyToTicket(w.ctx, row.id, "hi", actor, [], [], TARGET), /not in this ticket/);
    await store(row.id, { deletedAt: new Date() });
    await assert.rejects(() => replyToTicket(w.ctx, row.id, "hi", actor, [], [], TARGET), /deleted/);
    await assert.rejects(() => replyToTicket(w.ctx, row.id, "hi", actor, [], [], "not-an-id"), /could not be read/);
    assert.equal(ch.webhookSent.length, 0);
  });

  test("a message of another ticket cannot be answered", async () => {
    const w = setup();
    const first = await open(w);
    await mod.default.modals!.subject!(interaction(linus, { fields: { q0: "Second" } }) as never, { rest: "main:support", ctx: w.ctx });
    const other = await prisma.ticket.findFirstOrThrow({ where: { openerId: linus.id } });
    assert.notEqual(other.id, first.row.id);
    await store(other.id);
    await assert.rejects(() => replyToTicket(w.ctx, first.row.id, "hi", actor, [], [], TARGET), /not in this ticket/);
  });

  test("a reply without one reads and posts as before", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    await replyToTicket(w.ctx, row.id, "Hello", actor);
    assert.equal(ch.webhookSent[0]!.content, "Hello");
    assert.equal((await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId: row.id, source: "dashboard" } })).replyToId, null);
  });
});
