import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry } from "@tier0/core";
import { createTestDatabase } from "./db-helper.ts";
import { CATEGORY, GUILD, channel, interaction, user, world, type World } from "./fake-discord.ts";

const CATEGORY_ID = "223456789012345678";
const ROLE = "323456789012345678";
const OPENER = "400000000000000020";
const TICKET_CHANNEL = "500000000000000020";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { default: tickets, forgetOpenTickets } = await import("../dist/index.js");
const { REPLIES, CLOSING_MESSAGE } = await import("../dist/messages.js");

const registry = new ModuleRegistry();
registry.register(tickets);

function settingsFor(stored: unknown = {}) {
  const result = registry.resolveSettings("tickets", { category: CATEGORY_ID, supportRoles: [ROLE], ...(stored as object) });
  assert.ok(result.ok, result.ok ? "" : result.errors[0]?.message);
  return result.value;
}

const ada = user(OPENER, "ada");

function setup(stored: unknown = {}): World {
  const w = world(settingsFor(stored));
  w.add(channel(CATEGORY_ID, { type: CATEGORY }));
  w.add(channel(TICKET_CHANNEL, { parentId: CATEGORY_ID }));
  return w;
}

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Tickets test guild" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

beforeEach(async () => {
  await prisma.ticket.deleteMany();
  forgetOpenTickets();
});

const command = tickets.commands![0]!;
const asCommand = (sub: string) => interaction(ada, { sub, channelId: TICKET_CHANNEL, component: false }) as never;

describe("a refusal", () => {
  test("is the server's own wording, with today's wording as the fallback", async () => {
    const w = setup({ messages: { refusals: { notStaff: "Staff only." } } });
    await command.run(asCommand("panel"), w.ctx);
    assert.equal(w.replies.length, 1);
    assert.equal(w.replies[0]?.body.content, "Staff only.");
    assert.deepEqual(w.replies[0]?.options.fallback, REPLIES.notStaff.starting);
  });

  test("reads as it always has when nothing was changed", async () => {
    const w = setup();
    await command.run(asCommand("panel"), w.ctx);
    assert.equal(w.replies[0]?.body.embeds[0]?.description, "You need a support role or Manage Channels to do that.");
  });

  test("outside a ticket channel says so", async () => {
    const w = setup();
    await command.run(asCommand("close"), w.ctx);
    assert.equal(w.replies[0]?.body.embeds[0]?.description, "This isn't an open ticket channel.");
  });

  test("a member who is not the opener or support staff cannot close", async () => {
    await prisma.ticket.create({ data: { guildId: GUILD, channelId: TICKET_CHANNEL, openerId: "400000000000000099" } });
    const w = setup();
    await command.run(asCommand("close"), w.ctx);
    assert.equal(w.replies[0]?.body.embeds[0]?.description, REPLIES.cannotClose.starting.embeds[0]?.description);
  });

  test("opening past the limit names the count and the limit", async () => {
    await prisma.ticket.create({ data: { guildId: GUILD, channelId: "600000000000000020", openerId: OPENER } });
    await prisma.ticket.create({ data: { guildId: GUILD, channelId: "600000000000000021", openerId: OPENER } });
    const w = setup({ ticketLimit: 2, messages: { opening: { limitMany: "Too many: {openCount} of {limit}." } } });
    await tickets.components!.open!(interaction(ada) as never, { rest: "", ctx: w.ctx });
    assert.equal(w.replies[0]?.body.content, "Too many: {openCount} of {limit}.");
    assert.deepEqual(w.replies[0]?.values, { openCount: 2, limit: 2 });
  });

  test("a limit of one has its own wording", async () => {
    await prisma.ticket.create({ data: { guildId: GUILD, channelId: "600000000000000022", openerId: OPENER } });
    const w = setup();
    await tickets.components!.open!(interaction(ada) as never, { rest: "", ctx: w.ctx });
    assert.equal(w.replies[0]?.body.embeds[0]?.description, "You already have an open ticket. Close it before opening another.");
  });
});

describe("an automatic close", () => {
  const run = (stored: Record<string, unknown> = {}) => {
    const { autoClose, ...rest } = stored as { autoClose?: Record<string, unknown> };
    const w = setup({ transcript: { enabled: false }, autoClose: { enabled: true, ...autoClose }, ...rest });
    return tickets.tasks!.autoclose!({ channelId: TICKET_CHANNEL }, w.ctx).then(() => w);
  };
  const deleted = (w: World) => w.channels.get(TICKET_CHANNEL)!.deleted;

  beforeEach(async () => {
    const quietSince = new Date(Date.now() - 3 * 86_400_000);
    await prisma.ticket.create({ data: { guildId: GUILD, channelId: TICKET_CHANNEL, openerId: OPENER, lastActivityAt: quietSince } });
  });

  test("says nothing by default, as it always has", async () => {
    const w = await run();
    assert.equal(w.sent.length, 0);
    assert.deepEqual(deleted(w), ["Ticket closed by Auto-close"]);
    const row = await prisma.ticket.findUnique({ where: { channelId: TICKET_CHANNEL } });
    assert.equal(row?.status, "closed");
  });

  test("posts the closing message first when the owner asks for it", async () => {
    const w = await run({ autoClose: { enabled: true, notice: true } });
    assert.equal(w.sent.length, 1);
    assert.deepEqual(w.sent[0]?.body, CLOSING_MESSAGE);
    assert.equal(w.sent[0]?.values.closedBy, "Auto-close");
    assert.equal(w.sent[0]?.values.reason, "No activity in this ticket");
    assert.equal(w.sent[0]?.values.ending, ": No activity in this ticket");
  });

  test("uses the server's name for it in the audit log", async () => {
    const w = await run({ labels: { autoCloseName: "Inactivity", closeReason: "Closed: {tag}" } });
    assert.deepEqual(deleted(w), ["Closed: Inactivity"]);
  });
});

describe("the form and the new channel", () => {
  test("the form carries the server's title and question", async () => {
    const shown: { title?: string; question?: string }[] = [];
    for (const stored of [{}, { labels: { modalTitle: "Talk to us", modalQuestion: "Tell us more" } }]) {
      const w = setup(stored);
      const press = interaction(ada);
      await tickets.components!.open!(press as never, { rest: "", ctx: w.ctx });
      const json = press.modals[0] as { title: string; components: { components: { label: string }[] }[] };
      shown.push({ title: json.title, question: json.components[0]?.components[0]?.label });
    }
    assert.deepEqual(shown, [
      { title: "Open a ticket", question: "What do you need help with?" },
      { title: "Talk to us", question: "Tell us more" },
    ]);
  });

  async function submit(stored: unknown) {
    const w = setup(stored);
    await tickets.modals!.subject!(interaction(ada, { fields: { q0: "Cannot log in" } }) as never, { rest: "", ctx: w.ctx });
    const welcome = w.sent[0]?.options.rows as { toJSON(): { components: { label: string }[] } }[];
    return { created: w.created.map((c) => ({ name: c.name, topic: c.topic })), welcome };
  }

  test("a new ticket is named and described the way it always was", async () => {
    const { created, welcome } = await submit({});
    assert.deepEqual(created, [{ name: "ticket-ada", topic: "Opened by ada#0: Cannot log in" }]);
    assert.equal(welcome[0]?.toJSON().components[0]?.label, "Close ticket");
  });

  test("the name, topic and close button follow the server's settings", async () => {
    const { created, welcome } = await submit({
      labels: { channelName: "Help {username}", topicWithSubject: "{username} wrote: {subject}", closeButton: "Done" },
    });
    assert.deepEqual(created, [{ name: "help-ada", topic: "ada wrote: Cannot log in" }]);
    assert.equal(welcome[0]?.toJSON().components[0]?.label, "Done");
  });
});
