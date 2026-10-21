import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ModuleRegistry } from "@tier0/core";
import sticky from "@tier0/module-sticky";

/** A message sent from the Message creator with "keep at the bottom" on becomes the channel's sticky message. */

const GUILD = "800000000000000001";
const CHANNEL = "810000000000000001";

let dir: string;
let prisma: typeof import("@tier0/db").prisma;
let stickyKeeper: typeof import("../dist/control/sticky.js").stickyKeeper;

const registry = new ModuleRegistry();
registry.register(sticky);

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "tier0-keeper-"));
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
  ({ stickyKeeper } = await import("../dist/control/sticky.js"));
  await prisma.guild.create({ data: { id: GUILD, name: "Test" } });
});

after(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const message = (content: string) => ({
  content,
  embeds: [],
  buttons: [{ type: "link", label: "x", url: "https://example.com" }],
  selects: [],
  reactions: ["👍"],
});

function world() {
  const deleted: string[] = [];
  const updates: unknown[] = [];
  const guild: any = {
    id: GUILD,
    channels: { cache: new Map([[CHANNEL, { id: CHANNEL, name: "rules", isTextBased: () => true, messages: { delete: async (id: string) => void deleted.push(id) } }]]) },
  };
  const state: any = {
    applyModuleUpdate: async (_guild: unknown, moduleId: string, patch: { settings: unknown }) => {
      updates.push(patch.settings);
      await prisma.guildModule.upsert({
        where: { guildId_moduleId: { guildId: GUILD, moduleId } },
        create: { guildId: GUILD, moduleId, enabled: false, settings: JSON.stringify(patch.settings) },
        update: { settings: JSON.stringify(patch.settings) },
      });
      return { ok: true };
    },
  };
  return { keep: stickyKeeper(guild, registry, state, { schedule() {} }), deleted, updates };
}

test("adds a row for the channel and remembers the message that was sent", async () => {
  const { keep, updates } = world();
  const note = await keep(CHANNEL, message("Read the rules") as never, "820000000000000001");
  // The feature has not been switched on in this test, so the person is told.
  assert.match(note ?? "", /switched off/);

  const saved = updates[0] as { stickies: { channel: string; name: string; message: { content: string; buttons: unknown[]; reactions: unknown[] } }[] };
  assert.equal(saved.stickies.length, 1);
  assert.equal(saved.stickies[0]?.channel, CHANNEL);
  assert.equal(saved.stickies[0]?.name, "#rules");
  assert.equal(saved.stickies[0]?.message.content, "Read the rules");
  assert.deepEqual(saved.stickies[0]?.message.buttons, []);
  assert.deepEqual(saved.stickies[0]?.message.reactions, []);

  const post = await prisma.stickyPost.findUnique({ where: { guildId_channelId: { guildId: GUILD, channelId: CHANNEL } } });
  assert.equal(post?.messageId, "820000000000000001");
});

test("a second message for the same channel replaces the row and removes the old copy", async () => {
  const { keep, deleted, updates } = world();
  await prisma.guildModule.update({ where: { guildId_moduleId: { guildId: GUILD, moduleId: "sticky" } }, data: { enabled: true } });
  const note = await keep(CHANNEL, message("New rules") as never, "820000000000000002");
  assert.equal(note, null);
  assert.deepEqual(deleted, ["820000000000000001"]);
  const saved = updates[0] as { stickies: { message: { content: string } }[] };
  assert.equal(saved.stickies.length, 1);
  assert.equal(saved.stickies[0]?.message.content, "New rules");
});
