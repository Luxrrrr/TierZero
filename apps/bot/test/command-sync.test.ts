import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SlashCommandBuilder } from "discord.js";

/**
 * Both channel lists of a command share one column, so a write to one must not
 * lose the other, and what the router reads back has to be what was saved. The
 * overview's count of commands in Discord comes from the last registration,
 * which has to say how many went through and why one failed.
 */

const GUILD = "100000000000000001";
let dir: string;
let prisma: { $disconnect(): Promise<void> } & Record<string, never>;
let sync: import("../dist/runtime/commands.js").CommandSync;
let state: import("../dist/runtime/guild-state.js").GuildState;
let failNext: Error | null = null;
const puts: unknown[][] = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "tier0-cmd-"));
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
  await (prisma as never as { guild: { create(a: unknown): Promise<unknown> } }).guild.create({ data: { id: GUILD, name: "Command test guild" } });

  const { ModuleRegistry, defineModule, s } = await import("@tier0/core");
  const { GuildState } = await import("../dist/runtime/guild-state.js");
  const { CommandSync } = await import("../dist/runtime/commands.js");

  const registry = new ModuleRegistry();
  registry.register(
    defineModule({
      id: "sample",
      name: "Sample",
      summary: "Used by the command sync tests.",
      settings: s.object({}),
      commands: [
        {
          name: "rank",
          description: "Shows a rank",
          build: () => new SlashCommandBuilder().setName("rank").setDescription("Shows a rank"),
          async run() {},
        },
      ],
    }),
  );
  state = new GuildState({} as never, registry);
  const rest = {
    put: async (_route: string, options: { body: unknown[] }) => {
      if (failNext) {
        const error = failNext;
        failNext = null;
        throw error;
      }
      puts.push(options.body);
    },
  };
  sync = new CommandSync(rest as never, "999999999999999999", registry, state);
  // The debounced registration would fire after the scratch database is gone; the tests run it themselves.
  sync.schedule = () => undefined;
});

after(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("channel rules on a command", () => {
  test("setting one list keeps the other", async () => {
    await sync.setOverride(GUILD, "rank", { allowChannels: ["200000000000000001"] });
    await sync.setOverride(GUILD, "rank", { denyChannels: ["200000000000000002"] });
    const policy = await state.commandPolicy(GUILD, "rank");
    assert.deepEqual(policy.allowChannels, ["200000000000000001"]);
    assert.deepEqual(policy.denyChannels, ["200000000000000002"]);
  });

  test("the dashboard reads both back", async () => {
    const sample = (await state.describeForGuild(GUILD)).find((module) => module.id === "sample");
    const rank = sample?.commands.find((command) => command.name === "rank");
    assert.deepEqual(rank?.allowChannels, ["200000000000000001"]);
    assert.deepEqual(rank?.denyChannels, ["200000000000000002"]);
  });

  test("clearing the allow list goes back to the plain list older versions read", async () => {
    await sync.setOverride(GUILD, "rank", { allowChannels: [] });
    const row = await (prisma as never as { commandOverride: { findUnique(a: unknown): Promise<{ denyChannels: string } | null> } }).commandOverride.findUnique({
      where: { guildId_command: { guildId: GUILD, command: "rank" } },
    });
    assert.equal(row?.denyChannels, '["200000000000000002"]');
  });
});

describe("the last registration", () => {
  test("is unknown before the first one", () => {
    assert.deepEqual(sync.status("100000000000000009"), { registered: null, pending: false, failed: null });
  });

  test("counts only the commands of features that are on", async () => {
    await sync.run(GUILD);
    assert.equal(sync.status(GUILD).registered, 0);

    await (prisma as never as { guildModule: { create(a: unknown): Promise<unknown> } }).guildModule.create({
      data: { guildId: GUILD, moduleId: "sample", enabled: true, settings: "{}" },
    });
    state.invalidate(GUILD);
    await sync.run(GUILD);
    assert.deepEqual(sync.status(GUILD), { registered: 1, pending: false, failed: null });
  });

  test("says why it failed and keeps the last good count", async () => {
    failNext = new Error("Missing Access");
    await assert.rejects(() => sync.run(GUILD));
    assert.deepEqual(sync.status(GUILD), { registered: 1, pending: false, failed: "Missing Access" });
  });
});
