import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The migration that brought per-server ticket numbers, run against a
 * database holding what an install had before it: tickets in two servers, a
 * deleted transcript, a server set up before panels were tracked, and a new
 * server that never posted anything.
 */

const MIGRATIONS = resolve(import.meta.dirname, "../../../db/prisma/migrations");
const THIS = "20261021120000_ticket_numbers";

function before(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const entry of readdirSync(MIGRATIONS).sort()) {
    if (entry === THIS || entry.endsWith(".toml")) continue;
    db.exec(readFileSync(join(MIGRATIONS, entry, "migration.sql"), "utf8"));
  }
  for (const id of ["g-old", "g-new", "g-saved"]) db.exec(`INSERT INTO "Guild" ("id", "name") VALUES ('${id}', 'x')`);
  db.exec(`INSERT INTO "GuildModule" ("guildId", "moduleId", "settings", "updatedAt") VALUES
    ('g-old', 'tickets', '{"panel":{"channel":"111111111111111111"}}', 0),
    ('g-new', 'tickets', '{}', 0),
    ('g-saved', 'tickets', '{"panels":[{"id":"default","channel":"333333333333333333"}]}', 0)`);
  // What the overhaul migration leaves on an old ticket is the default panel; a new server's tickets come from a panel of its own.
  db.exec(`INSERT INTO "Ticket" ("guildId", "channelId", "openerId", "typeId", "panelId") VALUES
    ('g-old', 'c1', 'opener', 'support', 'default'), ('g-new', 'c2', 'opener', 'support', 'main'), ('g-old', 'c3', 'opener', 'support', 'default'), ('g-saved', 'c4', 'opener', 'support', 'default')`);
  db.exec(`INSERT INTO "TicketMessage" ("ticketId", "messageId", "authorId", "authorName") VALUES (1, 'm1', 'opener', 'o'), (1, 'm2', 'staff', 's')`);
  db.exec(`UPDATE "Ticket" SET "firstResponseAt" = 1 WHERE "id" = 1`);
  db.exec(`INSERT INTO "TicketAudit" ("guildId", "actorId", "actorName", "kind", "ticketId") VALUES ('g-old', 'lux', 'Lux', 'transcript.delete', 3)`);
  return db;
}

const run = (db: DatabaseSync) => db.exec(readFileSync(join(MIGRATIONS, THIS, "migration.sql"), "utf8"));
const rows = (db: DatabaseSync, sql: string) => db.prepare(sql).all() as Record<string, unknown>[];

describe("the ticket numbers migration", () => {
  test("numbers existing tickets per server in the order they opened", () => {
    const db = before();
    run(db);
    assert.deepEqual(
      rows(db, `SELECT "id", "number" FROM "Ticket" ORDER BY "id"`).map((row) => [row.id, row.number]),
      [
        [1, 1],
        [2, 1],
        [3, 2],
        [4, 1],
      ],
    );
  });

  test("keeps who answered first and who deleted a transcript", () => {
    const db = before();
    run(db);
    const [first] = rows(db, `SELECT "firstResponderId" FROM "Ticket" WHERE "id" = 1`);
    assert.equal(first?.firstResponderId, "staff");
    const [deleted] = rows(db, `SELECT "transcriptDeletedByName", "transcriptDeletedById" FROM "Ticket" WHERE "id" = 3`);
    assert.equal(deleted?.transcriptDeletedByName, "Lux");
    assert.equal(deleted?.transcriptDeletedById, "lux");
  });

  test("marks the old panel only where the old version really ran", () => {
    const db = before();
    run(db);
    const marks = rows(db, `SELECT "guildId", "channelId", "messageId" FROM "TicketPanelPost" ORDER BY "guildId"`);
    assert.deepEqual(
      marks.map((row) => [row.guildId, row.channelId, row.messageId]),
      [
        ["g-old", "111111111111111111", ""],
        ["g-saved", "333333333333333333", ""],
      ],
    );
  });

  test("filling in again changes nothing", () => {
    const db = before();
    run(db);
    const backfill = readFileSync(join(MIGRATIONS, THIS, "migration.sql"), "utf8")
      .split(";")
      .filter((statement) => !/ALTER TABLE|CREATE UNIQUE INDEX/.test(statement))
      .join(";");
    const snapshot = () => JSON.stringify([rows(db, `SELECT * FROM "Ticket" ORDER BY "id"`), rows(db, `SELECT "guildId", "panelId" FROM "TicketPanelPost"`)]);
    const once = snapshot();
    db.exec(backfill);
    assert.equal(snapshot(), once);
  });

  test("two tickets in one server cannot share a number", () => {
    const db = before();
    run(db);
    assert.throws(() => db.exec(`UPDATE "Ticket" SET "number" = 1 WHERE "id" = 3`), /UNIQUE/);
  });
});
