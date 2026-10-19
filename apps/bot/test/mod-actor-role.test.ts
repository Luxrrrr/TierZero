import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The moderation routes take the account that is acting from the dashboard and
 * work out its place on the staff list themselves. These run against a real
 * database, since the staff list is where the answer comes from.
 */

const GUILD = "100000000000000001";
const OWNER = "900000000000000001";
const ADMIN = "900000000000000002";
const MOD = "900000000000000003";
const STRANGER = "900000000000000004";
const TARGET = "900000000000000005";

let dir: string;
let handleMod: typeof import("../dist/control/mod/index.js").handleMod;
let prisma: { $disconnect(): Promise<void> } & Record<string, any>;
let request: (overrides: Record<string, unknown>) => Parameters<typeof handleMod>[0];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "tier0-mod-role-"));
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

  prisma = (await import("@tier0/db")).prisma as never;
  await prisma.guild.create({ data: { id: GUILD, name: "Test guild" } });
  await prisma.staffMember.create({ data: { guildId: GUILD, userId: ADMIN, role: "admin", addedBy: OWNER } });
  await prisma.staffMember.create({ data: { guildId: GUILD, userId: MOD, role: "mod", addedBy: OWNER } });

  ({ handleMod } = await import("../dist/control/mod/index.js"));
  const { ModuleRegistry } = await import("@tier0/core");
  const { GuildState } = await import("../dist/runtime/guild-state.js");
  const state = new GuildState({} as never, new ModuleRegistry());
  const guild = { id: GUILD, ownerId: "1", members: { cache: new Map(), fetch: async () => null }, channels: { cache: new Map() } };
  const client = { users: { cache: new Map(), fetch: async () => null }, guilds: { cache: new Map() } };
  request = (overrides) => ({ client: client as never, guild: guild as never, state, method: "GET", segments: [], query: new URLSearchParams(), body: undefined, ...overrides });
});

after(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const asActor = (userId: string, role: string) => ({ actor: { userId, name: "Someone", role }, content: "A note" });

describe("who is acting on a moderation write", () => {
  test("a request that claims to be the owner is refused when the account is not on the staff list", async () => {
    const reply = await handleMod(request({ method: "POST", segments: ["members", TARGET, "notes"], body: asActor(STRANGER, "owner") }));
    assert.equal(reply?.status, 403);
  });

  test("a moderator who claims to be an owner is treated as the moderator they are", async () => {
    // Purging a case is an owner-only act. The claim of owner changes nothing.
    const reply = await handleMod(request({ method: "DELETE", segments: ["infractions", "1"], query: new URLSearchParams("purge=1"), body: asActor(MOD, "owner") }));
    assert.equal(reply?.status, 403);
  });

  test("a request with no account at all is refused", async () => {
    const reply = await handleMod(request({ method: "POST", segments: ["members", TARGET, "notes"], body: { content: "x" } }));
    assert.equal(reply?.status, 400);
  });

  test("a listed staff member gets past the check", async () => {
    const reply = await handleMod(request({ method: "POST", segments: ["members", TARGET, "notes"], body: asActor(ADMIN, "mod") }));
    assert.notEqual(reply?.status, 403);
    assert.notEqual(reply?.status, 400);
  });

  test("the install owner is let in whether or not they are listed", async () => {
    const reply = await handleMod(request({ method: "POST", segments: ["members", TARGET, "notes"], body: asActor(OWNER, "mod") }));
    assert.notEqual(reply?.status, 403);
  });
});

describe("who is asking on a moderation read", () => {
  test("an owner and role named in the query do not help an account that is not staff", async () => {
    for (const segments of [["server-logs"], ["messages"], ["members", TARGET, "messages"], ["members", TARGET, "standing"]]) {
      const reply = await handleMod(request({ segments, query: new URLSearchParams({ viewer: STRANGER, owner: "1", role: "owner" }) }));
      assert.equal(reply?.status, 403, segments.join("/"));
    }
  });

  test("a read that names no viewer is refused", async () => {
    const reply = await handleMod(request({ segments: ["server-logs"], query: new URLSearchParams({ owner: "1", role: "owner" }) }));
    assert.equal(reply?.status, 403);
  });

  test("a listed moderator is let through to the log", async () => {
    const reply = await handleMod(request({ segments: ["messages"], query: new URLSearchParams({ viewer: MOD, owner: "1", role: "owner" }) }));
    assert.notEqual(reply?.status, 403);
  });
});
