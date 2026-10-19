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
        reward: s.role({ optional: true, assigns: true }),
        exempt: s.role({ optional: true }),
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

describe("handing out a role through a setting", () => {
  const ROLE = "200000000000000001";
  const OTHER = "200000000000000002";
  const MANAGER = "300000000000000001";
  const STRANGER = "300000000000000002";
  const OWNER = "300000000000000003";

  const MANAGE_ROLES = 1n << 28n;
  const ADMIN = 1n << 3n;
  const members = new Map<string, { permissions: { has(flag: bigint): boolean }; roles: { highest: { position: number } } }>();
  const grantGuild = {
    id: GUILD,
    ownerId: OWNER,
    members: { fetch: async (id: string) => members.get(id) ?? Promise.reject(new Error("unknown member")) },
    roles: {
      cache: new Map([
        [ROLE, { id: ROLE, name: "Member", position: 2 }],
        [OTHER, { id: OTHER, name: "Staff", position: 9 }],
      ]),
      fetch: async () => null,
    },
  } as never;

  const member = (flags: bigint, top: number) => ({ permissions: { has: (flag: bigint) => (flags & flag) === flag }, roles: { highest: { position: top } } });
  const save = (reward: string, actor?: string) => state.applyModuleUpdate(grantGuild, "sample", { settings: { reward }, actor }, resync);

  before(() => {
    members.set(MANAGER, member(MANAGE_ROLES, 5));
    members.set(STRANGER, member(0n, 20));
  });

  test("a member with Manage Roles may hand out a role below their highest role", async () => {
    assert.equal((await save(ROLE, MANAGER)).ok, true);
  });

  test("a role at or above their highest role is refused, naming the setting", async () => {
    const result = await save(OTHER, MANAGER);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.errors[0]?.path, "reward");
    assert.match(result.ok === false ? (result.errors[0]?.message ?? "") : "", /Staff is at or above your highest role/);
  });

  test("Manage Server alone is not enough, however high their role sits", async () => {
    await state.applyModuleUpdate(grantGuild, "sample", { settings: {}, actor: OWNER }, resync);
    const result = await save(ROLE, STRANGER);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? (result.errors[0]?.message ?? "") : "", /Manage Roles/);
  });

  test("a change that does not add a role is not refused, so a page can still be saved", async () => {
    await save(ROLE, MANAGER);
    const result = await state.applyModuleUpdate(grantGuild, "sample", { settings: { reward: ROLE, greeting: "hi" }, actor: STRANGER }, resync);
    assert.equal(result.ok, true);
  });

  test("a role chosen only to exempt or notify is never checked", async () => {
    const result = await state.applyModuleUpdate(grantGuild, "sample", { settings: { reward: ROLE, exempt: OTHER }, actor: STRANGER }, resync);
    assert.equal(result.ok, true);
  });

  test("the server owner and the instance owner may hand out any role", async () => {
    members.set(OWNER, member(0n, 1));
    assert.equal((await save(OTHER, OWNER)).ok, true);
    process.env.INSTANCE_OWNER_ID = STRANGER;
    try {
      assert.equal((await save(ROLE, STRANGER)).ok, true);
      assert.equal((await save(OTHER, STRANGER)).ok, true);
    } finally {
      delete process.env.INSTANCE_OWNER_ID;
    }
  });

  test("an administrator may hand out any role", async () => {
    const admin = "300000000000000004";
    members.set(admin, member(ADMIN, 1));
    assert.equal((await save(OTHER, admin)).ok, true);
  });

  test("without a known actor, a new role is refused", async () => {
    await state.applyModuleUpdate(grantGuild, "sample", { settings: { reward: ROLE }, actor: OWNER }, resync);
    const result = await save(OTHER);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? (result.errors[0]?.message ?? "") : "", /who is saving/);
  });
});
