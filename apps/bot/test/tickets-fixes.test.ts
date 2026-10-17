import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { computeTicketStats } from "../dist/control/tickets/stats-calc.js";

/**
 * The parts of the ticket control API that read Discord and the settings
 * together: who a ticket lists as added, whether its messages count as
 * pruned, and who counts as having closed it.
 */

const GUILD = "100000000000000041";
const BOT = "900000000000000041";
const OPENER = "400000000000000041";
const HANDLER_ROLE = "300000000000000041";
const HANDLER = "500000000000000041";
const GUEST = "500000000000000042";
const CHANNEL = "200000000000000041";

let dir: string;
let prisma: any;
let ticketDetail: typeof import("../dist/control/tickets/detail.js").ticketDetail;
let messagesPage: typeof import("../dist/control/tickets/detail.js").messagesPage;
let settings: any;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "tier0-ticket-fixes-"));
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

  ({ prisma } = (await import("@tier0/db")) as never);
  await prisma.guild.create({ data: { id: GUILD, name: "Ticket fixes guild" } });
  ({ ticketDetail, messagesPage } = await import("../dist/control/tickets/detail.js"));
  const { ModuleRegistry } = await import("@tier0/core");
  const { default: tickets } = await import("@tier0/module-tickets");
  const registry = new ModuleRegistry();
  registry.register(tickets);
  const resolved = registry.resolveSettings("tickets", {
    panels: [{ id: "main", name: "Main", types: [{ id: "support", name: "Support", handlers: [HANDLER_ROLE] }] }],
  });
  assert.ok(resolved.ok);
  settings = resolved.value;
});

after(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const member = (id: string, roles: string[]) => ({
  id,
  displayName: `Member ${id.slice(-2)}`,
  displayAvatarURL: () => "",
  user: { id, username: id, globalName: null, displayAvatarURL: () => "" },
  roles: { cache: new Map(roles.map((role) => [role, { id: role }])) },
  joinedAt: new Date(0),
});

function envFor(threadMembers: string[]) {
  const members = new Map([
    [OPENER, member(OPENER, [])],
    [HANDLER, member(HANDLER, [HANDLER_ROLE])],
    [GUEST, member(GUEST, [])],
  ]);
  for (const found of members.values()) Object.assign(found.roles.cache, { some: (fn: (r: { id: string }) => boolean) => [...found.roles.cache.values()].some(fn) });
  const thread = { id: CHANNEL, isThread: () => true, members: { cache: new Map(threadMembers.map((id) => [id, {}])) } };
  const guild = {
    id: GUILD,
    members: { cache: members, fetch: async (id: string) => members.get(id) ?? Promise.reject(new Error("Unknown Member")) },
    channels: { cache: new Map([[CHANNEL, thread]]) },
  };
  const client = { user: { id: BOT }, users: { cache: new Map(), fetch: async () => null } };
  const access = { level: "manager", userId: HANDLER, handledTypeIds: ["support"], claimLock: false, reopen: false, unclaimableTypeIds: [] };
  return { client, guild, ctx: { settings }, access } as never;
}

describe("a ticket's members", () => {
  test("leave out the type's handlers and the claimer, who were not added", async () => {
    const row = await prisma.ticket.create({
      data: { guildId: GUILD, channelId: CHANNEL, openerId: OPENER, typeId: "support", mode: "thread", claimedById: HANDLER },
    });
    const detail = await ticketDetail(envFor([OPENER, HANDLER, GUEST, BOT]), row);
    assert.deepEqual(
      detail.members.filter((m) => m.access === "added").map((m) => m.user.userId),
      [GUEST],
    );
    await prisma.ticket.delete({ where: { id: row.id } });
  });
});

describe("pruned messages", () => {
  test("are only reported when messages were kept and then deleted", async () => {
    const closedAt = new Date(Date.now() - 40 * 86_400_000);
    const row = await prisma.ticket.create({
      data: { guildId: GUILD, channelId: "200000000000000042", openerId: OPENER, status: "closed", closedAt, messageCount: 5 },
    });
    assert.equal((await messagesPage(row, null, null, { store: false, retentionDays: 30 })).pruned, false, "never kept");
    assert.equal((await messagesPage(row, null, null, { store: true, retentionDays: 0 })).pruned, false, "kept for good");
    assert.equal((await messagesPage(row, null, null, { store: true, retentionDays: 60 })).pruned, false, "not due yet");
    assert.equal((await messagesPage(row, null, null, { store: true, retentionDays: 30 })).pruned, true, "past retention");

    const at = new Date();
    const deleted = await prisma.ticket.update({
      where: { id: row.id },
      data: { transcriptDeletedAt: at, transcriptDeletedById: HANDLER, transcriptDeletedByName: "Kairo" },
    });
    const page = await messagesPage(deleted, null, null, { store: false, retentionDays: 0 });
    assert.equal(page.pruned, true, "deleted by a manager");
    assert.deepEqual(page.removal, { kind: "deleted", at: at.toISOString(), by: { userId: HANDLER, name: "Kairo" } });

    const pruned = await prisma.ticket.update({
      where: { id: row.id },
      data: { transcriptDeletedAt: null, transcriptDeletedById: null, transcriptDeletedByName: null, messagesPrunedAt: at },
    });
    assert.deepEqual((await messagesPage(pruned, null, null, { store: true, retentionDays: 0 })).removal, { kind: "pruned", at: at.toISOString() });
  });
});

describe("ticket stats", () => {
  test("an automatic close is nobody's close", () => {
    const now = new Date("2026-10-13T12:00:00.000Z");
    const stats = computeTicketStats({
      tickets: [
        {
          typeId: "support",
          typeName: "Support",
          openerId: OPENER,
          status: "closed",
          openedAt: new Date(now.getTime() - 3_600_000),
          closedAt: new Date(now.getTime() - 60_000),
          closedBy: "auto-close",
          firstResponseAt: null,
          rating: null,
          ratedAt: null,
        },
      ],
      claims: [],
      now,
      days: 7,
      typeNames: new Map(),
      botId: BOT,
    });
    assert.equal(stats.closed, 1);
    assert.deepEqual(stats.byHandler, []);
  });
});
