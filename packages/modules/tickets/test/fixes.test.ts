import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BILLING, CAT, HANDLER, PANEL_CHANNEL, ada, grace, linus, mod, open, prisma, refusalText, setup, staffArrive, tickets } from "./ticket-world.ts";
import { GUILD, interaction, member, message, user, type World } from "./fake-discord.ts";

const { TicketActionError } = mod;
const actor = { userId: grace.id, name: "Grace", avatarUrl: null };
const submit = (w: World, answer = "x") =>
  tickets.modals!.subject!(interaction(ada, { fields: { q0: answer } }) as never, { rest: "main:support", ctx: w.ctx });

describe("opening twice at once", () => {
  test("two forms sent together open one ticket, and the second hears the limit", async () => {
    const w = setup({}, { rules: {} });
    await Promise.all([submit(w, "first"), submit(w, "second")]);
    assert.equal(await prisma.ticket.count({ where: { openerId: ada.id } }), 1);
    assert.equal(w.created.length, 1);
    assert.ok(w.replies.some((r) => /already have an open ticket/.test(r.body.embeds[0]?.description ?? "")));
  });

  test("forms sent together inside a cooldown open one ticket, even under a higher limit", async () => {
    const w = setup({ general: { ticketLimit: 5 } });
    await Promise.all([submit(w), submit(w), submit(w)]);
    assert.equal(await prisma.ticket.count({ where: { openerId: ada.id } }), 1);
  });

  test("a channel Discord refuses leaves no row and no cooldown behind", async () => {
    const w = setup();
    (w.ctx as unknown as { guild: { channels: { create: () => Promise<never> } } }).guild.channels.create = async () => {
      throw new Error("Missing Permissions");
    };
    await submit(w);
    assert.equal(await prisma.ticket.count(), 0);
    assert.equal(await prisma.ticketCooldown.count(), 0);
    // The category was there, so the member hears that creating the channel failed, not that no category is set.
    assert.match(refusalText(w) ?? "", /Something went wrong creating your ticket channel/);
  });
});

describe("who the first message pings when a member opens a ticket", () => {
  const welcomeMentions = (w: World) => (w.sent[0]?.options.mentions ?? {}) as { users?: string[]; roles?: string[] };

  test("in a channel the opener is pinged, since nothing else told them", async () => {
    const w = setup();
    await submit(w);
    assert.deepEqual(welcomeMentions(w).users, [ada.id]);
  });

  test("in a thread the opener is not pinged again, since being added to it already told them", async () => {
    const w = setup({}, { opening: { mode: "thread" } });
    await submit(w);
    assert.deepEqual(welcomeMentions(w).users, []);
  });

  test("in a thread the line above the message no longer names the opener, only the roles to ping", async () => {
    const w = setup({}, { opening: { mode: "thread" } });
    await submit(w);
    assert.equal(w.sent[0]?.body.content, "{pingRoles}");
  });

  test("in a thread the embed still says who opened it", async () => {
    const w = setup({}, { opening: { mode: "thread" } });
    await submit(w);
    assert.match(w.sent[0]?.body.embeds[0]?.description ?? "", /Opened by \{user\}/);
  });

  test("in a channel the line above the embed still names the opener", async () => {
    const w = setup();
    await submit(w);
    assert.equal(w.sent[0]?.body.content, "{user} {pingRoles}");
  });
});

describe("access after a change of hands", () => {
  test("a thread moved to another type swaps the old handlers for the new ones", async () => {
    const w = setup({}, { opening: { mode: "thread" } });
    const billing = w.addMember(member(user("130000000000000009", "bill"), [BILLING]));
    const { row, channel: thread } = await open(w);
    await staffArrive(w, thread);
    assert.ok(thread.members.cache.has(grace.id));
    await mod.transferTicket(w.ctx, row.id, { typeId: "billing" }, actor);
    assert.ok(!thread.members.cache.has(grace.id), "the old handler is gone");
    assert.ok(thread.members.cache.has(billing.id), "the new handler is in");
    assert.ok(thread.members.cache.has(ada.id), "the opener stays");
  });

  test("with the claim lock, unclaiming and moving take away the claimer's own overwrite", async () => {
    const w = setup({ general: { claimLock: true } });
    const { row, channel: ch } = await open(w);
    await mod.claimTicket(w.ctx, row.id, actor);
    assert.ok(ch.permissionOverwrites.cache.has(grace.id));
    assert.equal(ch.permissionOverwrites.cache.get(HANDLER)?.edits.SendMessages, false);
    await mod.unclaimTicket(w.ctx, row.id, actor);
    assert.ok(!ch.permissionOverwrites.cache.has(grace.id));
    assert.equal(ch.permissionOverwrites.cache.get(HANDLER)?.edits.SendMessages, true);

    await mod.claimTicket(w.ctx, row.id, actor);
    await mod.transferTicket(w.ctx, row.id, { typeId: "billing" }, actor);
    assert.ok(!ch.permissionOverwrites.cache.has(grace.id));
  });

  test("handlers and the claimer are not listed as added members", async () => {
    const w = setup({}, { opening: { mode: "thread" } });
    const { row, channel: thread } = await open(w);
    thread.members.cache.set(linus.id, {});
    await mod.claimTicket(w.ctx, row.id, actor);
    const detail = await mod.getTicketDetail(w.ctx, row.id);
    assert.deepEqual(detail?.members.filter((m) => m.access === "added"), []);
  });
});

describe("a panel from before panels were recorded", () => {
  test("reads as posted somewhere unknown, and posting it says the old one is still up", async () => {
    const w = setup({ panels: undefined, category: CAT, supportRoles: [HANDLER], panel: { channel: PANEL_CHANNEL } });
    // What the migration writes for a server that used the version before panels were tracked.
    await prisma.ticketPanelPost.create({ data: { guildId: GUILD, panelId: "default", channelId: PANEL_CHANNEL, messageId: "" } });
    const [status] = await mod.panelStatuses(w.ctx);
    assert.equal(status?.panelId, "default");
    assert.equal(status?.legacy, true);
    assert.equal(status?.posted, false);
    assert.equal((await mod.ticketHealthFacts(w.ctx)).panels[0]?.legacy, true);

    assert.equal((await mod.postPanel(w.ctx, "default", actor)).legacyMessageLeft, true);
    assert.equal((await mod.postPanel(w.ctx, "default", actor)).legacyMessageLeft, false);
    assert.equal((await mod.panelStatuses(w.ctx))[0]?.legacy, false);

    await prisma.ticketPanelPost.deleteMany();
    await prisma.ticketPanelPost.create({ data: { guildId: GUILD, panelId: "default", channelId: PANEL_CHANNEL, messageId: "" } });
    await tickets.commands![0]!.run(interaction(grace, { roles: [HANDLER], sub: "panel", component: false }) as never, w.ctx);
    assert.match(refusalText(w) ?? "", /older version of the bot posted is still up/);
  });
});

describe("a panel from before panels were recorded, on a database the migration did not backfill", () => {
  test("is read as the old panel when its tickets carry the default panel", async () => {
    const w = setup({ panels: undefined, category: CAT, supportRoles: [HANDLER], panel: { channel: PANEL_CHANNEL } });
    await prisma.ticketPanelPost.deleteMany();
    await prisma.ticket.create({ data: { guildId: GUILD, channelId: "700000000000000001", openerId: ada.id, typeId: "support", panelId: "default", typeName: "Support" } });
    const [status] = await mod.panelStatuses(w.ctx);
    assert.equal(status?.legacy, true);
    assert.equal((await mod.postPanel(w.ctx, "default", actor)).legacyMessageLeft, true);
    assert.equal((await mod.panelStatuses(w.ctx))[0]?.legacy, false, "posting it leaves a record");
    await prisma.ticket.deleteMany();
  });

  test("is not read as the old panel on a server that never opened a ticket from it", async () => {
    const w = setup({ panels: undefined, category: CAT, supportRoles: [HANDLER], panel: { channel: PANEL_CHANNEL } });
    await prisma.ticketPanelPost.deleteMany();
    await prisma.ticket.deleteMany();
    assert.equal((await mod.panelStatuses(w.ctx))[0]?.legacy, false);
  });
});

describe("a ticket that closed meanwhile", () => {
  test("is not changed, and its channel is not treated as an open ticket again", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    await prisma.ticket.update({ where: { id: row.id }, data: { status: "closed" } });
    const working = await import("../dist/working.js");
    const outcomes = [
      await working.setPriority(w.ctx, row, "high", actor),
      await working.transfer(w.ctx, row, "billing", actor),
      await working.rename(w.ctx, row, "new-name", actor),
      await working.requestClose(w.ctx, row, null, actor),
      await working.keepOpen(w.ctx, row, actor),
    ];
    assert.deepEqual(outcomes.map((o) => o.ok), [false, false, false, false, false]);
    const now = await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(now.typeId, "support");
    assert.equal(now.priority, "normal");
    assert.equal(now.closeRequestedAt, null);

    mod.forgetOpenTickets();
    const before = await prisma.ticketMessage.count();
    await tickets.events!.messageCreate!(message(ch.id, ada, "after close") as never, w.ctx);
    assert.equal(await prisma.ticketMessage.count(), before);
  });
});

describe("the open ticket list in memory", () => {
  test("keeps an open or a close that happens while the server's list is being read", async () => {
    const cache = await import("../dist/cache.js");
    const ID = "140000000000000001";
    cache.forgetOpenTickets();
    const reading = cache.openTicketIn(GUILD, "nothing-here");
    cache.rememberOpenTicket(GUILD, ID, { id: 1, openerId: ada.id, typeId: null, panelId: null });
    await reading;
    assert.ok(await cache.openTicketIn(GUILD, ID));

    cache.forgetOpenTickets();
    const again = cache.openTicketIn(GUILD, "nothing-here");
    cache.forgetOpenTicket(GUILD, ID);
    await again;
    assert.equal(await cache.openTicketIn(GUILD, ID), undefined);
  });
});

describe("closing", () => {
  test("from the dashboard needs a reason when the type wants one", async () => {
    const w = setup({}, { rules: { requireReason: true } });
    const { row } = await open(w);
    await assert.rejects(mod.closeTicketAs(w.ctx, row.id, {}, actor), (error: unknown) => {
      assert.ok(error instanceof TicketActionError);
      assert.equal(error.code, "invalid");
      assert.match(error.message, /need a reason/);
      return true;
    });
    assert.equal((await mod.closeTicketAs(w.ctx, row.id, { reason: "Done" }, actor)).ticket.closeReason, "Done");
  });

  test("posts the closing message only for the close that went through", async () => {
    const w = setup({ automation: { autoClose: { enabled: true, notice: true } } });
    const { row, channel: ch } = await open(w);
    const closings = () => ch.sent.filter((m) => /Closing this ticket/.test(m.body?.embeds[0]?.description ?? "")).length;
    await mod.closeTicketAs(w.ctx, row.id, {}, actor);
    assert.equal(closings(), 1);
    await tickets.tasks!.autoclose!({ channelId: ch.id }, w.ctx);
    const press = interaction(ada, { channelId: ch.id });
    await tickets.components!.close!(press as never, { rest: String(row.id), ctx: w.ctx });
    assert.equal(closings(), 1);
    assert.equal(w.replies.filter((r) => r.options.ephemeral === false).length, 0);
    assert.match(refusalText(w) ?? "", /already closed/);
  });

  test("a kept channel is marked kept in the same update that closes it", async () => {
    const w = setup({ general: { closeBehaviour: "archive" } });
    const { row, channel: ch } = await open(w);
    ch.permissionOverwrites.edit = async () => {
      throw new Error("Missing Permissions");
    };
    await mod.closeTicketAs(w.ctx, row.id, {}, actor);
    const closed = await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(closed.status, "closed");
    assert.equal(closed.archived, true);
  });
});

describe("members and replies", () => {
  test("adding someone who is not in the server says so", async () => {
    const w = setup();
    const { row } = await open(w);
    await assert.rejects(mod.changeTicketMember(w.ctx, row.id, { userId: "130000000000000077", action: "add" }, actor), /isn't in this server/);
  });

  test("a long reply sent as the bot is split, and each part is stored as sent", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    ch.webhooks = "denied";
    const content = `${"word ".repeat(399)}last`;
    const result = await mod.replyToTicket(w.ctx, row.id, content, actor);
    assert.equal(result.delivery, "bot");
    const sent = ch.sent.slice(-2).map((m) => (m.options as { content: string }).content);
    assert.ok(sent.every((text) => text.length <= 2000));
    assert.ok(sent[0]!.startsWith("**Grace**\n"));
    const stored = await prisma.ticketMessage.findMany({ where: { ticketId: row.id, source: "dashboard" }, orderBy: { id: "asc" } });
    assert.equal(stored.length, 2);
    assert.equal(stored.map((m) => m.content).join(" "), content);
  });
});

describe("the inactivity close", () => {
  test("is pushed back by moving the one pending task, not by cancelling and adding", async () => {
    const w = setup({ automation: { autoClose: { enabled: true, after: "2h" } } });
    const { channel: ch } = await open(w);
    await tickets.events!.messageCreate!(message(ch.id, ada, "one") as never, w.ctx);
    await tickets.events!.messageCreate!(message(ch.id, ada, "two") as never, w.ctx);
    assert.equal(w.scheduled.filter((t) => t.kind === "autoclose").length, 1);
    assert.equal(w.cancelled.filter((c) => c.kind === "autoclose").length, 0);
  });
});
