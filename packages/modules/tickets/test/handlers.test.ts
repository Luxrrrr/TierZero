import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, type MessageBody } from "@tier0/core";
import { createTestDatabase } from "./db-helper.ts";

const GUILD = "100000000000000020";
const CATEGORY = "223456789012345678";
const ROLE = "323456789012345678";
const OPENER = "400000000000000020";
const TICKET_CHANNEL = "500000000000000020";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { default: tickets } = await import("../dist/index.js");
const { REPLIES, CLOSING_MESSAGE } = await import("../dist/messages.js");

const registry = new ModuleRegistry();
registry.register(tickets);

interface Replied {
  body: MessageBody;
  values: Record<string, string | number>;
  fallback?: MessageBody;
}

let replies: Replied[];
let sent: { body: MessageBody; values: Record<string, string | number> }[];
let deleted: string[];

function settingsFor(stored: unknown = {}) {
  const result = registry.resolveSettings("tickets", { category: CATEGORY, supportRoles: [ROLE], ...(stored as object) });
  assert.ok(result.ok, result.ok ? "" : result.errors[0]?.message);
  return result.value;
}

function context(stored: unknown = {}) {
  const channel = {
    id: TICKET_CHANNEL,
    isTextBased: () => true,
    delete: async (reason: string) => {
      deleted.push(reason);
    },
  };
  const category = { id: CATEGORY, type: 4 };
  return {
    client: {},
    settings: settingsFor(stored),
    guild: {
      id: GUILD,
      channels: {
        cache: {
          get: (id: string) => (id === CATEGORY ? category : id === TICKET_CHANNEL ? channel : undefined),
          filter: () => ({ size: 0 }),
        },
      },
    },
    tasks: { cancel: async () => 0, schedule: async () => undefined },
    send: async (_target: unknown, body: MessageBody, values: Record<string, string | number>) => {
      sent.push({ body, values });
      return {};
    },
    reply: async (_interaction: unknown, body: MessageBody, values: Record<string, string | number> = {}, options?: { fallback?: MessageBody }) => {
      replies.push({ body, values, fallback: options?.fallback });
      return true;
    },
  } as never;
}

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Tickets test guild" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

beforeEach(async () => {
  replies = [];
  sent = [];
  deleted = [];
  await prisma.ticket.deleteMany();
});

const command = tickets.commands![0]!;
const interactionFor = (sub: string) =>
  ({
    options: { getSubcommand: () => sub, getString: () => null },
    user: { id: OPENER, tag: "ada#0", username: "ada" },
    member: null,
    memberPermissions: null,
    channelId: TICKET_CHANNEL,
  }) as never;

describe("a refusal", () => {
  test("is the server's own wording, with today's wording as the fallback", async () => {
    const ctx = context({ messages: { refusals: { notStaff: "Staff only." } } });
    await command.run(interactionFor("panel"), ctx);
    assert.equal(replies.length, 1);
    assert.equal(replies[0]?.body.content, "Staff only.");
    assert.deepEqual(replies[0]?.fallback, REPLIES.notStaff.starting);
  });

  test("reads as it always has when nothing was changed", async () => {
    await command.run(interactionFor("panel"), context());
    assert.equal(replies[0]?.body.content, "You need a support role or Manage Channels to do that.");
  });

  test("outside a ticket channel says so", async () => {
    await command.run(interactionFor("close"), context());
    assert.equal(replies[0]?.body.content, "This isn't an open ticket channel.");
  });

  test("a member who is not the opener or support staff cannot close", async () => {
    await prisma.ticket.create({ data: { guildId: GUILD, channelId: TICKET_CHANNEL, openerId: "someone-else" } });
    await command.run(interactionFor("close"), context());
    assert.equal(replies[0]?.body.content, REPLIES.cannotClose.starting.content);
  });

  test("opening past the limit names the count and the limit", async () => {
    await prisma.ticket.create({ data: { guildId: GUILD, channelId: "600000000000000020", openerId: OPENER } });
    await prisma.ticket.create({ data: { guildId: GUILD, channelId: "600000000000000021", openerId: OPENER } });
    const ctx = context({ ticketLimit: 2, messages: { opening: { limitMany: "Too many: {openCount} of {limit}." } } });
    await tickets.components!.open!(interactionFor("") as never, { rest: "", ctx });
    assert.equal(replies[0]?.body.content, "Too many: {openCount} of {limit}.");
    assert.deepEqual(replies[0]?.values, { openCount: 2, limit: 2 });
  });

  test("a limit of one has its own wording", async () => {
    await prisma.ticket.create({ data: { guildId: GUILD, channelId: "600000000000000022", openerId: OPENER } });
    await tickets.components!.open!(interactionFor("") as never, { rest: "", ctx: context() });
    assert.equal(replies[0]?.body.content, "You already have an open ticket. Close it before opening another.");
  });
});

describe("an automatic close", () => {
  const run = (stored: unknown = {}) =>
    tickets.tasks!.autoclose!({ channelId: TICKET_CHANNEL }, context({ transcript: { enabled: false }, ...(stored as object) }));

  beforeEach(async () => {
    await prisma.ticket.create({ data: { guildId: GUILD, channelId: TICKET_CHANNEL, openerId: OPENER } });
  });

  test("says nothing by default, as it always has", async () => {
    await run();
    assert.equal(sent.length, 0);
    assert.deepEqual(deleted, ["Ticket closed by Auto-close"]);
    const row = await prisma.ticket.findUnique({ where: { channelId: TICKET_CHANNEL } });
    assert.equal(row?.status, "closed");
  });

  test("posts the closing message first when the owner asks for it", async () => {
    await run({ autoClose: { enabled: true, notice: true } });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]?.body, CLOSING_MESSAGE);
    assert.equal(sent[0]?.values.closedBy, "Auto-close");
    assert.equal(sent[0]?.values.reason, "No activity in this ticket");
    assert.equal(sent[0]?.values.ending, ": No activity in this ticket");
  });

  test("uses the server's name for it in the audit log", async () => {
    await run({ labels: { autoCloseName: "Inactivity", closeReason: "Closed: {tag}" } });
    assert.deepEqual(deleted, ["Closed: Inactivity"]);
  });
});

describe("the form and the new channel", () => {
  test("the form carries the server's title and question", async () => {
    const shown: { title?: string; question?: string }[] = [];
    const interaction = {
      ...(interactionFor("") as object),
      showModal: async (modal: { toJSON(): { title: string; components: { components: { label: string }[] }[] } }) => {
        const json = modal.toJSON();
        shown.push({ title: json.title, question: json.components[0]?.components[0]?.label });
      },
    } as never;
    await tickets.components!.open!(interaction, { rest: "", ctx: context() });
    await tickets.components!.open!(interaction, { rest: "", ctx: context({ labels: { modalTitle: "Talk to us", modalQuestion: "Tell us more" } }) });
    assert.deepEqual(shown, [
      { title: "Open a ticket", question: "What do you need help with?" },
      { title: "Talk to us", question: "Tell us more" },
    ]);
  });

  async function submit(stored: unknown) {
    const created: { name: string; topic: string }[] = [];
    const posted: { rows: { toJSON(): { components: { label: string }[] } }[] }[] = [];
    const base = context(stored) as unknown as { guild: Record<string, unknown>; send: (...args: unknown[]) => Promise<unknown> };
    const ctx = {
      ...base,
      guild: {
        ...base.guild,
        id: GUILD,
        roles: { everyone: { id: GUILD } },
        members: { me: null },
        channels: {
          ...(base.guild.channels as object),
          create: async (options: { name: string; topic: string }) => {
            created.push({ name: options.name, topic: options.topic });
            return { id: "700000000000000020" };
          },
        },
      },
      send: async (_target: unknown, _body: unknown, _values: unknown, options: { rows: { toJSON(): { components: { label: string }[] } }[] }) => {
        posted.push({ rows: options.rows });
        return {};
      },
    } as never;
    const interaction = {
      ...(interactionFor("") as object),
      deferReply: async () => undefined,
      fields: { getTextInputValue: () => "Cannot log in" },
    } as never;
    await tickets.modals!.subject!(interaction, { rest: "", ctx });
    return { created, posted };
  }

  test("a new ticket is named and described the way it always was", async () => {
    const { created, posted } = await submit({});
    assert.deepEqual(created, [{ name: "ticket-ada", topic: "Opened by ada#0: Cannot log in" }]);
    assert.equal(posted[0]?.rows[0]?.toJSON().components[0]?.label, "Close ticket");
  });

  test("the name, topic and close button follow the server's settings", async () => {
    const { created, posted } = await submit({
      labels: { channelName: "Help {username}", topicWithSubject: "{username} wrote: {subject}", closeButton: "Done" },
    });
    assert.deepEqual(created, [{ name: "help-ada", topic: "ada wrote: Cannot log in" }]);
    assert.equal(posted[0]?.rows[0]?.toJSON().components[0]?.label, "Done");
  });
});
