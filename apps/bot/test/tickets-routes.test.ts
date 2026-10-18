import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The ticket routes of the control API against a real database built from the
 * migrations, with Discord and the tickets module's actions replaced by fakes.
 * What is under test is who gets in, what they see and what reaches the module.
 */

const GUILD = "100000000000000001";
const BOT = "900000000000000001";
const CHANNEL_PANEL = "200000000000000001";
const ROLE_BILLING = "300000000000000001";
const ROLE_TECH = "300000000000000002";
const ROLE_ADMIN = "300000000000000009";
const OPENER = "400000000000000001";
const NOBODY = "500000000000000000";
const BILLING = "500000000000000001";
const TECH = "500000000000000002";
const ADMIN = "500000000000000003";
const MANAGER = "500000000000000004";
const OWNER = "500000000000000005";

type Handle = typeof import("../dist/control/tickets/index.js").handleTickets;
type Services = import("../dist/control/tickets/runtime.js").TicketServices;

let dir: string;
let handleTickets: Handle;
let forgetViewers: () => void;
let prisma: any;
let settings: unknown;
let enabled = true;
let settingsReadable = true;
let calls: { name: string; args: unknown[] }[] = [];
let ids: { billing: number; tech: number; legacy: number };

const member = (id: string, roles: string[], manageGuild = false) => ({
  id,
  displayName: `Member ${id.slice(-2)}`,
  displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${id}/a.png`,
  roles: { cache: new Map([[GUILD, {}], ...roles.map((role) => [role, {}] as [string, object])]) },
  permissions: { has: () => manageGuild },
  joinedAt: new Date("2026-01-01T00:00:00.000Z"),
});

const members = new Map<string, ReturnType<typeof member>>([
  [NOBODY, member(NOBODY, [])],
  [BILLING, member(BILLING, [ROLE_BILLING])],
  [TECH, member(TECH, [ROLE_TECH])],
  [ADMIN, member(ADMIN, [ROLE_ADMIN])],
  [MANAGER, member(MANAGER, [], true)],
  [OPENER, member(OPENER, [])],
]);

const guild = {
  id: GUILD,
  name: "Test guild",
  ownerId: "999999999999999999",
  members: {
    cache: members,
    fetch: async (id: string) => {
      const found = members.get(id);
      if (!found) throw new Error("Unknown Member");
      return found;
    },
    search: async ({ query }: { query: string }) =>
      new Map([...members].filter(([, found]) => found.displayName.toLowerCase().startsWith(query.toLowerCase()))),
    me: { permissions: { has: () => true }, displayName: "TierZero" },
  },
  channels: { cache: new Map() },
  memberCount: 2431,
  iconURL: () => "https://cdn.discordapp.com/icons/1/i.png",
};

const client = {
  user: { id: BOT },
  users: { cache: new Map(), fetch: async () => null },
};

const state = {
  context: async () =>
    settingsReadable ? { client, guild, settings, dashboardUrl: async () => "", tasks: {}, send: async () => null } : null,
  isEnabled: async () => enabled,
};

function fakeServices(): Services {
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push({ name, args });
      return { ticket: {}, notes: [`${name} done`] } as never;
    };
  return {
    claimTicket: record("claimTicket"),
    unclaimTicket: record("unclaimTicket"),
    setTicketPriority: record("setTicketPriority"),
    addTicketNote: record("addTicketNote"),
    changeTicketMember: record("changeTicketMember"),
    transferTicket: record("transferTicket"),
    closeTicketAs: record("closeTicketAs"),
    reopenTicket: record("reopenTicket"),
    replyToTicket: async (...args: unknown[]) => {
      calls.push({ name: "replyToTicket", args });
      return { message: { id: 1 }, delivery: "webhook" } as never;
    },
    postPanel: async (...args: unknown[]) => {
      calls.push({ name: "postPanel", args });
      return { panelId: "main", channelId: CHANNEL_PANEL, messageId: "1", updated: false };
    },
    panelStatuses: async (...args: unknown[]) => {
      calls.push({ name: "panelStatuses", args });
      return [];
    },
    openTicketAs: async (...args: unknown[]) => {
      calls.push({ name: "openTicketAs", args });
      return { id: 77, number: 12, channelId: "800000000000000001", channelUrl: `https://discord.com/channels/${GUILD}/800000000000000001`, notes: [] };
    },
    renameTicket: record("renameTicket"),
    requestTicketClose: record("requestTicketClose"),
    ticketHealthFacts: async () => ({
      permissions: { manageChannels: true, manageWebhooks: true, manageThreads: true },
      panels: [],
    }),
  };
}

let services: Services;

async function call(method: string, path: string, options: { viewer?: string; actor?: string; body?: Record<string, unknown> } = {}) {
  const [route, search = ""] = path.split("?");
  const query = new URLSearchParams(search);
  if (options.viewer) query.set("viewer", options.viewer);
  const body =
    method === "GET" ? undefined : { ...(options.body ?? {}), ...(options.actor ? { actor: { userId: options.actor, name: "From session", avatarUrl: null } } : {}) };
  const reply = await handleTickets({
    client: client as never,
    guild: guild as never,
    state: state as never,
    method,
    segments: route!.split("/"),
    query,
    body,
    services,
  });
  return reply as { status: number; body: any; raw?: { contentType: string; text: string } } | null;
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "tier0-tickets-api-"));
  const dbPath = join(dir, "test.db");
  const migrations = resolve(import.meta.dirname, "../../../packages/db/prisma/migrations");
  const db = new DatabaseSync(dbPath);
  for (const entry of readdirSync(migrations).sort()) {
    try {
      db.exec(readFileSync(join(migrations, entry, "migration.sql"), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  db.close();
  process.env.DATABASE_URL = "file:" + dbPath.split(String.fromCharCode(92)).join("/");
  process.env.INSTANCE_OWNER_ID = OWNER;

  prisma = (await import("@tier0/db")).prisma;
  ({ handleTickets } = await import("../dist/control/tickets/index.js"));
  ({ forgetViewers } = await import("../dist/control/tickets/access.js"));
  const { ModuleRegistry } = await import("@tier0/core");
  const { default: tickets } = await import("@tier0/module-tickets");
  const registry = new ModuleRegistry();
  registry.register(tickets);
  const resolved = registry.resolveSettings("tickets", {
    panels: [
      {
        id: "main",
        name: "Main",
        channel: CHANNEL_PANEL,
        types: [
          { id: "billing", name: "Billing", handlers: [ROLE_BILLING] },
          { id: "tech", name: "Tech", handlers: [ROLE_TECH] },
        ],
      },
    ],
  general: { adminRoles: [ROLE_ADMIN], closeBehaviour: "archive", reopen: true },
});
assert.ok(resolved.ok, resolved.ok ? "" : JSON.stringify(resolved.errors));
settings = resolved.value;

await prisma.guild.create({ data: { id: GUILD, name: "Test guild" } });
const make = (data: Record<string, unknown>) =>
  prisma.ticket.create({ data: { guildId: GUILD, openerId: OPENER, openerName: "Opener", ...data } });
const billing = await make({ channelId: "600000000000000001", typeId: "billing", typeName: "Billing", subject: "Invoice wrong" });
const tech = await make({ channelId: "600000000000000002", typeId: "tech", typeName: "Tech", subject: "Login broken" });
const legacy = await make({
  channelId: "600000000000000003",
  typeId: null,
  status: "closed",
  archived: true,
  closedAt: new Date(),
  messageCount: 2,
});
ids = { billing: billing.id, tech: tech.id, legacy: legacy.id };
await prisma.ticketMessage.createMany({
  data: [
    { ticketId: tech.id, messageId: "700000000000000001", authorId: OPENER, authorName: "Opener", content: "I need a refund code" },
    { ticketId: legacy.id, messageId: "700000000000000002", authorId: OPENER, authorName: "Opener", content: "<script>alert(1)</script>" },
    { ticketId: legacy.id, messageId: "700000000000000003", authorId: ADMIN, authorName: "Admin", content: "Done", authorIsStaff: true },
  ],
});
});

after(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.INSTANCE_OWNER_ID;
});

beforeEach(() => {
  enabled = true;
  settingsReadable = true;
  calls = [];
  services = fakeServices();
  forgetViewers();
});

describe("who gets in", () => {
  test("a request that names nobody is refused", async () => {
    assert.equal((await call("GET", "list"))?.status, 400);
    assert.equal((await call("GET", "list", { viewer: "not-an-id" }))?.status, 400);
    assert.equal((await call("POST", `items/${ids.tech}/claim`))?.status, 400);
  });

  test("a member who handles nothing gets 403 on every route", async () => {
    for (const path of ["access", "context", "list", "stats", "panels", `items/${ids.tech}`, `items/${ids.tech}/messages`]) {
      assert.equal((await call("GET", path, { viewer: NOBODY }))?.status, 403, path);
    }
    assert.equal((await call("POST", `items/${ids.tech}/claim`, { actor: NOBODY }))?.status, 403);
  });

  test("someone not in the server is refused, unless they run the install", async () => {
    assert.equal((await call("GET", "list", { viewer: "500000000000000099" }))?.status, 403);
    const owner = await call("GET", "access", { viewer: OWNER });
    assert.equal(owner?.status, 200);
    assert.equal(owner?.body.level, "manager");
  });

  test("levels: handler, admin role, manager", async () => {
    assert.equal((await call("GET", "access", { viewer: TECH }))?.body.level, "handler");
    assert.deepEqual((await call("GET", "access", { viewer: TECH }))?.body.handledTypeIds, ["tech"]);
    assert.equal((await call("GET", "access", { viewer: ADMIN }))?.body.level, "admin");
    assert.equal((await call("GET", "access", { viewer: MANAGER }))?.body.level, "manager");
  });

  test("a handler of another type cannot open, read or write a ticket", async () => {
    assert.equal((await call("GET", `items/${ids.tech}`, { viewer: BILLING }))?.status, 403);
    assert.equal((await call("GET", `items/${ids.tech}/messages`, { viewer: BILLING }))?.status, 403);
    assert.equal((await call("GET", `items/${ids.tech}/transcript.html`, { viewer: BILLING }))?.status, 403);
    assert.equal((await call("POST", `items/${ids.tech}/claim`, { actor: BILLING }))?.status, 403);
    assert.equal(calls.length, 0);
  });

  test("a typeless ticket from before types existed is for admins and managers here", async () => {
    assert.equal((await call("GET", `items/${ids.legacy}`, { viewer: TECH }))?.status, 403);
    assert.equal((await call("GET", `items/${ids.legacy}`, { viewer: ADMIN }))?.status, 200);
  });

  test("panels need Manage Server", async () => {
    assert.equal((await call("GET", "panels", { viewer: ADMIN }))?.status, 403);
    assert.equal((await call("GET", "panels", { viewer: MANAGER }))?.status, 200);
    assert.equal((await call("POST", "panels/main/post", { actor: TECH }))?.status, 403);
    assert.equal((await call("POST", "panels/main/post", { actor: MANAGER }))?.status, 200);
    assert.equal((await call("POST", "panels/gone/post", { actor: MANAGER }))?.status, 404);
  });

  test("unknown routes match nothing", async () => {
    assert.equal(await call("GET", "items", { viewer: MANAGER }), null);
    assert.equal(await call("GET", "list/extra", { viewer: MANAGER }), null);
    assert.equal(await call("PUT", `items/${ids.tech}`, { actor: MANAGER }), null);
    assert.equal(await call("POST", `items/${ids.tech}/explode`, { actor: MANAGER }), null);
    assert.equal(await call("DELETE", `items/${ids.tech}`, { actor: MANAGER }), null);
  });

  test("a bad ticket number is refused and another server's ticket is not found", async () => {
    assert.equal((await call("GET", "items/abc", { viewer: MANAGER }))?.status, 400);
    assert.equal((await call("GET", "items/999999", { viewer: MANAGER }))?.status, 404);
  });

  test("settings that do not read stop everything with a plain 409", async () => {
    settingsReadable = false;
    const reply = await call("GET", "list", { viewer: MANAGER });
    assert.equal(reply?.status, 409);
    assert.match(reply?.body.error, /could not be read/);
  });
});

describe("reads", () => {
  test("a handler's list holds only their types, and asking for others changes nothing", async () => {
    const reply = await call("GET", "list?status=all", { viewer: TECH });
    assert.deepEqual(reply?.body.items.map((item: { id: number }) => item.id), [ids.tech]);
    assert.equal(reply?.body.total, 1);
    const sneaky = await call("GET", "list?status=all&type=billing", { viewer: TECH });
    assert.equal(sneaky?.body.total, 0);
  });

  test("admins and managers see every ticket, including typeless ones", async () => {
    assert.equal((await call("GET", "list?status=all", { viewer: ADMIN }))?.body.total, 3);
    assert.equal((await call("GET", "list", { viewer: MANAGER }))?.body.total, 2);
  });

  test("search finds text in the stored messages, the subject and by number", async () => {
    const byMessage = await call("GET", "list?status=all&q=refund", { viewer: MANAGER });
    assert.deepEqual(byMessage?.body.items.map((item: { id: number }) => item.id), [ids.tech]);
    const bySubject = await call("GET", "list?status=all&q=Invoice", { viewer: MANAGER });
    assert.deepEqual(bySubject?.body.items.map((item: { id: number }) => item.id), [ids.billing]);
    const byNumber = await call("GET", `list?status=all&q=%23${ids.legacy}`, { viewer: MANAGER });
    assert.deepEqual(byNumber?.body.items.map((item: { id: number }) => item.id), [ids.legacy]);
  });

  test("a waiting ticket is marked when the opener spoke last", async () => {
    const reply = await call("GET", "list", { viewer: MANAGER });
    const tech = reply?.body.items.find((item: { id: number }) => item.id === ids.tech);
    const billing = reply?.body.items.find((item: { id: number }) => item.id === ids.billing);
    assert.equal(tech.awaitingStaff, true);
    assert.equal(billing.awaitingStaff, false);
  });

  test("the detail carries the viewer's own permissions", async () => {
    const tech = await call("GET", `items/${ids.tech}`, { viewer: TECH });
    assert.equal(tech?.status, 200);
    assert.ok(tech?.body.permissions.includes("reply"));
    assert.ok(!tech?.body.permissions.includes("deleteTranscript"));
    const legacy = await call("GET", `items/${ids.legacy}`, { viewer: MANAGER });
    assert.ok(legacy?.body.permissions.includes("deleteTranscript"));
    assert.ok(legacy?.body.permissions.includes("reopen"));
    assert.equal(legacy?.body.channelExists, false);
    assert.equal(legacy?.body.discordUrl, null);
  });

  test("messages page by cursor", async () => {
    const first = await call("GET", `items/${ids.legacy}/messages`, { viewer: MANAGER });
    assert.equal(first?.body.items.length, 2);
    assert.equal(first?.body.hasMore, false);
    const next = await call("GET", `items/${ids.legacy}/messages?after=${first?.body.cursor}`, { viewer: MANAGER });
    assert.deepEqual(next?.body.items, []);
    assert.equal(next?.body.cursor, null);
    assert.equal((await call("GET", `items/${ids.legacy}/messages?after=x`, { viewer: MANAGER }))?.status, 400);
  });

  test("a poll also brings older messages edited or deleted since the last one", async () => {
    const first = await call("GET", `items/${ids.legacy}/messages`, { viewer: MANAGER });
    const since = first?.body.updatedSince as string;
    assert.ok(!Number.isNaN(Date.parse(since)));
    assert.deepEqual(first?.body.changed, []);

    // Changed after the first read and before the poll, as a real edit would be.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const later = new Date();
    await new Promise((resolve) => setTimeout(resolve, 5));
    try {
      await prisma.ticketMessage.updateMany({
        where: { ticketId: ids.legacy, messageId: "700000000000000002" },
        data: { content: "fixed", editedAt: later, edits: 1 },
      });
      await prisma.ticketMessage.updateMany({ where: { ticketId: ids.legacy, messageId: "700000000000000003" }, data: { deletedAt: later } });

      const poll = await call("GET", `items/${ids.legacy}/messages?after=${first?.body.cursor}&updatedSince=${encodeURIComponent(since)}`, {
        viewer: MANAGER,
      });
      assert.deepEqual(poll?.body.items, []);
      assert.deepEqual(
        poll?.body.changed.map((m: { messageId: string; content: string; deletedAt: string | null }) => [m.messageId, m.content, m.deletedAt !== null]),
        [
          ["700000000000000002", "fixed", false],
          ["700000000000000003", "Done", true],
        ],
      );

      const quiet = await call("GET", `items/${ids.legacy}/messages?after=${first?.body.cursor}&updatedSince=${encodeURIComponent(poll?.body.updatedSince)}`, {
        viewer: MANAGER,
      });
      assert.deepEqual(quiet?.body.changed, []);
      assert.equal((await call("GET", `items/${ids.legacy}/messages?updatedSince=yesterday`, { viewer: MANAGER }))?.status, 400);
    } finally {
      await prisma.ticketMessage.updateMany({
        where: { ticketId: ids.legacy, messageId: "700000000000000002" },
        data: { content: "<script>alert(1)</script>", editedAt: null, edits: 0 },
      });
      await prisma.ticketMessage.updateMany({ where: { ticketId: ids.legacy, messageId: "700000000000000003" }, data: { deletedAt: null } });
    }
  });

  test("transcripts download as escaped HTML and as text", async () => {
    const html = await call("GET", `items/${ids.legacy}/transcript.html`, { viewer: ADMIN });
    assert.equal(html?.raw?.contentType, "text/html; charset=utf-8");
    assert.ok(html?.raw?.text.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(!html?.raw?.text.includes("<script>"));
    const txt = await call("GET", `items/${ids.legacy}/transcript.txt`, { viewer: ADMIN });
    assert.match(txt?.raw?.text ?? "", /<script>alert\(1\)<\/script>/);
  });

  test("the context lists types with the ones the viewer handles", async () => {
    const reply = await call("GET", "context", { viewer: TECH });
    assert.equal(reply?.status, 200);
    const types = reply?.body.panels[0].types;
    assert.deepEqual(
      types.map((type: { id: string; handled: boolean }) => [type.id, type.handled]),
      [
        ["billing", false],
        ["tech", true],
      ],
    );
    assert.equal(reply?.body.level, "handler");
    assert.ok(Array.isArray(reply?.body.health));
  });

  test("stats are narrowed to the viewer's types", async () => {
    const tech = await call("GET", "stats?days=7", { viewer: TECH });
    assert.equal(tech?.body.openNow, 1);
    assert.equal(tech?.body.days, 7);
    const all = await call("GET", "stats?days=12", { viewer: MANAGER });
    assert.equal(all?.body.openNow, 2);
    assert.equal(all?.body.days, 30);
  });

  test("reads keep working with the feature switched off", async () => {
    enabled = false;
    assert.equal((await call("GET", "list", { viewer: TECH }))?.status, 200);
    assert.equal((await call("GET", "access", { viewer: TECH }))?.body.moduleEnabled, false);
  });
});

describe("writes", () => {
  test("refused with 409 while the feature is switched off, and the module is not called", async () => {
    enabled = false;
    const reply = await call("POST", `items/${ids.tech}/claim`, { actor: TECH });
    assert.equal(reply?.status, 409);
    assert.match(reply?.body.error, /switched off/);
    assert.equal(calls.length, 0);
  });

  test("a claim reaches the module as the member, named as Discord shows them", async () => {
    const reply = await call("POST", `items/${ids.tech}/claim`, { actor: TECH });
    assert.equal(reply?.status, 200);
    assert.deepEqual(reply?.body.notes, ["claimTicket done"]);
    assert.equal(reply?.body.ticket.id, ids.tech);
    const [ctx, ticketId, actor] = calls[0]!.args as [unknown, number, { userId: string; name: string }];
    assert.ok(ctx);
    assert.equal(ticketId, ids.tech);
    assert.deepEqual(actor, { userId: TECH, name: "Member 02", avatarUrl: `https://cdn.discordapp.com/avatars/${TECH}/a.png` });
  });

  test("bodies are validated before the module is called", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["reply", { content: "   " }],
      ["reply", { content: "x".repeat(2001) }],
      ["reply", { content: "", embeds: [{ title: "x", imageUrl: "javascript:alert(1)" }] }],
      ["reply", { content: "x", embeds: [{ title: "a" }, { title: "b" }, { title: "c" }, { title: "d" }] }],
      ["reply", { content: "x", embeds: [{ title: "a" }], buttons: [{ label: "x", style: "link", url: "https://example.com" }] }],
      ["priority", { priority: "huge" }],
      ["notes", { body: "" }],
      ["members", { action: "add", userId: "nope" }],
      ["members", { action: "kick", userId: OPENER }],
      ["transfer", { typeId: "missing" }],
      ["transfer", { typeId: "tech" }],
      ["close", { reason: "x".repeat(501) }],
    ];
    for (const [action, body] of cases) {
      const reply = await call("POST", `items/${ids.tech}/${action}`, { actor: MANAGER, body });
      assert.equal(reply?.status, 400, `${action} ${JSON.stringify(body).slice(0, 40)}`);
    }
    assert.equal(calls.length, 0);
  });

  test("a reply that is only an embed reaches the module with the embed", async () => {
    const reply = await call("POST", `items/${ids.tech}/reply`, { actor: MANAGER, body: { content: "", embeds: [{ title: "Steps", color: "#5865f2" }] } });
    assert.equal(reply?.status, 200);
    const args = calls[0]!.args as [unknown, number, string, unknown, unknown[], { title: string; color: string }[]];
    assert.equal(args[2], "");
    assert.equal(args[5][0]?.title, "Steps");
    assert.equal(args[5][0]?.color, "#5865f2");
  });

  test("valid bodies reach the module in the agreed shapes", async () => {
    await call("POST", `items/${ids.tech}/priority`, { actor: MANAGER, body: { priority: "urgent" } });
    await call("POST", `items/${ids.tech}/members`, { actor: MANAGER, body: { action: "add", userId: OPENER } });
    await call("POST", `items/${ids.tech}/transfer`, { actor: MANAGER, body: { typeId: "billing" } });
    await call("POST", `items/${ids.tech}/close`, { actor: MANAGER, body: {} });
    await call("POST", `items/${ids.tech}/close`, { actor: MANAGER, body: { reason: " Solved " } });
    await call("POST", `items/${ids.tech}/reply`, { actor: MANAGER, body: { content: "Hello\r\nthere" } });
    assert.deepEqual(calls.map((entry) => [entry.name, entry.args[2]]), [
      ["setTicketPriority", "urgent"],
      ["changeTicketMember", { action: "add", userId: OPENER }],
      ["transferTicket", { typeId: "billing" }],
      ["closeTicketAs", {}],
      ["closeTicketAs", { reason: "Solved" }],
      ["replyToTicket", "Hello\nthere"],
    ]);
  });

  test("what the ticket's state forbids is a 409, not a call", async () => {
    const reply = await call("POST", `items/${ids.legacy}/reply`, { actor: MANAGER, body: { content: "hi" } });
    assert.equal(reply?.status, 409);
    assert.equal((await call("POST", `items/${ids.tech}/reopen`, { actor: MANAGER }))?.status, 409);
    assert.equal(calls.length, 0);
  });

  test("a refusal from the module keeps its words and maps its code", async () => {
    services.claimTicket = async () => {
      throw Object.assign(new Error("Someone else claimed this ticket first. Reload to see who."), { code: "conflict" });
    };
    const reply = await call("POST", `items/${ids.tech}/claim`, { actor: MANAGER });
    assert.equal(reply?.status, 409);
    assert.equal(reply?.body.error, "Someone else claimed this ticket first. Reload to see who.");
    assert.equal(reply?.body.code, "conflict");
  });

  test("a fault in the module is not dressed up as a refusal", async () => {
    services.claimTicket = async () => {
      throw new Error("database is locked");
    };
    await assert.rejects(call("POST", `items/${ids.tech}/claim`, { actor: MANAGER }), /database is locked/);
  });

  test("replies are limited per person", async () => {
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (await call("POST", `items/${ids.billing}/reply`, { actor: ADMIN, body: { content: `reply ${i}` } }))!.status;
    }
    assert.equal(last, 429);
    assert.equal(calls.filter((entry) => entry.name === "replyToTicket").length, 20);
  });
});

describe("deleting a transcript", () => {
  test("only a manager, and only of a closed ticket", async () => {
    assert.equal((await call("DELETE", `items/${ids.legacy}/transcript`, { actor: ADMIN }))?.status, 403);
    assert.equal((await call("DELETE", `items/${ids.tech}/transcript`, { actor: MANAGER }))?.status, 409);
  });

  test("removes the messages, keeps the ticket and writes an audit row", async () => {
    const reply = await call("DELETE", `items/${ids.legacy}/transcript`, { actor: MANAGER });
    assert.equal(reply?.status, 200);
    assert.equal(reply?.body.deleted, 2);
    assert.equal(await prisma.ticketMessage.count({ where: { ticketId: ids.legacy } }), 0);
    assert.ok(await prisma.ticket.findUnique({ where: { id: ids.legacy } }));
    const audit = await prisma.ticketAudit.findFirst({ where: { ticketId: ids.legacy } });
    assert.equal(audit?.kind, "transcript.delete");
    assert.equal(audit?.actorId, MANAGER);
    assert.equal(JSON.parse(audit?.detail ?? "{}").messages, 2);

    const page = await call("GET", `items/${ids.legacy}/messages`, { viewer: MANAGER });
    assert.equal(page?.body.pruned, true);
    assert.equal(page?.body.removal.kind, "deleted");
    assert.equal(page?.body.removal.by.userId, MANAGER);
    const detail = await call("GET", `items/${ids.legacy}`, { viewer: MANAGER });
    assert.equal(detail?.body.transcript.messages, 0);
    assert.equal(detail?.body.transcript.removal.by.name, "Member 04");
  });
});

describe("routes for the workspace's next screens", () => {
  test("count says what is new since a ticket, for the viewer's types only", async () => {
    const all = await call("GET", "count?status=all", { viewer: MANAGER });
    assert.equal(all?.status, 200);
    assert.equal(all?.body.total, 3);
    assert.equal(all?.body.latestId, ids.legacy);
    const since = await call("GET", `count?status=all&after=${ids.billing}`, { viewer: MANAGER });
    assert.equal(since?.body.newCount, 2);
    assert.equal(since?.body.total, 3);
    const handler = await call("GET", "count?status=all", { viewer: TECH });
    assert.equal(handler?.body.total, 1);
    assert.equal((await call("GET", "count", { viewer: NOBODY }))?.status, 403);
  });

  test("the list takes after too", async () => {
    const list = await call("GET", `list?status=all&after=${ids.billing}`, { viewer: MANAGER });
    assert.deepEqual(list?.body.items.map((item: { id: number }) => item.id).sort(), [ids.tech, ids.legacy].sort());
    assert.equal(typeof list?.body.items[0].number, "number");
  });

  test("members are found by name, or named by id", async () => {
    const found = await call("GET", "members?q=member 0", { viewer: TECH });
    assert.equal(found?.status, 200);
    assert.ok(found?.body.length > 0);
    const named = await call("GET", `members?ids=${TECH},nope`, { viewer: MANAGER });
    assert.deepEqual(named?.body.map((hit: { user: { userId: string } }) => hit.user.userId), [TECH]);
    assert.equal((await call("GET", "members?q=x", { viewer: NOBODY }))?.status, 403);
  });

  test("rename and request-close reach the module, checked first", async () => {
    assert.equal((await call("POST", `items/${ids.tech}/rename`, { actor: TECH, body: { name: "login-fix" } }))?.status, 200);
    assert.equal((await call("POST", `items/${ids.tech}/rename`, { actor: TECH, body: { name: "" } }))?.status, 400);
    assert.equal((await call("POST", `items/${ids.tech}/request-close`, { actor: TECH, body: { reason: "Fixed" } }))?.status, 200);
    assert.equal((await call("POST", `items/${ids.legacy}/request-close`, { actor: MANAGER }))?.status, 409);
    assert.equal((await call("POST", `items/${ids.tech}/rename`, { actor: BILLING, body: { name: "x" } }))?.status, 403);
    assert.deepEqual(calls.map((entry) => entry.name), ["renameTicket", "requestTicketClose"]);
    assert.deepEqual(calls[1]?.args[2], { reason: "Fixed" });
  });

  test("a member is added by name", async () => {
    assert.equal((await call("POST", `items/${ids.tech}/members`, { actor: TECH, body: { action: "add", name: "FragMuffin" } }))?.status, 200);
    assert.deepEqual(calls[0]?.args[2], { action: "add", userId: "", name: "FragMuffin" });
  });

  test("a reply carries its files to the module", async () => {
    const data = Buffer.from("clip").toString("base64");
    const reply = await call("POST", `items/${ids.tech}/reply`, { actor: TECH, body: { content: "", files: [{ name: "clip.txt", contentType: "text/plain", data }] } });
    assert.equal(reply?.status, 200);
    assert.deepEqual(calls[0]?.args[4], [{ name: "clip.txt", contentType: "text/plain", data }]);
  });

  test("Check again asks Discord afresh", async () => {
    await call("GET", "panels", { viewer: MANAGER });
    assert.deepEqual(calls.find((entry) => entry.name === "panelStatuses")?.args[1], { fresh: true });
  });

  test("context carries the saved replies, the file limits and a health summary", async () => {
    const context = await call("GET", "context", { viewer: TECH });
    assert.deepEqual(context?.body.savedReplies, []);
    assert.equal(context?.body.replyFiles.maxFiles, 10);
    assert.equal(context?.body.healthSummary.state, "allBlocked");
  });
});

describe("opening a ticket as staff", () => {
  const body = { typeId: "tech", memberIds: [OPENER], subject: "About Friday" };

  test("the answer says where the new ticket is, and the module is called as the actor", async () => {
    const reply = await call("POST", "create", { actor: TECH, body });
    assert.equal(reply?.status, 200);
    assert.deepEqual(reply?.body, {
      id: 77,
      number: 12,
      channelId: "800000000000000001",
      channelUrl: `https://discord.com/channels/${GUILD}/800000000000000001`,
      notes: [],
    });
    const [ctxArg, request, actor] = calls[0]!.args as [unknown, any, any];
    assert.ok(ctxArg);
    assert.deepEqual(request, { typeId: "tech", subject: "About Friday", answers: [], memberIds: [OPENER], firstMessage: null });
    assert.equal(actor.userId, TECH);
  });

  test("who may open which type", async () => {
    const may = async (who: string, typeId: string) => (await call("POST", "create", { actor: who, body: { ...body, typeId } }))?.status;
    // Handlers: their own types only.
    assert.equal(await may(TECH, "tech"), 200);
    assert.equal(await may(TECH, "billing"), 403);
    assert.equal(await may(BILLING, "billing"), 200);
    assert.equal(await may(BILLING, "tech"), 403);
    // Admin roles and managers: every type, and the owner of the install too.
    for (const who of [ADMIN, MANAGER, OWNER]) {
      assert.equal(await may(who, "tech"), 200, who);
      assert.equal(await may(who, "billing"), 200, who);
    }
    // Someone who handles nothing is refused before anything else.
    assert.equal(await may(NOBODY, "tech"), 403);
    assert.equal(calls.length, 8);
  });

  test("a refusal says why in plain words, and nothing reaches the module", async () => {
    const reply = await call("POST", "create", { actor: BILLING, body });
    assert.equal(reply?.status, 403);
    assert.match(reply?.body.error, /do not handle this type/);
    assert.equal(calls.length, 0);
  });

  test("a type that is gone is a 400 with a sentence", async () => {
    const reply = await call("POST", "create", { actor: ADMIN, body: { ...body, typeId: "gone" } });
    assert.equal(reply?.status, 400);
    assert.match(reply?.body.error, /no longer exists/);
    assert.equal(calls.length, 0);
  });

  test("the body is checked before the module is called", async () => {
    const bad: Record<string, unknown>[] = [
      { ...body, memberIds: [] },
      { ...body, memberIds: ["not-an-id"] },
      { ...body, memberIds: Array.from({ length: 11 }, (_, n) => String(300000000000000000n + BigInt(n))) },
      { ...body, subject: "x".repeat(201) },
      { ...body, firstMessage: "x".repeat(2001) },
      { ...body, answers: "no" },
      { memberIds: [OPENER] },
    ];
    for (const sent of bad) assert.equal((await call("POST", "create", { actor: ADMIN, body: sent }))?.status, 400, JSON.stringify(sent).slice(0, 60));
    assert.equal(calls.length, 0);
  });

  test("it needs an actor, a switched-on module, and no extra path", async () => {
    assert.equal((await call("POST", "create", { body }))?.status, 400);
    enabled = false;
    assert.equal((await call("POST", "create", { actor: ADMIN, body }))?.status, 409);
    enabled = true;
    assert.equal(await call("GET", "create", { viewer: ADMIN }), null);
    assert.equal(await call("POST", "create/extra", { actor: ADMIN, body }), null);
  });

  test("the module's refusals come through with their status", async () => {
    services.openTicketAs = async () => {
      throw Object.assign(new Error("This ticket type's category is full."), { code: "unavailable" });
    };
    const reply = await call("POST", "create", { actor: ADMIN, body });
    assert.equal(reply?.status, 503);
    assert.match(reply?.body.error, /category is full/);
  });

  test("the context lists each type's questions", async () => {
    const reply = await call("GET", "context", { viewer: ADMIN });
    const types = reply?.body.panels.flatMap((panel: any) => panel.types);
    assert.ok(types.every((type: any) => Array.isArray(type.questions)));
    assert.ok(reply?.body.permissions.includes("create"));
  });
});

describe("replying to one message", () => {
  test("the message's id reaches the module when it is a stored message of the ticket", async () => {
    const reply = await call("POST", `items/${ids.tech}/reply`, { actor: TECH, body: { content: "On it", replyToMessageId: "700000000000000001" } });
    assert.equal(reply?.status, 200);
    assert.equal(calls[0]?.args[6], "700000000000000001");
  });

  test("a message that is not in the ticket, is another ticket's, was deleted or is not an id is refused before the module is called", async () => {
    await prisma.ticketMessage.create({
      data: { ticketId: ids.tech, messageId: "700000000000000009", authorId: OPENER, authorName: "Opener", content: "gone", deletedAt: new Date() },
    });
    const cases: [string, RegExp][] = [
      ["700000000000000077", /not in this ticket/],
      ["700000000000000002", /not in this ticket/],
      ["700000000000000009", /deleted/],
      ["abc", /could not be read/],
    ];
    for (const [id, message] of cases) {
      const reply = await call("POST", `items/${ids.tech}/reply`, { actor: TECH, body: { content: "On it", replyToMessageId: id } });
      assert.equal(reply?.status, 400, id);
      assert.match(reply?.body.error, message, id);
    }
    assert.equal(calls.length, 0);
  });

  test("a reply without one passes none", async () => {
    await call("POST", `items/${ids.tech}/reply`, { actor: TECH, body: { content: "On it" } });
    assert.equal(calls[0]?.args[6], undefined);
  });
});

describe("saved messages for the reply box", () => {
  const embeds = JSON.stringify([{ title: "Refund steps", description: "Open Billing.", color: "#5865f2" }]);

  test("lists only the templates marked for tickets, with what a reply can use and what is left out", async () => {
    const folder = await prisma.messageFolder.create({ data: { guildId: GUILD, name: "Billing" } });
    await prisma.messageTemplate.createMany({
      data: [
        { guildId: GUILD, name: "Hidden", content: "not offered" },
        { guildId: GUILD, name: "Refund", folderId: folder.id, content: "Hi {user}", embeds, inTickets: true, buttons: JSON.stringify([{ label: "Docs", url: "https://example.com" }]) },
        { guildId: GUILD, name: "Apology", content: "Sorry about that", inTickets: true },
      ],
    });
    const reply = await call("GET", "templates", { viewer: TECH });
    assert.equal(reply?.status, 200);
    assert.deepEqual(reply?.body.templates.map((t: { name: string }) => t.name), ["Apology", "Refund"]);
    const refund = reply?.body.templates.find((t: { name: string }) => t.name === "Refund");
    assert.deepEqual(Object.keys(refund).sort(), ["content", "embeds", "folder", "id", "leftOut", "name"]);
    assert.equal(refund.folder, "Billing");
    assert.equal(refund.content, "Hi {user}");
    assert.equal(refund.embeds[0].title, "Refund steps");
    assert.deepEqual(refund.leftOut, ["buttons"]);
    assert.equal(reply?.body.templates[0].folder, null);
    assert.deepEqual(reply?.body.variables, {
      server: "Test guild",
      members: "2,431",
      bot: "TierZero",
      "server.icon": "https://cdn.discordapp.com/icons/1/i.png",
    });
  });

  test("nothing is offered when no template is marked", async () => {
    await prisma.messageTemplate.deleteMany({ where: { guildId: GUILD } });
    assert.deepEqual((await call("GET", "templates", { viewer: TECH }))?.body.templates, []);
  });

  test("anyone who works tickets can read it, and anyone else cannot", async () => {
    assert.equal((await call("GET", "templates", { viewer: BILLING }))?.status, 200);
    assert.equal((await call("GET", "templates", { viewer: NOBODY }))?.status, 403);
    assert.equal((await call("GET", "templates", { viewer: "500000000000000099" }))?.status, 403);
    assert.equal((await call("GET", "templates"))?.status, 400);
  });

  test("it is a read: nothing else is routed there", async () => {
    assert.equal(await call("POST", "templates", { actor: MANAGER }), null);
    assert.equal(await call("GET", "templates/1", { viewer: MANAGER }), null);
    assert.equal(await call("DELETE", "templates", { actor: MANAGER }), null);
  });
});
