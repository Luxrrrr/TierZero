import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The "available in tickets" flag on Message creator templates: the migration
 * that adds it, and the template routes that carry it. Run against a real
 * database built from the migrations.
 */

const GUILD = "100000000000000001";
const MIGRATION = "20261025120000_message_template_in_tickets";
const migrations = resolve(import.meta.dirname, "../../../packages/db/prisma/migrations");

let dir: string;
let prisma: any;
let handleMessages: typeof import("../dist/control/messages.js").handleMessages;

const guild = { id: GUILD, name: "Test guild" };

async function call(method: string, segments: string[], body?: unknown) {
  return (await handleMessages({ guild: guild as never, method, segments, body })) as { status: number; body: any };
}

describe("the migration", () => {
  test("adds a flag that is off for every template that already exists", () => {
    const entries = readdirSync(migrations).filter((entry) => entry !== "migration_lock.toml").sort();
    assert.ok(entries.includes(MIGRATION), "the migration is in the folder");
    const db = new DatabaseSync(":memory:");
    try {
      for (const entry of entries.filter((name) => name < MIGRATION)) db.exec(readFileSync(join(migrations, entry, "migration.sql"), "utf8"));
      db.exec(`INSERT INTO "Guild" ("id", "name") VALUES ('${GUILD}', 'Old')`);
      db.exec(`INSERT INTO "MessageTemplate" ("guildId", "name", "updatedAt") VALUES ('${GUILD}', 'Before the flag', CURRENT_TIMESTAMP)`);
      db.exec(readFileSync(join(migrations, MIGRATION, "migration.sql"), "utf8"));
      assert.equal((db.prepare(`SELECT "inTickets" AS flag FROM "MessageTemplate"`).get() as { flag: number }).flag, 0);
      db.exec(`INSERT INTO "MessageTemplate" ("guildId", "name", "inTickets", "updatedAt") VALUES ('${GUILD}', 'After', 1, CURRENT_TIMESTAMP)`);
      assert.equal((db.prepare(`SELECT count(*) AS n FROM "MessageTemplate" WHERE "inTickets" = 1`).get() as { n: number }).n, 1);
    } finally {
      db.close();
    }
  });
});

describe("the template routes", () => {
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "tier0-intickets-api-"));
    const dbPath = join(dir, "test.db");
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
    ({ handleMessages } = await import("../dist/control/messages.js"));
    await prisma.guild.create({ data: { id: GUILD, name: "Test guild" } });
  });

  after(async () => {
    await prisma?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a new template is not offered in tickets unless asked", async () => {
    const plain = await call("POST", ["templates"], { name: "Plain", content: "hello" });
    assert.equal(plain.status, 200);
    assert.equal(plain.body.inTickets, false);
    const flagged = await call("POST", ["templates"], { name: "Flagged", content: "hello", inTickets: true });
    assert.equal(flagged.status, 200);
    assert.equal(flagged.body.inTickets, true);
  });

  test("the library lists the flag", async () => {
    const listing = await call("GET", []);
    const byName = Object.fromEntries(listing.body.templates.map((t: { name: string; inTickets: boolean }) => [t.name, t.inTickets]));
    assert.deepEqual(byName, { Plain: false, Flagged: true });
  });

  test("changing only the flag leaves the message alone", async () => {
    const id = (await prisma.messageTemplate.findFirstOrThrow({ where: { name: "Plain" } })).id as number;
    const reply = await call("PATCH", ["templates", String(id)], { inTickets: true });
    assert.equal(reply.status, 200);
    assert.equal(reply.body.inTickets, true);
    assert.equal(reply.body.content, "hello");
    const off = await call("PATCH", ["templates", String(id)], { inTickets: false });
    assert.equal(off.body.inTickets, false);
  });

  test("an update that does not mention it keeps what the template had", async () => {
    const id = (await prisma.messageTemplate.findFirstOrThrow({ where: { name: "Flagged" } })).id as number;
    const reply = await call("PATCH", ["templates", String(id)], { content: "changed" });
    assert.equal(reply.status, 200);
    assert.equal(reply.body.inTickets, true);
    assert.equal(reply.body.content, "changed");
  });

  test("anything but on or off is refused", async () => {
    const id = (await prisma.messageTemplate.findFirstOrThrow({ where: { name: "Flagged" } })).id as number;
    for (const bad of ["yes", 1, null, {}]) {
      assert.equal((await call("PATCH", ["templates", String(id)], { inTickets: bad })).status, 400, String(bad));
      assert.equal((await call("POST", ["templates"], { name: "Bad", content: "x", inTickets: bad })).status, 400, String(bad));
    }
  });
});
