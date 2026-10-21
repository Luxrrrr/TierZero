import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Collection, Events, MessageFlags } from "discord.js";
import { ModuleRegistry, readSelects } from "@tier0/core";
import system, { type SystemSettings } from "@tier0/module-system";

/** A menu that allows several choices answers each one, and a reply can go to the person as a direct message. */

const GUILD = "900000000000000001";
const CHANNEL = "910000000000000001";
const MESSAGE = "920000000000000001";

let dir: string;
let prisma: typeof import("@tier0/db").prisma;
let register: typeof import("../dist/runtime/message-components.js").registerMessageComponents;

const registry = new ModuleRegistry();
registry.register(system);
const resolved = registry.resolveSettings("system", {});
assert.ok(resolved.ok);
const source = { systemSettings: async () => resolved.value as SystemSettings };

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "tier0-menu-"));
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
  ({ prisma } = await import("@tier0/db"));
  ({ registerMessageComponents: register } = await import("../dist/runtime/message-components.js"));
  await prisma.guild.create({ data: { id: GUILD, name: "Test" } });
});

after(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const option = (value: string, title: string, dm = false) => ({
  label: title,
  value,
  description: "",
  emoji: "",
  default: false,
  action: { type: "reply", reply: { content: "", embeds: [{ title, description: `About ${title}` }], ephemeral: true, dm } },
});

async function menu(options: ReturnType<typeof option>[]) {
  const selects = readSelects([{ kind: "string", placeholder: "Pick", minValues: 1, maxValues: 6, options }]);
  await prisma.messageInteraction.upsert({
    where: { messageId: MESSAGE },
    create: { messageId: MESSAGE, guildId: GUILD, channelId: CHANNEL, buttons: "[]", selects: JSON.stringify(selects) },
    update: { selects: JSON.stringify(selects) },
  });
}

function pick(values: string[], dmWorks = true) {
  const handlers = new Map<string, (...args: unknown[]) => Promise<void>>();
  register({ on: (event: string, listener: (...args: unknown[]) => Promise<void>) => void handlers.set(event, listener) } as never, source);
  const replies: { how: string; payload: Record<string, unknown> }[] = [];
  const direct: Record<string, unknown>[] = [];
  const guild = { id: GUILD, name: "Test", memberCount: 3, iconURL: () => null, bannerURL: () => null, channels: { cache: new Collection() }, roles: { cache: new Collection() }, members: { me: null } };
  const interaction = {
    customId: "tzmsg:s:0",
    guildId: GUILD,
    guild,
    channelId: CHANNEL,
    channel: { id: CHANNEL, name: "guides" },
    message: { id: MESSAGE },
    values,
    user: {
      id: "930000000000000001",
      displayName: "Ada",
      send: async (payload: Record<string, unknown>) => {
        if (!dmWorks) throw new Error("Cannot send messages to this user");
        direct.push(payload);
      },
    },
    member: { displayName: "Ada" },
    client: { user: { username: "TierZero" } },
    isButton: () => false,
    isAnySelectMenu: () => true,
    isMentionableSelectMenu: () => false,
    inGuild: () => true,
    reply: async (payload: Record<string, unknown>) => void replies.push({ how: "reply", payload }),
    followUp: async (payload: Record<string, unknown>) => void replies.push({ how: "followUp", payload }),
    deferUpdate: async () => void replies.push({ how: "deferUpdate", payload: {} }),
  };
  return { run: () => handlers.get(Events.InteractionCreate)!(interaction), replies, direct };
}

const titleOf = (payload: Record<string, unknown>) => (payload.embeds as { data: { title?: string } }[])[0]?.data.title;

test("answers every choice, the first as the reply and the rest as follow-ups", async () => {
  await menu([option("a", "First"), option("b", "Second"), option("c", "Third")]);
  const { run, replies } = pick(["a", "c"]);
  await run();
  assert.deepEqual(replies.map((entry) => [entry.how, titleOf(entry.payload)]), [["reply", "First"], ["followUp", "Third"]]);
  assert.equal(replies[0]?.payload.flags, MessageFlags.Ephemeral);
});

test("sends a reply set to direct message there and says so", async () => {
  await menu([option("a", "First", true), option("b", "Second", true)]);
  const { run, replies, direct } = pick(["a", "b"]);
  await run();
  assert.deepEqual(direct.map(titleOf), ["First", "Second"]);
  assert.equal(replies.length, 1);
  assert.equal(replies[0]?.how, "reply");
  assert.match(JSON.stringify(replies[0]?.payload), /direct messages/);
});

test("tells the person when direct messages are closed", async () => {
  await menu([option("a", "First", true)]);
  const { run, replies, direct } = pick(["a"], false);
  await run();
  assert.equal(direct.length, 0);
  assert.match(JSON.stringify(replies[0]?.payload), /couldn't send you a direct message/);
});

test("mixes a direct message with a reply where they are", async () => {
  await menu([option("a", "First", true), option("b", "Second")]);
  const { run, replies, direct } = pick(["a", "b"]);
  await run();
  assert.deepEqual(direct.map(titleOf), ["First"]);
  assert.equal(replies[0]?.how, "reply");
  assert.equal(titleOf(replies[0]!.payload), "Second");
  assert.equal(replies[1]?.how, "followUp");
});
