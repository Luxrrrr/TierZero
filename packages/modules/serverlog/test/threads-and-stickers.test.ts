import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "../../moderation/test/db-helper.ts";

const GUILD = "100000000000000210";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { serverLogCategoryOf, serverLogTypeLabel } = await import("@tier0/shared-moderation");
const { serverLogEvents } = await import("../dist/events.js");

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Thread and sticker test guild" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

const settings = { categories: { channels: true, server: true }, exclude: [], days: 30 } as never;
const ctx = {
  settings,
  guild: { id: GUILD, fetchAuditLogs: async () => ({ entries: new Map() }) },
} as never;

const entries = () => prisma.serverLogEntry.findMany({ where: { guildId: GUILD }, orderBy: { id: "asc" } });

describe("threads and stickers in the server log", () => {
  test("the new kinds sort into the categories that switch them", () => {
    assert.equal(serverLogCategoryOf("thread.archive"), "channels");
    assert.equal(serverLogCategoryOf("sticker.update"), "server");
    assert.equal(serverLogTypeLabel("thread.unarchive"), "Thread reopened");
  });

  test("archiving and reopening a thread, and nothing for a rename", async () => {
    const thread = (archived: boolean, name = "lfg-tonight") => ({ id: "100000000000000211", name, archived, parent: { name: "looking-for-group" } });
    await serverLogEvents.threadUpdate!(thread(false) as never, thread(true) as never, ctx);
    await serverLogEvents.threadUpdate!(thread(true) as never, thread(false) as never, ctx);
    await serverLogEvents.threadUpdate!(thread(false) as never, thread(false, "lfg-later") as never, ctx);
    const saved = await entries();
    assert.deepEqual(
      saved.map((entry) => [entry.type, entry.category, entry.summary]),
      [
        ["thread.archive", "channels", "The thread lfg-tonight was archived in #looking-for-group"],
        ["thread.unarchive", "channels", "The thread lfg-tonight was reopened in #looking-for-group"],
      ],
    );
  });

  test("a sticker added, changed and removed", async () => {
    await prisma.serverLogEntry.deleteMany({ where: { guildId: GUILD } });
    const gg = { id: "100000000000000212", name: "gg", description: null, tags: "trophy" };
    await serverLogEvents.stickerCreate!(gg as never, ctx);
    await serverLogEvents.stickerUpdate!(gg as never, { ...gg, name: "goodgame" } as never, ctx);
    await serverLogEvents.stickerUpdate!(gg as never, { ...gg } as never, ctx);
    await serverLogEvents.stickerDelete!({ ...gg, name: "goodgame" } as never, ctx);
    const saved = await entries();
    assert.deepEqual(
      saved.map((entry) => entry.type),
      ["sticker.create", "sticker.update", "sticker.delete"],
    );
    assert.deepEqual(JSON.parse(saved[1]!.details).changes, [{ label: "Name", before: "gg", after: "goodgame" }]);
  });
});
