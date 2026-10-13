import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "../../moderation/test/db-helper.ts";

const GUILD = "100000000000000100";
const CHANNEL = "100000000000000101";
const AUTHOR = "100000000000000102";
const MOD = "100000000000000103";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { logCreated, logDeleted, storedDecision, deletedByOf } = await import("../dist/message-log.js");

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Log test guild" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

const settings = { categories: { messages: true }, exclude: [], days: 30 } as never;

const message = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  guildId: GUILD,
  channelId: CHANNEL,
  channel: { name: "general" },
  author: { id: AUTHOR, username: "LuxTester", bot: false },
  member: null,
  content: "hello",
  attachments: new Map(),
  stickers: new Map(),
  embeds: [],
  createdTimestamp: Date.now() - 5000,
  ...over,
});

const rowOf = (messageId: string) => prisma.loggedMessage.findUniqueOrThrow({ where: { guildId_messageId: { guildId: GUILD, messageId } } });

describe("logDeleted", () => {
  test("stores who deleted a message the log already had", async () => {
    await logCreated(message("200") as never, settings);
    const saved = await logDeleted(message("200") as never, settings, async (author) => {
      assert.deepEqual(author, { id: AUTHOR, name: "LuxTester" });
      return { by: "moderator", byId: MOD, byName: "Marcus" };
    });
    assert.equal(saved?.by?.by, "moderator");
    const row = await rowOf("200");
    assert.ok(row.deletedAt);
    assert.deepEqual([row.deletedBy, row.deletedById, row.deletedByName], ["moderator", MOD, "Marcus"]);
  });

  test("stores who deleted a message the log had never seen, from what Discord still knew", async () => {
    await logDeleted(message("201") as never, settings, async () => ({ by: "automod", byId: "9", byName: "Automod" }));
    const row = await rowOf("201");
    assert.equal(row.deletedBy, "automod");
  });

  test("leaves the columns empty when nothing says who", async () => {
    await logCreated(message("202") as never, settings);
    await logDeleted(message("202") as never, settings, async () => null);
    const row = await rowOf("202");
    assert.ok(row.deletedAt);
    assert.equal(row.deletedBy, null);
    await logCreated(message("203") as never, settings);
    await logDeleted(message("203") as never, settings);
    assert.equal((await rowOf("203")).deletedBy, null);
  });

  test("does not ask again, or change the deleter, for a message already marked deleted", async () => {
    await logCreated(message("204") as never, settings);
    await logDeleted(message("204") as never, settings, async () => ({ by: "author", byId: AUTHOR, byName: "LuxTester" }));
    let asked = false;
    const again = await logDeleted(message("204") as never, settings, async () => {
      asked = true;
      return { by: "moderator", byId: MOD, byName: "Marcus" };
    });
    assert.equal(asked, false);
    assert.equal(again?.by?.by, "author");
    assert.equal((await rowOf("204")).deletedBy, "author");
  });

  test("a message that is not logged because the category is off is left alone", async () => {
    const off = { categories: { messages: false }, exclude: [], days: 30 } as never;
    let asked = false;
    const saved = await logDeleted(message("205") as never, off, async () => {
      asked = true;
      return null;
    });
    assert.equal(saved, null);
    assert.equal(asked, false);
  });

  test("a message with only a sticker keeps what it carried", async () => {
    await logCreated(message("206", { content: "", stickers: new Map([["s", {}]]) }) as never, settings);
    assert.equal((await rowOf("206")).extras, "1 sticker");
  });
});

describe("the deleter on a row", () => {
  test("reads back, and an unknown source is ignored", () => {
    assert.deepEqual(storedDecision({ deletedBy: "automod", deletedById: "1", deletedByName: "Automod" }), { by: "automod", byId: "1", byName: "Automod" });
    assert.equal(storedDecision({ deletedBy: "alien", deletedById: null, deletedByName: null }), null);
    assert.equal(storedDecision({ deletedBy: null, deletedById: null, deletedByName: null }), null);
    assert.deepEqual(deletedByOf({ deletedBy: null, deletedById: null, deletedByName: null }), {});
    assert.deepEqual(deletedByOf({ deletedBy: "bot", deletedById: "1", deletedByName: "TierZero" }), { deletedBy: "bot", deletedByName: "TierZero" });
  });
});
