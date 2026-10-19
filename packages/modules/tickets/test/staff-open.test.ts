import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CAT, OVERFLOW, PANEL_CHANNEL, VIP, ada, grace, linus, mallory, mod, prisma, setup, tickets } from "./ticket-world.ts";
import { channel, known, member, snowflake, user, type FakeChannel, type World } from "./fake-discord.ts";

const { openTicketAs, closeTicketAs } = mod;
const actor = { userId: grace.id, name: "grace", avatarUrl: null };

const kinds = async (ticketId: number) => (await prisma.ticketEvent.findMany({ where: { ticketId }, orderBy: { id: "asc" } })).map((event) => event.kind);
const channelOf = (w: World, channelId: string): FakeChannel => w.channels.get(channelId)!;

describe("opening a ticket as staff", () => {
  test("makes the channel for the staff member and the picked members, and records who opened it", async () => {
    const w = setup();
    const result = await openTicketAs(w.ctx, { typeId: "support", subject: "About Friday", memberIds: [ada.id, linus.id] }, actor);

    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: result.id } });
    assert.equal(row.openerId, grace.id);
    assert.equal(row.typeId, "support");
    assert.equal(row.subject, "About Friday");
    assert.equal(row.status, "open");
    assert.equal(row.channelId, result.channelId);
    assert.equal(result.number, row.number);
    assert.ok(result.channelUrl.endsWith(`/${result.channelId}`));

    const created = channelOf(w, result.channelId);
    assert.equal(created.parentId, CAT);
    for (const id of [grace.id, ada.id, linus.id]) assert.ok(created.permissionOverwrites.cache.has(id), `${id} can see the channel`);

    const events = await prisma.ticketEvent.findMany({ where: { ticketId: row.id }, orderBy: { id: "asc" } });
    assert.deepEqual(events.map((event) => event.kind), ["opened", "member_added", "member_added"]);
    assert.equal(JSON.parse(events[0]!.detail).staff, true);
    assert.deepEqual(events.slice(1).map((event) => JSON.parse(event.detail).userId), [ada.id, linus.id]);
    assert.equal(events[0]!.actorId, grace.id);
  });

  test("pings the added members and neither the staff member nor the handlers", async () => {
    const w = setup();
    const result = await openTicketAs(w.ctx, { typeId: "support", memberIds: [ada.id] }, actor);
    const welcome = w.sent.find((entry) => entry.target === channelOf(w, result.channelId));
    assert.ok(welcome);
    assert.deepEqual(welcome.options.mentions, { users: [ada.id], roles: [] });
    assert.equal(welcome.values.members, `<@${ada.id}>`);
    assert.equal(welcome.values.pingRoles, "");
    // The staff member is named as text, not mentioned.
    assert.equal(welcome.values.user, "grace");
    assert.equal(welcome.body.content, "{members} {pingRoles}");
    assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: result.id } })).controlsMessageId, welcome.message?.id);
    // The default text mentions the members itself, so no second message is needed.
    assert.equal(channelOf(w, result.channelId).sent.length, 1);
  });

  test("the handlers are pinged only when staff ask for it", async () => {
    const w = setup();
    const result = await openTicketAs(w.ctx, { typeId: "support", memberIds: [ada.id], notifyHandlers: true }, actor);
    const welcome = w.sent.find((entry) => entry.target === channelOf(w, result.channelId));
    assert.ok(welcome);
    const mentions = welcome.options.mentions as { users: string[]; roles: string[] };
    assert.deepEqual(mentions.users, [ada.id]);
    assert.ok(mentions.roles.length > 0);
    assert.match(String(welcome.values.pingRoles), /<@&\d+>/);
  });

  test("a custom first message that mentions {user} shows the staff member's name, not a mention", async () => {
    const w = setup({}, { welcome: { content: "Hi {members}, {user} opened this", embeds: [], components: [] } });
    const result = await openTicketAs(w.ctx, { typeId: "support", memberIds: [ada.id] }, actor);
    const welcome = w.sent.find((entry) => entry.target === channelOf(w, result.channelId));
    assert.equal(welcome?.values.user, "grace");
    assert.ok(!JSON.stringify(welcome?.options.mentions).includes(grace.id));
  });

  test("a first message that holds {members} is not followed by a second mention", async () => {
    const w = setup({}, { welcome: { content: "Talk to {members}", embeds: [], components: [] } });
    const result = await openTicketAs(w.ctx, { typeId: "support", memberIds: [ada.id, linus.id] }, actor);
    const sent = channelOf(w, result.channelId).sent;
    assert.equal(sent.length, 1);
    assert.equal(w.sent.find((entry) => entry.target === channelOf(w, result.channelId))?.values.members, `<@${ada.id}> <@${linus.id}>`);
  });

  test("answers are optional and kept when given", async () => {
    const w = setup();
    const blank = await openTicketAs(w.ctx, { typeId: "support", memberIds: [ada.id] }, actor);
    assert.deepEqual(JSON.parse((await prisma.ticket.findUniqueOrThrow({ where: { id: blank.id } })).answers), []);

    const answered = await openTicketAs(w.ctx, { typeId: "support", answers: [{ label: "What happened?", value: "Match report" }, { label: "Extra", value: "  " }], memberIds: [ada.id] }, actor);
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: answered.id } });
    assert.deepEqual(JSON.parse(row.answers), [{ label: "What happened?", value: "Match report" }]);
    assert.equal(row.subject, "Match report");
  });

  test("a thread type opens a private thread with the staff member and the picked members", async () => {
    const w = setup({}, { opening: { mode: "thread" } });
    const result = await openTicketAs(w.ctx, { typeId: "support", memberIds: [ada.id, linus.id] }, actor);
    const thread = known.get(result.channelId)!;
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: result.id } });
    assert.equal(row.mode, "thread");
    assert.equal(thread.parentId, PANEL_CHANNEL);
    for (const id of [grace.id, ada.id, linus.id]) assert.ok(thread.members.cache.has(id), id);
  });

  test("numbers continue the server's count", async () => {
    const w = setup();
    const first = await openTicketAs(w.ctx, { typeId: "support", memberIds: [ada.id] }, actor);
    const second = await openTicketAs(w.ctx, { typeId: "support", memberIds: [ada.id] }, actor);
    assert.equal(second.number, first.number + 1);
  });

  test("the first message is posted in the ticket under the staff member's name", async () => {
    const w = setup();
    const result = await openTicketAs(w.ctx, { typeId: "support", memberIds: [ada.id], firstMessage: "Hello there" }, actor);
    const created = channelOf(w, result.channelId);
    assert.ok(created.sent.some((entry) => entry.content === "Hello there"));
    assert.deepEqual(result.notes, []);
  });
});

describe("what staff skip", () => {
  test("the blocklist, the roles that may open the type, the limit, the wait and working hours", async () => {
    const w = setup(
      {
        general: { blocklist: { members: [mallory.id, grace.id] } },
        automation: { hours: { enabled: true, timeZone: "UTC", days: [{ day: "mon", from: "09:00", to: "09:00" }] } },
      },
      { rules: { cooldown: "1h", allowedRoles: [VIP] } },
    );
    const first = await openTicketAs(w.ctx, { typeId: "support", memberIds: [mallory.id] }, actor);
    const second = await openTicketAs(w.ctx, { typeId: "support", memberIds: [ada.id] }, actor);
    assert.notEqual(first.id, second.id);
    assert.equal(await prisma.ticket.count({ where: { openerId: grace.id, status: "open" } }), 2);
    assert.equal(await prisma.ticketCooldown.count(), 0);
    // No "outside working hours" notice in either channel.
    for (const result of [first, second]) {
      assert.ok(!channelOf(w, result.channelId).sent.some((entry) => /working hours/.test(entry.body?.embeds[0]?.description ?? "")));
    }
  });

  test("ratings are not asked for", async () => {
    const w = setup({ ratings: { enabled: true } });
    const result = await openTicketAs(w.ctx, { typeId: "support", memberIds: [ada.id] }, actor);
    await closeTicketAs(w.ctx, result.id, {}, actor);
    assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: result.id } })).status, "closed");
    for (const dms of w.dms.values()) assert.ok(dms.every((dm) => !dm.options.rows), "no rating buttons were sent");
  });

  test("the creator leaving the server changes nothing", async () => {
    const w = setup({ general: { openerLeaves: "close" } });
    const result = await openTicketAs(w.ctx, { typeId: "support", memberIds: [ada.id] }, actor);
    await tickets.events!.memberLeave!({ id: grace.id, displayName: "grace", user: grace } as never, w.ctx);
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: result.id } });
    assert.equal(row.status, "open");
    assert.equal(row.openerLeftAt, null);
    assert.ok(!(await kinds(result.id)).includes("opener_left"));
  });

  test("an added member leaving is not the opener leaving either", async () => {
    const w = setup({ general: { openerLeaves: "close" } });
    const result = await openTicketAs(w.ctx, { typeId: "support", memberIds: [ada.id] }, actor);
    await tickets.events!.memberLeave!({ id: ada.id, displayName: "ada", user: ada } as never, w.ctx);
    assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: result.id } })).status, "open");
  });
});

describe("what staff still need", () => {
  test("an unknown type is refused", async () => {
    const w = setup();
    await assert.rejects(openTicketAs(w.ctx, { typeId: "nope", memberIds: [ada.id] }, actor), /no longer exists/);
    assert.equal(await prisma.ticket.count(), 0);
  });

  test("members are needed, one to ten, in the server and not bots", async () => {
    const w = setup();
    await assert.rejects(openTicketAs(w.ctx, { typeId: "support", memberIds: [] }, actor), /at least one member/);
    await assert.rejects(openTicketAs(w.ctx, { typeId: "support", memberIds: [grace.id] }, actor), /at least one member/);
    await assert.rejects(openTicketAs(w.ctx, { typeId: "support", memberIds: ["130000000000000077"] }, actor), /isn't in this server/);

    const bot = user("130000000000000050", "helperbot", true);
    w.addMember(member(bot));
    await assert.rejects(openTicketAs(w.ctx, { typeId: "support", memberIds: [bot.id] }, actor), /is a bot/);

    const many = Array.from({ length: 11 }, (_, n) => {
      const extra = user(String(130000000000001000n + BigInt(n)), `extra${n}`);
      w.addMember(member(extra));
      return extra.id;
    });
    await assert.rejects(openTicketAs(w.ctx, { typeId: "support", memberIds: many }, actor), /at most 10/);
    assert.equal(await prisma.ticket.count(), 0);
  });

  test("a full category with no overflow room is refused, and an overflow category is used", async () => {
    const w = setup();
    for (let n = 0; n < 50; n++) w.add(channel(snowflake(), { parentId: CAT }));
    const overflowed = await openTicketAs(w.ctx, { typeId: "support", memberIds: [ada.id] }, actor);
    assert.equal(channelOf(w, overflowed.channelId).parentId, OVERFLOW);

    for (let n = 0; n < 50; n++) w.add(channel(snowflake(), { parentId: OVERFLOW }));
    await assert.rejects(openTicketAs(w.ctx, { typeId: "support", memberIds: [ada.id] }, actor), /category is full/);
    assert.equal(await prisma.ticket.count(), 1);
  });

  test("a thread type needs its panel's channel", async () => {
    const w = setup({}, { opening: { mode: "thread" } });
    w.channels.delete(PANEL_CHANNEL);
    await assert.rejects(openTicketAs(w.ctx, { typeId: "support", memberIds: [ada.id] }, actor), /channel is missing/);
    assert.equal(await prisma.ticket.count(), 0);
  });

  test("when Discord refuses every channel, nothing is left behind", async () => {
    const w = setup({}, {}, { refuseCreates: 3 });
    await assert.rejects(openTicketAs(w.ctx, { typeId: "support", memberIds: [ada.id] }, actor), /could not create the ticket/);
    assert.equal(await prisma.ticket.count(), 0);
  });
});

describe("the {members} variable", () => {
  test("is listed for the first message and empty on an ordinary ticket", async () => {
    const { welcomeValues, WELCOME_VARIABLES } = await import("../dist/messages.js");
    assert.ok(WELCOME_VARIABLES.some((variable: { name: string }) => variable.name === "members"));
    const base = {
      opener: { id: ada.id, username: "ada" },
      ticket: { id: 1, number: 1, subject: null },
      channelId: "1",
      typeName: "Support",
      priority: "normal",
      answers: [],
      handlerRoleIds: [],
      pingRoleIds: [],
      claimedById: null,
    };
    assert.equal(welcomeValues(base).members, "");
    assert.equal(welcomeValues({ ...base, memberIds: [ada.id, linus.id] }).members, `<@${ada.id}> <@${linus.id}>`);
  });
});
