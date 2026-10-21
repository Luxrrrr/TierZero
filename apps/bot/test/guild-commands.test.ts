import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SlashCommandBuilder } from "discord.js";

/**
 * Commands a server's own settings add are registered in that server only, and
 * can never take the name of a command that comes with the bot.
 */

const GUILD = "100000000000000001";
const OTHER = "100000000000000002";
let dir: string;
let prisma: { $disconnect(): Promise<void> } & Record<string, never>;
let sync: import("../dist/runtime/commands.js").CommandSync;
let state: import("../dist/runtime/guild-state.js").GuildState;
const puts: { route: string; body: { name: string }[] }[] = [];

const command = (name: string) => ({
  name,
  description: `Made up: ${name}`,
  build: () => new SlashCommandBuilder().setName(name).setDescription(`Made up: ${name}`),
  async run() {},
});

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "tier0-guildcmd-"));
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
  const client = prisma as never as {
    guild: { create(a: unknown): Promise<unknown> };
    guildModule: { create(a: unknown): Promise<unknown> };
  };
  await client.guild.create({ data: { id: GUILD, name: "Made-up commands" } });
  await client.guild.create({ data: { id: OTHER, name: "Another server" } });
  await client.guildModule.create({ data: { guildId: GUILD, moduleId: "maker", enabled: true, settings: JSON.stringify({ names: ["rules", "rank", "rules", "help"] }) } });
  await client.guildModule.create({ data: { guildId: OTHER, moduleId: "maker", enabled: false, settings: JSON.stringify({ names: ["secret"] }) } });

  const { ModuleRegistry, defineModule, s } = await import("@tier0/core");
  const { GuildState } = await import("../dist/runtime/guild-state.js");
  const { CommandSync } = await import("../dist/runtime/commands.js");

  const registry = new ModuleRegistry();
  registry.register(
    defineModule({
      id: "sample",
      name: "Sample",
      summary: "Has a command of its own.",
      alwaysOn: true,
      settings: s.object({}),
      commands: [command("rank")],
    }),
  );
  registry.register(
    defineModule({
      id: "maker",
      name: "Maker",
      summary: "Makes commands from its settings.",
      settings: s.object({ names: s.array(s.string()) }),
      guildCommands: (settings) => settings.names.map(command),
    }),
  );
  state = new GuildState({} as never, registry);
  const rest = {
    put: async (route: string, options: { body: { name: string }[] }) => {
      puts.push({ route, body: options.body });
    },
  };
  sync = new CommandSync(rest as never, "999999999999999999", registry, state);
  sync.schedule = () => undefined;
});

after(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("a server's own commands", () => {
  test("are the ones its settings make, without a repeat or a name the bot already uses", async () => {
    const found = await state.guildCommands(GUILD);
    assert.deepEqual(
      found.map((entry) => entry.command.name),
      ["rules", "help"],
    );
    assert.ok(found.every((entry) => entry.module.id === "maker"));
  });

  test("are none while the feature that makes them is off", async () => {
    assert.deepEqual(await state.guildCommands(OTHER), []);
  });

  test("are registered with the server's other commands, and only in that server", async () => {
    await sync.run(GUILD);
    await sync.run(OTHER);
    const names = (index: number) => puts[index]?.body.map((entry) => entry.name).sort();
    assert.deepEqual(names(0), ["help", "rank", "rules"]);
    assert.deepEqual(names(1), ["rank"]);
  });

  test("follow a change to the settings once the cache is dropped", async () => {
    const client = prisma as never as { guildModule: { update(a: unknown): Promise<unknown> } };
    await client.guildModule.update({
      where: { guildId_moduleId: { guildId: GUILD, moduleId: "maker" } },
      data: { settings: JSON.stringify({ names: ["welcome"] }) },
    });
    state.invalidate(GUILD);
    assert.deepEqual(
      (await state.guildCommands(GUILD)).map((entry) => entry.command.name),
      ["welcome"],
    );
  });
});
