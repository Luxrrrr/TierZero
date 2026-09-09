import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Deferred work is what a temporary ban relies on to ever be lifted, so the
 * guarantees worth checking are that a due row runs once, that a handler which
 * throws does not leave a row behind to be retried on every tick from then on,
 * and that a module switched off does not keep running work it queued earlier.
 */

const GUILD = "100000000000000002";

let dir: string;
let prisma: { $disconnect(): Promise<void> } & Record<string, never>;
let makeScheduler: () => { tick(now?: Date): Promise<void> };
let invalidate: (guildId: string) => void;
let ran: Record<string, unknown>[] = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "tier0-sched-"));
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
  await prisma.guild.create({ data: { id: GUILD, name: "Scheduler test guild" } });

  const { ModuleRegistry, defineModule, s } = await import("@tier0/core");
  const { GuildState } = await import("../dist/runtime/guild-state.js");
  const { Scheduler } = await import("../dist/runtime/scheduler.js");

  const registry = new ModuleRegistry();
  registry.register(
    defineModule({
      id: "sample",
      name: "Sample",
      summary: "Used by the scheduler tests.",
      settings: s.object({ note: s.string({ default: "x" }) }),
      tasks: {
        async remember(payload) {
          ran.push(payload);
        },
        async explode() {
          throw new Error("handler failed on purpose");
        },
      },
    }),
  );

  // The runner only asks the client for the guild an item of work belongs to.
  const client = { guilds: { cache: new Map([[GUILD, { id: GUILD }]]) } } as never;
  const state = new GuildState(client, registry);
  invalidate = (guildId) => state.invalidate(guildId);
  makeScheduler = () => new Scheduler(client, registry, state);
});

after(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  ran = [];
});

async function setEnabled(enabled: boolean) {
  await prisma.guildModule.upsert({
    where: { guildId_moduleId: { guildId: GUILD, moduleId: "sample" } },
    create: { guildId: GUILD, moduleId: "sample", enabled, settings: "{}" },
    update: { enabled },
  });
  invalidate(GUILD);
}

async function queue(kind: string, runAt: Date, payload: Record<string, unknown> = {}) {
  await prisma.scheduledTask.create({
    data: { guildId: GUILD, kind: `sample:${kind}`, runAt, payload: JSON.stringify(payload) },
  });
}

const pending = (): Promise<number> => prisma.scheduledTask.count();
const past = () => new Date(Date.now() - 1000);

describe("Scheduler", () => {
  test("runs work that is due and removes the row", async () => {
    await setEnabled(true);
    await queue("remember", past(), { userId: "1" });

    await makeScheduler().tick();

    assert.deepEqual(ran, [{ userId: "1" }]);
    assert.equal(await pending(), 0);
  });

  test("leaves work that is not due yet", async () => {
    await setEnabled(true);
    await queue("remember", new Date(Date.now() + 60_000), { userId: "2" });

    await makeScheduler().tick();

    assert.equal(ran.length, 0);
    assert.equal(await pending(), 1);
    await prisma.scheduledTask.deleteMany();
  });

  test("does not retry a handler that throws", async () => {
    await setEnabled(true);
    await queue("explode", past());

    await makeScheduler().tick();

    assert.equal(await pending(), 0, "a failing handler must not leave its row behind");
  });

  test("skips work for a module that is switched off", async () => {
    await setEnabled(false);
    await queue("remember", past(), { userId: "3" });

    await makeScheduler().tick();

    assert.equal(ran.length, 0);
    await prisma.scheduledTask.deleteMany();
  });

  test("ignores a kind no module claims", async () => {
    await setEnabled(true);
    await prisma.scheduledTask.create({
      data: { guildId: GUILD, kind: "ghost:vanish", runAt: past(), payload: "{}" },
    });

    await makeScheduler().tick();

    assert.equal(await pending(), 0, "an unclaimed row is dropped, not retried forever");
  });
});
