import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * A built-in module has no switch and no row to say it is on. These run against
 * a scratch database, because what matters is what the guild state reads from
 * storage when nothing was ever written: the system module must still count as
 * on, and saving its settings must not be able to turn it off.
 */

const GUILD = "100000000000000001";
let dir: string;
let state: import("../dist/runtime/guild-state.js").GuildState;
let prisma: { $disconnect(): Promise<void>; guild: { create(a: unknown): Promise<unknown> }; guildModule: { findUnique(a: unknown): Promise<{ enabled: boolean } | null> } };

const resync = { schedule: () => undefined };
const guild = { id: GUILD } as never;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "tier0-always-"));
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

  prisma = (await import("@tier0/db")).prisma as never;
  await prisma.guild.create({ data: { id: GUILD, name: "Test guild" } });

  const { ModuleRegistry, defineModule, s } = await import("@tier0/core");
  const { GuildState } = await import("../dist/runtime/guild-state.js");
  const system = (await import("@tier0/module-system")).default;

  const registry = new ModuleRegistry();
  registry.register(system);
  registry.register(defineModule({ id: "sample", name: "Sample", summary: "A feature.", settings: s.object({ greeting: s.string({ default: "hello" }) }) }));
  state = new GuildState({} as never, registry);
});

after(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("a module that is always on", () => {
  test("counts as enabled in a server that never configured anything", async () => {
    assert.equal(await state.isEnabled(GUILD, "system"), true);
    assert.equal(await state.isEnabled(GUILD, "sample"), false);
  });

  test("is among the enabled modules without a row", async () => {
    assert.deepEqual(
      (await state.enabledModules(GUILD)).map((module) => module.id),
      ["system"],
    );
  });

  test("is listed as enabled for the dashboard", async () => {
    const listed = await state.describeForGuild(GUILD);
    assert.equal(listed.find((entry) => entry.id === "system")?.enabled, true);
    assert.equal(listed.find((entry) => entry.id === "system")?.alwaysOn, true);
    assert.equal(listed.find((entry) => entry.id === "sample")?.enabled, false);
  });

  test("gives its settings at the defaults before anything is saved", async () => {
    const settings = await state.systemSettings(GUILD);
    assert.equal(settings?.replies.commands.featureOff.embeds[0]?.description, "That feature is switched off on this server.");
    assert.equal(settings?.labels.webhookName, "TierZero messages");
  });

  test("saves settings and reads them back, still on", async () => {
    const result = await state.applyModuleUpdate(
      guild,
      "system",
      { settings: { labels: { webhookName: "Announcements" } } },
      resync,
    );
    assert.equal(result.ok, true);
    assert.equal((await state.systemSettings(GUILD))?.labels.webhookName, "Announcements");
    assert.equal(await state.isEnabled(GUILD, "system"), true);
  });

  test("is stored as on, whatever was asked", async () => {
    const result = await state.applyModuleUpdate(guild, "system", { enabled: false, settings: {} }, resync);
    assert.equal(result.ok, true);
    assert.equal(await state.isEnabled(GUILD, "system"), true);
    const row = await prisma.guildModule.findUnique({ where: { guildId_moduleId: { guildId: GUILD, moduleId: "system" } } });
    assert.equal(row?.enabled, true);
  });

  test("a feature next to it is still switched on and off as usual", async () => {
    await state.applyModuleUpdate(guild, "sample", { enabled: true }, resync);
    assert.deepEqual(
      (await state.enabledModules(GUILD)).map((module) => module.id).sort(),
      ["sample", "system"],
    );
    await state.applyModuleUpdate(guild, "sample", { enabled: false }, resync);
    assert.deepEqual(
      (await state.enabledModules(GUILD)).map((module) => module.id),
      ["system"],
    );
  });

  test("falls back to the defaults when the stored settings no longer validate", async () => {
    await (prisma as never as { guildModule: { update(a: unknown): Promise<unknown> } }).guildModule.update({
      where: { guildId_moduleId: { guildId: GUILD, moduleId: "system" } },
      data: { settings: JSON.stringify({ labels: { webhookName: "x".repeat(200) } }) },
    });
    state.invalidate(GUILD);
    const original = console.error;
    console.error = () => undefined;
    try {
      const settings = await state.systemSettings(GUILD);
      assert.equal(settings?.labels.webhookName, "TierZero messages");
    } finally {
      console.error = original;
    }
  });
});
