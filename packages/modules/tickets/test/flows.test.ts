import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN,
  BILLING,
  BILLING_CAT,
  CAT,
  CLOSED_CAT,
  HANDLER,
  LOG,
  OBSERVER,
  OVERFLOW,
  PANEL_CHANNEL,
  ada,
  grace,
  handlerPress,
  linus,
  mallory,
  mod,
  open,
  prisma,
  refusalText,
  setup,
  staffArrive,
  tickets,
} from "./ticket-world.ts";
import { BOT, GUILD, channel, interaction, message, snowflake } from "./fake-discord.ts";

const { claimTicket, replyToTicket, postPanel, panelStatuses, ticketHealthFacts, TicketActionError } = mod;
describe("opening a ticket", () => {
  test("from the form creates the channel, the row and the first message with the answers", async () => {
    const w = setup({ automation: { autoClose: { enabled: true }, reminder: { enabled: true } } });
    const { row, channel: created } = await open(w);

    assert.equal(row.typeId, "support");
    assert.equal(row.panelId, "main");
    assert.equal(row.typeName, "Support");
    assert.equal(row.subject, "Cannot log in");
    assert.deepEqual(JSON.parse(row.answers), [{ label: "What happened?", value: "Cannot log in" }]);
    assert.equal(created.parentId, CAT);

    const overwrites = w.created[0]?.permissionOverwrites as { id: string; deny?: unknown; allow?: unknown }[];
    assert.deepEqual(
      overwrites.map((o) => o.id).sort(),
      [GUILD, ada.id, HANDLER, ADMIN, OBSERVER, BOT].sort(),
    );
    assert.ok(overwrites.find((o) => o.id === GUILD)?.deny, "everyone is denied");

    const welcome = w.sent.find((s) => s.target === created);
    assert.ok(welcome);
    assert.deepEqual(welcome.body.embeds[0]?.fields.map((f) => [f.name, f.value]), [["What happened?", "Cannot log in"]]);
    assert.deepEqual(welcome.options.mentions, { users: [ada.id], roles: [HANDLER] });
    const buttons = (welcome.options.rows as { toJSON(): { components: { label: string; custom_id: string }[] } }[])[0]!.toJSON().components;
    assert.deepEqual(buttons.map((b) => b.label), ["Close ticket", "Claim"]);
    assert.equal(row.controlsMessageId, welcome.message?.id);

    const events = await prisma.ticketEvent.findMany({ where: { ticketId: row.id } });
    assert.deepEqual(events.map((e) => e.kind), ["opened"]);
    assert.ok(w.scheduled.some((t) => t.kind === "autoclose"));
    assert.ok(w.scheduled.some((t) => t.kind === "reminder" && t.payload.ticketId === row.id));
    assert.ok(await prisma.ticketCooldown.findFirst({ where: { userId: ada.id, typeId: "support" } }));
    assert.equal(w.replies.at(-1)?.values.number, row.id);
  });

  test("a channel Discord refuses is created again with fewer permissions", async () => {
    const w = setup({}, {}, { refuseCreates: 1 });
    const { row, channel: created } = await open(w);

    assert.equal(w.created.length, 2, "the second attempt succeeded");
    assert.ok(row.channelId === created.id);
    const bits = (attempt: number) =>
      (w.created[attempt]?.permissionOverwrites as { id: string; allow?: bigint | bigint[] }[]).find((o) => o.id === HANDLER)?.allow;
    assert.notDeepEqual(bits(0), bits(1), "the retry asks for less than the first try");
  });

  test("a member is told when even the smallest set of permissions is refused", async () => {
    const w = setup({}, {}, { refuseCreates: 3 });
    await open(w).catch(() => undefined);

    assert.equal(w.created.length, 3);
    assert.equal(await prisma.ticket.count({ where: { channelId: { startsWith: "pending" } } }), 0);
  });

  test("a blocked member is told so before anything else", async () => {
    const w = setup();
    await tickets.components!.open!(interaction(mallory) as never, { rest: "main:support", ctx: w.ctx });
    assert.match(refusalText(w) ?? "", /can't open tickets on this server/);
    assert.equal(w.created.length, 0);
  });

  test("a type limited to some roles refuses everyone else", async () => {
    const w = setup();
    await tickets.components!.open!(interaction(ada) as never, { rest: "main:billing", ctx: w.ctx });
    assert.equal(w.replies.at(-1)?.values.type, "Billing");
    assert.match(refusalText(w) ?? "", /don't have a role that can open/);
  });

  test("a second ticket inside the cooldown is refused with when it is allowed", async () => {
    const w = setup({ general: { ticketLimit: 3 } });
    await open(w);
    await tickets.components!.open!(interaction(ada) as never, { rest: "main:support", ctx: w.ctx });
    assert.equal(w.replies.at(-1)?.values.type, "Support");
    assert.match(String(w.replies.at(-1)?.values.available), /^<t:\d+:R>$/);
  });

  test("the limit counts tickets of the same type only", async () => {
    const w = setup({}, { rules: {} });
    await open(w);
    await tickets.components!.open!(interaction(ada) as never, { rest: "main:support", ctx: w.ctx });
    assert.match(refusalText(w) ?? "", /already have an open ticket/);
  });

  test("a full category sends the ticket to the overflow category", async () => {
    const w = setup();
    for (let i = 0; i < 50; i++) w.add(channel(snowflake(), { parentId: CAT }));
    const { channel: created } = await open(w);
    assert.equal(created.parentId, OVERFLOW);
  });

  test("with both categories full the member is told the category is full", async () => {
    const w = setup();
    for (let i = 0; i < 50; i++) w.add(channel(snowflake(), { parentId: CAT }));
    for (let i = 0; i < 50; i++) w.add(channel(snowflake(), { parentId: OVERFLOW }));
    await tickets.components!.open!(interaction(ada) as never, { rest: "main:support", ctx: w.ctx });
    assert.match(refusalText(w) ?? "", /category is full/);
  });

  test("a thread type opens a private thread under the panel channel and adds the opener and handlers", async () => {
    const w = setup({}, { opening: { mode: "thread" } });
    const { row, channel: thread } = await open(w);
    await staffArrive(w, thread);
    assert.equal(row.mode, "thread");
    assert.equal(thread.parentId, PANEL_CHANNEL);
    assert.ok(thread.members.cache.has(ada.id));
    assert.ok(thread.members.cache.has(grace.id));
    assert.equal(w.created.length, 0, "no channel is created");
  });
});

describe("claiming", () => {
  test("a handler claims, the timeline records it and the button turns into Unclaim", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    await tickets.components!.claim!(handlerPress() as never, { rest: String(row.id), ctx: w.ctx });
    const claimed = await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(claimed.claimedById, grace.id);
    assert.ok((await prisma.ticketEvent.findMany({ where: { ticketId: row.id } })).some((e) => e.kind === "claimed"));
    assert.equal(w.replies.at(-1)?.options.ephemeral, false);
    const welcome = ch.sent.find((m) => m.id === claimed.controlsMessageId)!;
    const rows = welcome.options?.rows as { toJSON(): { components: { label: string }[] } }[];
    assert.equal(rows[0]!.toJSON().components[1]?.label, "Unclaim");
    assert.equal(welcome.values?.claimedBy, `<@${grace.id}>`);
  });

  test("another handler cannot take it over or drop it, an admin can", async () => {
    const w = setup();
    const { row } = await open(w);
    await tickets.components!.claim!(handlerPress() as never, { rest: String(row.id), ctx: w.ctx });
    await tickets.components!.claim!(handlerPress(linus) as never, { rest: String(row.id), ctx: w.ctx });
    assert.match(refusalText(w) ?? "", /already handling/);
    await tickets.components!.unclaim!(handlerPress(linus) as never, { rest: String(row.id), ctx: w.ctx });
    assert.match(refusalText(w) ?? "", /Only they or an admin/);
    await tickets.components!.unclaim!(interaction(linus, { roles: [ADMIN] }) as never, { rest: String(row.id), ctx: w.ctx });
    assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } })).claimedById, null);
  });

  test("a member who is not staff cannot claim", async () => {
    const w = setup();
    const { row } = await open(w);
    await tickets.components!.claim!(interaction(ada) as never, { rest: String(row.id), ctx: w.ctx });
    assert.match(refusalText(w) ?? "", /support role/);
  });

  test("from the dashboard returns the ticket and refuses a ticket from another server", async () => {
    const w = setup();
    const { row } = await open(w);
    const result = await claimTicket(w.ctx, row.id, { userId: grace.id, name: "grace", avatarUrl: null });
    assert.equal(result.ticket.claimedBy?.userId, grace.id);
    assert.equal(result.ticket.typeName, "Support");
    await assert.rejects(claimTicket(w.ctx, 999999, { userId: grace.id, name: "grace", avatarUrl: null }), (error: unknown) => {
      assert.ok(error instanceof TicketActionError);
      assert.equal(error.code, "notFound");
      return true;
    });
    await assert.rejects(claimTicket(w.ctx, row.id, { userId: grace.id, name: "grace", avatarUrl: null }), /claimed this ticket first/);
  });
});

describe("closing", () => {
  test("with delete removes the channel and posts the transcript built from the stored messages", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    await tickets.events!.messageCreate!(message(ch.id, ada, "hello?") as never, w.ctx);
    await tickets.components!.close!(interaction(ada, { channelId: ch.id }) as never, { rest: String(row.id), ctx: w.ctx });

    const closed = await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(closed.status, "closed");
    assert.equal(closed.archived, false);
    assert.equal(ch.deleted.length, 1);
    const log = w.sent.find((s) => (s.target as { id: string }).id === LOG);
    assert.ok(log, "the transcript went to the log channel");
    const file = (log.options.files as { attachment: Buffer }[])[0]!;
    assert.match(file.attachment.toString("utf8"), /hello\?/);
    assert.ok((await prisma.ticketEvent.findMany({ where: { ticketId: row.id } })).some((e) => e.kind === "closed"));
  });

  test("twice is refused the second time", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    await tickets.components!.close!(interaction(ada, { channelId: ch.id }) as never, { rest: String(row.id), ctx: w.ctx });
    await tickets.components!.close!(interaction(ada, { channelId: ch.id }) as never, { rest: String(row.id), ctx: w.ctx });
    assert.match(refusalText(w) ?? "", /already closed/);
  });

  test("a type that wants a reason asks for one in a form", async () => {
    const w = setup({}, { rules: { requireReason: true, cooldown: "1h" } });
    const { row, channel: ch } = await open(w);
    const press = interaction(ada, { channelId: ch.id });
    await tickets.components!.close!(press as never, { rest: String(row.id), ctx: w.ctx });
    assert.equal((press.modals[0] as { custom_id: string }).custom_id, `tickets:closeReason:${row.id}`);
    await tickets.modals!.closeReason!(interaction(ada, { channelId: ch.id, fields: { reason: "Fixed it" } }) as never, { rest: String(row.id), ctx: w.ctx });
    assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } })).closeReason, "Fixed it");
  });

  test("with archive locks and moves the channel, and it can be reopened", async () => {
    const w = setup({ general: { closeBehaviour: "archive", closedCategory: CLOSED_CAT, archiveDays: 3 } });
    const { row, channel: ch } = await open(w);
    await tickets.components!.close!(interaction(ada, { channelId: ch.id }) as never, { rest: String(row.id), ctx: w.ctx });

    const closed = await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(closed.status, "closed");
    assert.equal(closed.archived, true);
    assert.equal(ch.deleted.length, 0);
    assert.equal(ch.parentId, CLOSED_CAT);
    assert.equal(ch.permissionOverwrites.cache.get(ada.id)?.edits.SendMessages, false);
    assert.ok(w.scheduled.some((t) => t.kind === "deleteArchived" && t.payload.ticketId === row.id));
    const notice = w.sent.filter((s) => s.target === ch).at(-1)!;
    const labels = (notice.options.rows as { toJSON(): { components: { label: string }[] } }[])[0]!.toJSON().components.map((c) => c.label);
    assert.deepEqual(labels, ["Reopen", "Delete ticket"]);

    await tickets.components!.reopen!(handlerPress(grace, ch.id) as never, { rest: String(row.id), ctx: w.ctx });
    const reopened = await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(reopened.status, "open");
    assert.equal(reopened.archived, false);
    assert.equal(reopened.reopenedCount, 1);
    assert.equal(ch.parentId, CAT);
    assert.equal(ch.permissionOverwrites.cache.get(ada.id)?.edits.SendMessages, true);
    assert.ok((await prisma.ticketEvent.findMany({ where: { ticketId: row.id } })).some((e) => e.kind === "reopened"));
  });

  test("the opener cannot reopen a type that leaves that to staff", async () => {
    const w = setup({ general: { closeBehaviour: "archive" } }, { rules: { reopenNeedsStaff: true, cooldown: "1h" } });
    const { row, channel: ch } = await open(w);
    await tickets.components!.close!(interaction(ada, { channelId: ch.id }) as never, { rest: String(row.id), ctx: w.ctx });
    await tickets.components!.reopen!(interaction(ada, { channelId: ch.id }) as never, { rest: String(row.id), ctx: w.ctx });
    assert.match(refusalText(w) ?? "", /staff needs to reopen/);
  });

  test("a deleted channel cannot be reopened", async () => {
    const w = setup({ general: { closeBehaviour: "archive" } });
    const { row, channel: ch } = await open(w);
    await prisma.ticket.update({ where: { id: row.id }, data: { status: "closed" } });
    await tickets.components!.reopen!(handlerPress(grace, ch.id) as never, { rest: String(row.id), ctx: w.ctx });
    assert.match(refusalText(w) ?? "", /deleted when it closed/);
  });
});

describe("a close request", () => {
  test("asks the opener, only the opener answers, and Keep open withdraws it", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    const ask = interaction(grace, { roles: [HANDLER], sub: "request-close", channelId: ch.id, strings: { reason: "Looks solved" }, component: false });
    await tickets.commands![0]!.run(ask as never, w.ctx);

    const requested = await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } });
    assert.ok(requested.closeRequestedAt);
    const task = w.scheduled.find((t) => t.kind === "closeRequest");
    assert.equal(task?.payload.ticketId, row.id);
    const post = w.sent.filter((s) => s.target === ch).at(-1)!;
    assert.deepEqual(post.options.mentions, { users: [ada.id], roles: [] });
    assert.equal(post.values.ending, ": Looks solved.");

    await tickets.components!.keepOpen!(interaction(grace, { roles: [HANDLER] }) as never, { rest: String(row.id), ctx: w.ctx });
    assert.match(refusalText(w) ?? "", /Only the member who opened/);
    await tickets.components!.keepOpen!(interaction(ada, { channelId: ch.id }) as never, { rest: String(row.id), ctx: w.ctx });
    assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } })).closeRequestedAt, null);
    assert.ok(w.cancelled.some((c) => c.kind === "closeRequest"));
  });

  test("closes the ticket when nobody answers in time", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    await tickets.commands![0]!.run(
      interaction(grace, { roles: [HANDLER], sub: "request-close", channelId: ch.id, component: false }) as never,
      w.ctx,
    );
    const task = w.scheduled.find((t) => t.kind === "closeRequest")!;
    await tickets.tasks!.closeRequest!(task.payload, w.ctx);
    assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } })).status, "closed");
  });

  test("a request that was replaced does not close the ticket", async () => {
    const w = setup();
    const { row } = await open(w);
    await prisma.ticket.update({ where: { id: row.id }, data: { closeRequestedAt: new Date() } });
    await tickets.tasks!.closeRequest!({ ticketId: row.id, requestedAt: new Date(0).toISOString() }, w.ctx);
    assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } })).status, "open");
  });
});

describe("a rating", () => {
  test("is asked for by direct message, stored once, and a comment can follow", async () => {
    const w = setup({ ratings: { enabled: true } });
    const { row, channel: ch } = await open(w);
    await tickets.components!.close!(interaction(ada, { channelId: ch.id }) as never, { rest: String(row.id), ctx: w.ctx });

    const dm = w.dms.get(ada.id)?.[0];
    assert.ok(dm, "the opener got a direct message");
    const buttons = (dm.options.rows as { toJSON(): { components: { custom_id: string }[] } }[])[0]!.toJSON().components;
    assert.equal(buttons.length, 5);
    assert.equal(buttons[4]?.custom_id, `tickets:rate:${GUILD}:${row.id}:5`);
    assert.deepEqual(tickets.directMessage, ["rate", "rateComment"]);

    const press = interaction(ada);
    await tickets.components!.rate!(press as never, { rest: `${GUILD}:${row.id}:4`, ctx: w.ctx });
    assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } })).rating, 4);
    assert.equal((press.modals[0] as { custom_id: string }).custom_id, `tickets:rateComment:${GUILD}:${row.id}`);

    await tickets.components!.rate!(interaction(ada) as never, { rest: `${GUILD}:${row.id}:1`, ctx: w.ctx });
    assert.match(refusalText(w) ?? "", /already rated/);
    await tickets.components!.rate!(interaction(grace) as never, { rest: `${GUILD}:${row.id}:1`, ctx: w.ctx });
    assert.match(refusalText(w) ?? "", /Only the member who opened/);

    await tickets.modals!.rateComment!(interaction(ada, { fields: { comment: "Quick, thanks" } }) as never, { rest: `${GUILD}:${row.id}`, ctx: w.ctx });
    const rated = await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(rated.rating, 4);
    assert.equal(rated.ratingComment, "Quick, thanks");
    assert.equal(w.replies.at(-1)?.values.rating, 4);
  });
});

describe("message capture", () => {
  test("stores each message, counts it, and sets the first response from staff only", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    await tickets.events!.messageCreate!(message(ch.id, ada, "still broken") as never, w.ctx);
    let now = await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(now.firstResponseAt, null, "the opener does not answer themselves");
    assert.equal(now.messageCount, 1);

    const reply = message(ch.id, grace, "On it", [HANDLER]);
    await tickets.events!.messageCreate!(reply as never, w.ctx);
    now = await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } });
    const first = now.firstResponseAt;
    assert.ok(first);
    assert.equal(now.messageCount, 2);

    await tickets.events!.messageCreate!(message(ch.id, linus, "Me too", [HANDLER]) as never, w.ctx);
    now = await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(now.firstResponseAt?.getTime(), first.getTime(), "a later reply leaves it alone");

    const stored = await prisma.ticketMessage.findUniqueOrThrow({ where: { ticketId_messageId: { ticketId: row.id, messageId: reply.id } } });
    assert.equal(stored.authorIsStaff, true);
    assert.equal(stored.authorName, "grace");
    assert.equal(stored.source, "discord");

    await tickets.events!.messageUpdate!({} as never, { ...reply, content: "On it now", editedAt: new Date() } as never, w.ctx);
    await tickets.events!.messageDelete!(reply as never, w.ctx);
    const changed = await prisma.ticketMessage.findUniqueOrThrow({ where: { ticketId_messageId: { ticketId: row.id, messageId: reply.id } } });
    assert.equal(changed.content, "On it now");
    assert.equal(changed.edits, 1);
    assert.ok(changed.deletedAt);
  });

  test("ignores messages outside tickets", async () => {
    const w = setup();
    await open(w);
    const before = await prisma.ticketMessage.count();
    await tickets.events!.messageCreate!(message(PANEL_CHANNEL, ada, "hi") as never, w.ctx);
    assert.equal(await prisma.ticketMessage.count(), before);
  });

  test("a message pushes the inactivity close back", async () => {
    const w = setup({ automation: { autoClose: { enabled: true, after: "2h" } } });
    const { channel: ch } = await open(w);
    w.scheduled.length = 0;
    await tickets.events!.messageCreate!(message(ch.id, ada, "bump") as never, w.ctx);
    const task = w.scheduled.find((t) => t.kind === "autoclose");
    assert.ok(task && task.at.getTime() > Date.now() + 60 * 60_000);
  });

  test("a message the bot missed is filled in when the ticket closes", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    ch.sent.push(message(ch.id, ada, "sent while offline"));
    await tickets.components!.close!(interaction(ada, { channelId: ch.id }) as never, { rest: String(row.id), ctx: w.ctx });
    const contents = (await prisma.ticketMessage.findMany({ where: { ticketId: row.id } })).map((m) => m.content);
    assert.ok(contents.includes("sent while offline"));
  });
});

describe("a transfer", () => {
  test("swaps the roles, moves the channel, drops the claim and pings the new handlers", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    await tickets.components!.claim!(handlerPress() as never, { rest: String(row.id), ctx: w.ctx });
    await tickets.commands![0]!.run(
      interaction(grace, { roles: [HANDLER], sub: "transfer", channelId: ch.id, strings: { type: "billing" }, component: false }) as never,
      w.ctx,
    );
    const moved = await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(moved.typeId, "billing");
    assert.equal(moved.typeName, "Billing");
    assert.equal(moved.claimedById, null);
    assert.equal(ch.parentId, BILLING_CAT);
    assert.ok(!ch.permissionOverwrites.cache.has(HANDLER));
    assert.ok(ch.permissionOverwrites.cache.has(BILLING));
    const event = (await prisma.ticketEvent.findMany({ where: { ticketId: row.id, kind: "transferred" } }))[0];
    assert.deepEqual(JSON.parse(event!.detail), { fromTypeId: "support", fromTypeName: "Support", toTypeId: "billing", toTypeName: "Billing" });
    assert.equal(w.replies.at(-1)?.values.handlers, `<@&${BILLING}>`);
  });

  test("to the type it already is is refused", async () => {
    const w = setup();
    const { channel: ch } = await open(w);
    await tickets.commands![0]!.run(
      interaction(grace, { roles: [HANDLER], sub: "transfer", channelId: ch.id, strings: { type: "Support" }, component: false }) as never,
      w.ctx,
    );
    assert.match(refusalText(w) ?? "", /already a \{type\} ticket/);
    assert.equal(w.replies.at(-1)?.values.type, "Support");
  });
});

describe("a dashboard reply", () => {
  const actor = { userId: grace.id, name: "Grace", avatarUrl: "https://cdn.example/grace.png" };

  test("goes out through a webhook under the staff member's name", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    const result = await replyToTicket(w.ctx, row.id, "Try again now @everyone", actor);
    assert.equal(result.delivery, "webhook");
    const sent = ch.webhookSent[0]!;
    assert.equal(sent.username, "Grace");
    assert.deepEqual((sent.allowedMentions as { parse: string[] }).parse, []);
    assert.equal(result.message.source, "dashboard");
    assert.equal(result.message.author.name, "Grace");
    assert.ok((await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } })).firstResponseAt);
  });

  test("without Manage Webhooks is sent by the bot with the name in bold", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    ch.webhooks = "denied";
    const result = await replyToTicket(w.ctx, row.id, "Try again now", actor);
    assert.equal(result.delivery, "bot");
    const last = ch.sent.at(-1)!;
    assert.equal((last.options as { content: string }).content, "**Grace**\nTry again now");
    const stored = await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId: row.id, source: "dashboard" } });
    assert.equal(stored.authorId, grace.id);
  });

  test("is refused when empty or on a closed ticket", async () => {
    const w = setup();
    const { row } = await open(w);
    await assert.rejects(replyToTicket(w.ctx, row.id, "   ", actor), /Write a reply/);
    await prisma.ticket.update({ where: { id: row.id }, data: { status: "closed" } });
    await assert.rejects(replyToTicket(w.ctx, row.id, "hello", actor), /already closed/);
  });
});

describe("panels", () => {
  test("are posted once, then edited in place, and their status says so", async () => {
    const w = setup();
    const actor = { userId: grace.id, name: "Grace", avatarUrl: null };
    const first = await postPanel(w.ctx, "main", actor);
    assert.equal(first.updated, false);
    const second = await postPanel(w.ctx, "main", actor);
    assert.equal(second.updated, true);
    assert.equal(second.messageId, first.messageId);
    const [status] = await panelStatuses(w.ctx);
    assert.equal(status?.posted, true);
    assert.equal(status?.messageUrl, `https://discord.com/channels/${GUILD}/${PANEL_CHANNEL}/${first.messageId}`);
    await assert.rejects(postPanel(w.ctx, "nope", actor), /doesn't exist/);
  });

  test("lay buttons out five to a row, or offer a menu", async () => {
    const types = Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, name: `Type ${i}`, opening: { category: CAT } }));
    const buttons = setup({ panels: [{ id: "many", name: "Many", channel: PANEL_CHANNEL, types }] });
    await tickets.commands![0]!.run(interaction(grace, { roles: [HANDLER], sub: "panel", component: false, manager: true }) as never, buttons.ctx);
    const rows = buttons.sent.at(-1)!.options.rows as { toJSON(): { components: unknown[] } }[];
    assert.deepEqual(rows.map((r) => r.toJSON().components.length), [5, 2]);

    const menu = setup({ panels: [{ id: "many", name: "Many", channel: PANEL_CHANNEL, style: "menu", types }] });
    await tickets.commands![0]!.run(interaction(grace, { roles: [HANDLER], sub: "panel", component: false, manager: true }) as never, menu.ctx);
    const select = (menu.sent.at(-1)!.options.rows as { toJSON(): { components: { custom_id: string; options: unknown[] }[] } }[])[0]!.toJSON().components[0]!;
    assert.equal(select.custom_id, "tickets:pick:many");
    assert.equal(select.options.length, 7);
  });

  test("health facts report the bot's permissions and each type's category", async () => {
    const w = setup({}, {}, { botPermissions: (flag: unknown) => flag !== "ManageWebhooks" });
    const facts = await ticketHealthFacts(w.ctx);
    assert.equal(facts.permissions.manageWebhooks, false);
    assert.equal(facts.permissions.manageChannels, true);
    assert.equal(facts.panels[0]?.types[0]?.categoryExists, true);
    assert.equal(facts.panels[0]?.posted, false);
  });
});
