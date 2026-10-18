import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Reads held with `wait`: they answer as soon as the notifier fires, answer
 * with the usual page when it does not, refuse before waiting when the viewer
 * has no business there, and give their place back when the caller leaves.
 */

const GUILD = "100000000000000011";
const BOT = "900000000000000011";
const ROLE_BILLING = "300000000000000011";
const ROLE_TECH = "300000000000000012";
const OPENER = "400000000000000011";
const BILLING = "500000000000000011";
const TECH = "500000000000000012";
const TECH_TWO = "500000000000000013";

let dir: string;
let prisma: any;
let handleTickets: typeof import("../dist/control/tickets/index.js").handleTickets;
let live: typeof import("@tier0/module-tickets");
let settings: unknown;
let tech: { id: number };

const member = (id: string, roles: string[]) => ({
  id,
  displayName: `Member ${id.slice(-2)}`,
  displayAvatarURL: () => "https://cdn.discordapp.com/avatars/1/a.png",
  roles: { cache: new Map([[GUILD, {}], ...roles.map((role) => [role, {}] as [string, object])]) },
  permissions: { has: () => false },
  joinedAt: new Date("2026-01-01T00:00:00.000Z"),
});

const members = new Map([
  [BILLING, member(BILLING, [ROLE_BILLING])],
  [TECH, member(TECH, [ROLE_TECH])],
  [TECH_TWO, member(TECH_TWO, [ROLE_TECH])],
  [OPENER, member(OPENER, [])],
]);

const guild = {
  id: GUILD,
  name: "Test guild",
  ownerId: "999999999999999999",
  members: { cache: members, fetch: async (id: string) => members.get(id) ?? Promise.reject(new Error("Unknown Member")), me: { permissions: { has: () => true } } },
  channels: { cache: new Map() },
  memberCount: 3,
  iconURL: () => "",
};
const client = { user: { id: BOT }, users: { cache: new Map(), fetch: async () => null } };
const state = {
  context: async () => ({ client, guild, settings, dashboardUrl: async () => "", tasks: {}, send: async () => null }),
  isEnabled: async () => true,
};

async function call(path: string, viewer: string, signal?: AbortSignal) {
  const [route, search = ""] = path.split("?");
  const query = new URLSearchParams(search);
  query.set("viewer", viewer);
  const started = Date.now();
  const reply = await handleTickets({
    client: client as never,
    guild: guild as never,
    state: state as never,
    method: "GET",
    segments: route!.split("/"),
    query,
    body: undefined,
    signal,
  });
  return { reply: reply as { status: number; body: any }, ms: Date.now() - started };
}

const later = (ms: number, run: () => void | Promise<void>) => setTimeout(() => void run(), ms);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const store = (ticketId: number, messageId: string) =>
  prisma.ticketMessage.create({ data: { ticketId, messageId, authorId: OPENER, authorName: "Opener", content: "hello" } });

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "tier0-tickets-wait-"));
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

  prisma = (await import("@tier0/db")).prisma;
  ({ handleTickets } = await import("../dist/control/tickets/index.js"));
  live = await import("@tier0/module-tickets");
  const { ModuleRegistry } = await import("@tier0/core");
  const { default: tickets } = await import("@tier0/module-tickets");
  const registry = new ModuleRegistry();
  registry.register(tickets);
  const resolved = registry.resolveSettings("tickets", {
    panels: [
      {
        id: "main",
        name: "Main",
        channel: "200000000000000011",
        types: [
          { id: "billing", name: "Billing", handlers: [ROLE_BILLING] },
          { id: "tech", name: "Tech", handlers: [ROLE_TECH] },
        ],
      },
    ],
  });
  assert.ok(resolved.ok);
  settings = resolved.value;
  await prisma.guild.create({ data: { id: GUILD, name: "Test guild" } });
  tech = await prisma.ticket.create({ data: { guildId: GUILD, openerId: OPENER, openerName: "Opener", channelId: "600000000000000011", typeId: "tech", typeName: "Tech" } });
});

after(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("messages with wait", () => {
  test("a message stored while the request is held answers it at once", async () => {
    const pending = call(`items/${tech.id}/messages?wait=10`, TECH);
    later(80, async () => {
      await store(tech.id, "700000000000000011");
      live.notifyTicket(GUILD, tech.id, "message");
    });
    const { reply, ms } = await pending;
    assert.equal(reply.status, 200);
    assert.equal(reply.body.items.length, 1);
    assert.ok(ms < 1500, `took ${ms} ms`);
    assert.equal(live.heldWaits(), 0);
  });

  test("a change that came before the request is not lost", async () => {
    const first = await call(`items/${tech.id}/messages`, TECH);
    const cursor = first.reply.body.cursor as string;
    await store(tech.id, "700000000000000012");
    live.notifyTicket(GUILD, tech.id, "message");
    const { reply, ms } = await call(`items/${tech.id}/messages?after=${cursor}&wait=10`, TECH);
    assert.equal(reply.body.items.length, 1);
    assert.ok(ms < 1000, `took ${ms} ms`);
  });

  test("a change to the ticket answers with a new detail version and no messages", async () => {
    const before = (await call(`items/${tech.id}/messages`, TECH)).reply.body;
    later(80, () => live.notifyTicket(GUILD, tech.id, "detail"));
    const { reply, ms } = await call(`items/${tech.id}/messages?after=${before.cursor}&detailVersion=${before.detailVersion}&wait=10`, TECH);
    assert.equal(reply.body.items.length, 0);
    assert.ok(reply.body.detailVersion > before.detailVersion);
    assert.ok(ms < 1500, `took ${ms} ms`);
  });

  test("an older detail version answers without waiting", async () => {
    const before = (await call(`items/${tech.id}/messages`, TECH)).reply.body;
    live.notifyTicket(GUILD, tech.id, "detail");
    const { reply, ms } = await call(`items/${tech.id}/messages?after=${before.cursor}&detailVersion=${before.detailVersion}&wait=10`, TECH);
    assert.ok(reply.body.detailVersion > before.detailVersion);
    assert.ok(ms < 500, `took ${ms} ms`);
  });

  test("with nothing to say it answers with the usual page when the time is up", async () => {
    const before = (await call(`items/${tech.id}/messages`, TECH)).reply.body;
    const { reply, ms } = await call(`items/${tech.id}/messages?after=${before.cursor}&detailVersion=${before.detailVersion}&wait=1`, TECH);
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body.items, []);
    assert.ok(ms >= 900 && ms < 2500, `took ${ms} ms`);
    assert.equal(live.heldWaits(), 0);
  });

  test("a change to another ticket does not answer it", async () => {
    const before = (await call(`items/${tech.id}/messages`, TECH)).reply.body;
    later(50, () => live.notifyTicket(GUILD, tech.id + 1000, "message"));
    const { ms } = await call(`items/${tech.id}/messages?after=${before.cursor}&detailVersion=${before.detailVersion}&wait=1`, TECH);
    assert.ok(ms >= 900, `took ${ms} ms`);
  });

  test("a viewer who may not see the ticket is refused without waiting", async () => {
    const { reply, ms } = await call(`items/${tech.id}/messages?wait=10`, BILLING);
    assert.equal(reply.status, 403);
    assert.ok(ms < 500);
    assert.equal(live.heldWaits(), 0);
  });

  test("a wait that is not a number is refused", async () => {
    assert.equal((await call(`items/${tech.id}/messages?wait=soon`, TECH)).reply.status, 400);
    assert.equal((await call(`items/${tech.id}/messages?wait=1&detailVersion=x`, TECH)).reply.status, 400);
  });

  test("a viewer holds at most six, and a hang-up gives the place back", async () => {
    const before = (await call(`items/${tech.id}/messages`, TECH)).reply.body;
    const path = `items/${tech.id}/messages?after=${before.cursor}&detailVersion=${before.detailVersion}&wait=20`;
    const aborts = Array.from({ length: live.WAITS_PER_VIEWER }, () => new AbortController());
    const held = aborts.map((controller) => call(path, TECH, controller.signal));
    await pause(150);
    assert.equal(live.heldWaits(GUILD), live.WAITS_PER_VIEWER);
    const refused = await call(path, TECH);
    assert.equal(refused.reply.status, 429);
    assert.ok(refused.ms < 500);
    // Another viewer is not held back by the first one's places.
    const other = new AbortController();
    const another = call(path, TECH_TWO, other.signal);
    await pause(100);
    assert.equal(live.heldWaits(GUILD), live.WAITS_PER_VIEWER + 1);
    other.abort();
    await another;
    for (const controller of aborts) controller.abort();
    await Promise.all(held);
    assert.equal(live.heldWaits(), 0);
    assert.equal((await call(path.replace("wait=20", "wait=0"), TECH)).reply.status, 200);
  });
});

describe("count with wait", () => {
  test("a ticket opened while the request is held answers it, with the version to ask again with", async () => {
    const base = (await call("count", TECH)).reply.body;
    assert.equal(typeof base.version, "number");
    later(80, () => live.notifyTicket(GUILD, tech.id, "opened"));
    const { reply, ms } = await call(`count?wait=10&version=${base.version}`, TECH);
    assert.equal(reply.status, 200);
    assert.ok(reply.body.version > base.version);
    assert.ok(ms < 1500, `took ${ms} ms`);
  });

  test("an older version is answered at once", async () => {
    const base = (await call("count", TECH)).reply.body;
    live.notifyTicket(GUILD, tech.id, "activity");
    const { reply, ms } = await call(`count?wait=10&version=${base.version}`, TECH);
    assert.ok(reply.body.version > base.version);
    assert.ok(ms < 500, `took ${ms} ms`);
  });

  test("with no change it answers with the usual count when the time is up", async () => {
    const base = (await call("count", TECH)).reply.body;
    const { reply, ms } = await call(`count?wait=1&version=${base.version}`, TECH);
    assert.equal(reply.status, 200);
    assert.equal(reply.body.total, 1);
    assert.ok(ms >= 900 && ms < 2500, `took ${ms} ms`);
    assert.equal(live.heldWaits(), 0);
  });

  test("a viewer who handles nothing is refused without waiting", async () => {
    const { reply, ms } = await call("count?wait=10", "500000000000000099");
    assert.equal(reply.status, 403);
    assert.ok(ms < 500);
  });

  test("a hang-up ends the wait and gives the place back", async () => {
    const base = (await call("count", TECH)).reply.body;
    const controller = new AbortController();
    const held = call(`count?wait=20&version=${base.version}`, TECH, controller.signal);
    await pause(100);
    assert.equal(live.heldWaits(GUILD), 1);
    controller.abort();
    const { ms } = await held;
    assert.ok(ms < 1000);
    assert.equal(live.heldWaits(), 0);
  });
});
