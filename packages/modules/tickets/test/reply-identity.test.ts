import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { emptyEmbed } from "@tier0/core";
import { grace, mod, open, prisma, setup } from "./ticket-world.ts";

const { replyToTicket } = mod;

describe("a dashboard reply under the team's name", () => {
  const actor = { userId: grace.id, name: "Grace", avatarUrl: "https://cdn.example/grace.png" };
  const team = (over: Record<string, unknown> = {}) => ({ general: { replies: { identity: "team", teamName: "Northwind Support", ...over } } });

  test("old settings load as before: the staff member, with a team name ready for when it is switched on", () => {
    const w = setup();
    const replies = (w.ctx.settings as { general: { replies: Record<string, unknown> } }).general.replies;
    assert.equal(replies.identity, "staff");
    assert.equal(replies.teamName, "Support Team");
    assert.equal(replies.showStaffName, false);
  });

  test("the webhook carries the team's name and picture, and the row keeps the real sender", async () => {
    const w = setup(team({ teamAvatar: "https://cdn.example/team.png" }));
    const { row, channel: ch } = await open(w);
    const result = await replyToTicket(w.ctx, row.id, "On it", actor);
    const sent = ch.webhookSent[0]!;
    assert.equal(sent.username, "Northwind Support");
    assert.equal(sent.avatarURL, "https://cdn.example/team.png");
    assert.equal(sent.content, "On it");
    const stored = await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId: row.id, source: "dashboard" } });
    assert.equal(stored.authorId, grace.id);
    assert.equal(stored.authorName, "Grace");
    assert.equal(stored.authorBot, true);
    assert.deepEqual(JSON.parse(stored.sentAs!), { name: "Northwind Support", avatarUrl: "https://cdn.example/team.png", staffLine: false });
    assert.equal(result.message.author.name, "Northwind Support");
    assert.deepEqual(result.message.sentBy, { userId: grace.id, name: "Grace" });
  });

  test("without a picture set it falls back to the bot's", async () => {
    const w = setup(team());
    const { row, channel: ch } = await open(w);
    await replyToTicket(w.ctx, row.id, "On it", actor);
    assert.match(String(ch.webhookSent[0]!.avatarURL), /cdn\.example\/.+\.png/);
  });

  test("the staff member's own settings send what they always did, with no sender mark", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    const result = await replyToTicket(w.ctx, row.id, "On it", actor);
    assert.equal(ch.webhookSent[0]!.username, "Grace");
    assert.equal(result.message.sentBy, undefined);
    assert.equal((await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId: row.id, source: "dashboard" } })).sentAs, null);
  });

  test("the line naming who replied ends the message without pinging, and the row keeps the text without it", async () => {
    const w = setup(team({ showStaffName: true }));
    const { row, channel: ch } = await open(w);
    const result = await replyToTicket(w.ctx, row.id, "On it @everyone", actor);
    assert.equal(ch.webhookSent[0]!.content, "On it @everyone\n-# Replied by Grace");
    assert.deepEqual((ch.webhookSent[0]!.allowedMentions as { parse: string[] }).parse, []);
    const stored = await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId: row.id, source: "dashboard" } });
    assert.equal(stored.content, "On it @everyone");
    assert.equal(JSON.parse(stored.sentAs!).staffLine, true);
    assert.equal(result.message.staffLine, true);
  });

  test("the line goes in a message of its own when it does not fit", async () => {
    const w = setup(team({ showStaffName: true }));
    const { row, channel: ch } = await open(w);
    await replyToTicket(w.ctx, row.id, "x".repeat(1990), actor);
    assert.deepEqual(ch.webhookSent.map((m) => String(m.content).length), [1990, 19]);
    assert.equal(ch.webhookSent[1]!.content, "-# Replied by Grace");
    const stored = await prisma.ticketMessage.findMany({ where: { ticketId: row.id, source: "dashboard" }, orderBy: { id: "asc" } });
    assert.deepEqual(stored.map((m) => [m.content.length, JSON.parse(m.sentAs!).staffLine]), [[1990, false], [0, true]]);
  });

  test("sent as the bot, the team's name is the bold first line and the line still closes it", async () => {
    const w = setup(team({ showStaffName: true }));
    const { row, channel: ch } = await open(w);
    ch.webhooks = "denied";
    const result = await replyToTicket(w.ctx, row.id, "On it", actor);
    assert.equal(result.delivery, "bot");
    assert.equal((ch.sent.at(-1)!.options as { content: string }).content, "**Northwind Support**\nOn it\n-# Replied by Grace");
    const stored = await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId: row.id, source: "dashboard" } });
    assert.equal(stored.authorId, grace.id);
    assert.equal(stored.content, "On it");
    assert.equal(JSON.parse(stored.sentAs!).name, "Northwind Support");
  });
});

describe("a dashboard reply with embeds", () => {
  const actor = { userId: grace.id, name: "Grace", avatarUrl: null };
  const embed = (over: Record<string, unknown> = {}) => ({
    ...emptyEmbed(),
    title: "Refund steps",
    description: "Open **Billing**, then Refunds.",
    color: "#5865f2",
    authorName: "Billing",
    footerText: "Ticket reply",
    thumbnailUrl: "https://cdn.example/t.png",
    imageUrl: "https://cdn.example/i.png",
    fields: [{ name: "Time", value: "2 days", inline: true }],
    ...over,
  });

  test("go through the webhook as Discord's embeds and are stored whole", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    const result = await replyToTicket(w.ctx, row.id, "", actor, [], [embed()]);
    const sent = ch.webhookSent[0] as { content: string; embeds: Record<string, unknown>[] };
    assert.equal(sent.content, "");
    assert.deepEqual(sent.embeds, [
      {
        title: "Refund steps",
        description: "Open **Billing**, then Refunds.",
        color: 0x5865f2,
        author: { name: "Billing" },
        footer: { text: "Ticket reply" },
        image: { url: "https://cdn.example/i.png" },
        thumbnail: { url: "https://cdn.example/t.png" },
        fields: [{ name: "Time", value: "2 days", inline: true }],
      },
    ]);
    const stored = await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId: row.id, source: "dashboard" } });
    const kept = JSON.parse(stored.embeds)[0];
    assert.equal(kept.title, "Refund steps");
    assert.equal(kept.color, 0x5865f2);
    assert.equal(kept.author.name, "Billing");
    assert.equal(kept.imageUrl, "https://cdn.example/i.png");
    assert.equal(kept.footer.text, "Ticket reply");
    assert.equal(result.message.embeds[0]?.fields[0]?.name, "Time");
  });

  test("go with the bot when there is no webhook, and carry the team's name too", async () => {
    const w = setup({ general: { replies: { identity: "team", teamName: "Northwind Support" } } });
    const { row, channel: ch } = await open(w);
    ch.webhooks = "denied";
    await replyToTicket(w.ctx, row.id, "See below", actor, [], [embed(), embed({ title: "Second" })]);
    const options = ch.sent.at(-1)!.options as { content: string; embeds: unknown[] };
    assert.equal(options.content, "**Northwind Support**\nSee below");
    assert.equal(options.embeds.length, 2);
    assert.equal(JSON.parse((await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId: row.id, source: "dashboard" } })).embeds).length, 2);
  });

  test("only the first message of a long reply carries them", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    ch.webhooks = "denied";
    await replyToTicket(w.ctx, row.id, `${"word ".repeat(399)}last`, actor, [], [embed()]);
    const [first, second] = ch.sent.slice(-2).map((m) => (m.options as { embeds?: unknown[] }).embeds);
    assert.equal(first?.length, 1);
    assert.equal(second, undefined);
  });

  test("an embed Discord would refuse, or more than three, is refused before anything is posted", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    const before = ch.webhookSent.length + ch.sent.length;
    await assert.rejects(replyToTicket(w.ctx, row.id, "", actor, [], [embed({ imageUrl: "javascript:alert(1)" })]), /web address/);
    await assert.rejects(replyToTicket(w.ctx, row.id, "", actor, [], [embed(), embed(), embed(), embed()]), /at most 3 embeds/);
    assert.equal(ch.webhookSent.length + ch.sent.length, before);
  });

  test("a time of now is the moment it was sent", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    await replyToTicket(w.ctx, row.id, "", actor, [], [embed({ timestamp: "now" })]);
    const stamp = String((ch.webhookSent[0]!.embeds as { timestamp?: string }[])[0]!.timestamp);
    assert.ok(Math.abs(Date.parse(stamp) - Date.now()) < 60_000);
  });
});
