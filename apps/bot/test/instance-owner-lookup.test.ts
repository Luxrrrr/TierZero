import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Who owns the install is decided in one place, @tier0/db, and the dashboard,
 * the bot and the moderation module all ask it. This is the rule they share.
 */

let dir: string;
let prisma: { $disconnect(): Promise<void>; instance: { upsert(args: unknown): Promise<unknown>; deleteMany(): Promise<unknown> } };
let instanceOwnerId: () => Promise<string | null>;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "tier0-owner-"));
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
  delete process.env.INSTANCE_OWNER_ID;
  const db2 = await import("@tier0/db");
  prisma = db2.prisma as never;
  instanceOwnerId = db2.instanceOwnerId;
});

after(async () => {
  delete process.env.INSTANCE_OWNER_ID;
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("instanceOwnerId", () => {
  test("is nobody until the bot has recorded an owner", async () => {
    assert.equal(await instanceOwnerId(), null);
  });

  test("is the owner the bot recorded", async () => {
    await prisma.instance.upsert({ where: { id: 1 }, create: { id: 1, ownerId: "900000000000000001" }, update: { ownerId: "900000000000000001" } });
    assert.equal(await instanceOwnerId(), "900000000000000001");
  });

  test("INSTANCE_OWNER_ID wins over what was recorded", async () => {
    process.env.INSTANCE_OWNER_ID = "900000000000000002";
    try {
      assert.equal(await instanceOwnerId(), "900000000000000002");
    } finally {
      delete process.env.INSTANCE_OWNER_ID;
    }
    assert.equal(await instanceOwnerId(), "900000000000000001");
  });
});
