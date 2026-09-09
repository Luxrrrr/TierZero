import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Exercises the write path against a real database instead of a stub. The
 * bugs worth catching here are in what actually reaches storage: whether a
 * row is created when none existed, whether stored settings that no longer
 * validate still let a module be switched off, and whether the cache the
 * router reads is dropped when a write lands.
 *
 * The schema is built by replaying the committed migrations into a scratch
 * file, so this fails if a migration stops applying cleanly.
 */

const GUILD = "100000000000000001";
let dir: string;
let state: import("../dist/runtime/guild-state.js").GuildState;
let prisma: { $disconnect(): Promise<void>; guild: { create(a: unknown): Promise<unknown> } };
let scheduled: string[] = [];

const resync = { schedule: (guildId: string) => void scheduled.push(guildId) };

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "tier0-test-"));
  const dbPath = join(dir, "test.db");

  const migrations = resolve(import.meta.dirname, "../../../packages/db/prisma/migrations");
  const db = new DatabaseSync(dbPath);
  for (const entry of readdirSync(migrations).sort()) {
    const sql = join(migrations, entry, "migration.sql");
    try {
      db.exec(readFileSync(sql, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  db.close();

  // Prisma wants forward slashes in the URL even on Windows.
  process.env.DATABASE_URL = "file:" + dbPath.split(String.fromCharCode(92)).join("/");

  const dbModule = await import("@tier0/db");
  prisma = dbModule.prisma as never;
  await (prisma as never as { guild: { create(a: unknown): Promise<unknown> } }).guild.create({
    data: { id: GUILD, name: "Test guild" },
  });

  const { ModuleRegistry, defineModule, s } = await import("@tier0/core");
  const { GuildState } = await import("../dist/runtime/guild-state.js");

  const registry = new ModuleRegistry();
  registry.register(
    defineModule({
      id: "sample",
      name: "Sample",
      summary: "Used by the write path tests.",
      settings: s.object({
        greeting: s.string({ default: "hello" }),
        channel: s.channel({ optional: true }),
      }),
    }),
  );

  state = new GuildState({} as never, registry);
});

after(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const guild = { id: GUILD } as never;

describe("applyModuleUpdate", () => {
  test("creates the row when a module has never been configured", async () => {
    scheduled = [];
    const result = await state.applyModuleUpdate(guild, "sample", { enabled: true }, resync);
    assert.equal(result.ok, true);

    const modules = await state.enabledModules(GUILD);
    assert.deepEqual(
      modules.map((m) => m.id),
      ["sample"],
    );
    assert.deepEqual(scheduled, [GUILD]);
  });

  test("persists a settings patch and fills defaults", async () => {
    const result = await state.applyModuleUpdate(
      guild,
      "sample",
      { settings: { greeting: "welcome" } },
      resync,
    );
    assert.equal(result.ok, true);

    const ctx = await state.context(guild, "sample");
    assert.equal((ctx?.settings as { greeting: string }).greeting, "welcome");
  });

  test("rejects settings that fail validation, naming the field", async () => {
    const result = await state.applyModuleUpdate(
      guild,
      "sample",
      { settings: { greeting: "ok", channel: "not-a-snowflake" } },
      resync,
    );
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.errors[0]?.path, "channel");
  });

  test("leaves the stored value alone when a write is rejected", async () => {
    const ctx = await state.context(guild, "sample");
    assert.equal((ctx?.settings as { greeting: string }).greeting, "welcome");
  });

  test("refuses an unknown module", async () => {
    const result = await state.applyModuleUpdate(guild, "ghost", { enabled: true }, resync);
    assert.equal(result.ok, false);
  });

  test("drops the cache so the next read sees the write", async () => {
    await state.applyModuleUpdate(guild, "sample", { settings: { greeting: "third" } }, resync);
    const ctx = await state.context(guild, "sample");
    assert.equal((ctx?.settings as { greeting: string }).greeting, "third");
  });

  test("can disable a module whose stored settings no longer validate", async () => {
    // Write past the schema the way a module version change would.
    await (
      prisma as never as {
        guildModule: { update(a: unknown): Promise<unknown> };
      }
    ).guildModule.update({
      where: { guildId_moduleId: { guildId: GUILD, moduleId: "sample" } },
      data: { settings: JSON.stringify({ channel: "broken" }) },
    });
    state.invalidate(GUILD);

    const result = await state.applyModuleUpdate(guild, "sample", { enabled: false }, resync);
    assert.equal(result.ok, true, "an enabled-only patch must not revalidate stored settings");

    assert.equal(await state.isEnabled(GUILD, "sample"), false);
  });
});
