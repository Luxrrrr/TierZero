import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "../../moderation/test/db-helper.ts";

const GUILD = "100000000000000110";
const CHANNEL = "100000000000000111";
const AUTHOR = "100000000000000112";
const MOD = "100000000000000113";
const BOT = "100000000000000114";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { noteDeletion, clearDeletionNotes } = await import("@tier0/core");
const { serverLogEvents } = await import("../dist/events.js");
const { logCreated } = await import("../dist/message-log.js");

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Delete event test guild" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

const settings = { categories: { messages: true }, exclude: [], days: 30 } as never;

const message = (id: string) => ({
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
});

let lines = 0;

function context(audit: "denied" | { executor: string; target?: string; channel?: string; count?: number; age?: number } | "none") {
  const fetchAuditLogs = async () => {
    if (audit === "denied") throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
    const entries = new Map();
    if (audit !== "none") {
      const id = `L${++lines}`;
      entries.set(id, {
        id,
        executor: { id: audit.executor, displayName: "Marcus", username: "marcus" },
        targetId: audit.target ?? AUTHOR,
        extra: { channel: { id: audit.channel ?? CHANNEL }, count: audit.count ?? 1 },
        createdTimestamp: Date.now() - (audit.age ?? 800),
      });
    }
    return { entries };
  };
  return {
    client: { user: { id: BOT, username: "TierZero" } },
    guild: { id: GUILD, members: { me: { displayName: "TierZero" }, cache: new Map() }, fetchAuditLogs },
    settings,
  };
}

async function deleteMessage(id: string, ctx: ReturnType<typeof context>) {
  const msg = message(id);
  await logCreated(msg as never, settings);
  await serverLogEvents.messageDelete!(msg as never, ctx as never);
  const entries = await prisma.serverLogEntry.findMany({ where: { guildId: GUILD, type: "message.delete" }, orderBy: { id: "desc" }, take: 1 });
  const row = await prisma.loggedMessage.findUniqueOrThrow({ where: { guildId_messageId: { guildId: GUILD, messageId: id } } });
  return { entry: entries[0]!, row };
}

describe("a deleted message in the server log", () => {
  test("says automod when automod noted the delete, without reading the audit log", async () => {
    clearDeletionNotes();
    noteDeletion("300", { by: "automod" });
    const ctx = context("denied");
    let read = false;
    (ctx.guild as { fetchAuditLogs: unknown }).fetchAuditLogs = async () => {
      read = true;
      throw new Error("not expected");
    };
    const { entry, row } = await deleteMessage("300", ctx);
    assert.equal(read, false);
    assert.equal(row.deletedBy, "automod");
    assert.equal(row.deletedById, BOT);
    assert.equal(row.deletedByName, "Automod");
    assert.equal(entry.summary, "A message by LuxTester was deleted in #general by Automod");
    assert.equal(entry.actorId, BOT);
    assert.equal(entry.actorName, "Automod");
    const details = JSON.parse(entry.details);
    assert.equal(details.deletedBy, "automod");
    assert.ok(details.notes.includes("Deleted by Automod"));
  });

  test("names the moderator the audit log shows", async () => {
    clearDeletionNotes();
    const { entry, row } = await deleteMessage("301", context({ executor: MOD }));
    assert.deepEqual([row.deletedBy, row.deletedById, row.deletedByName], ["moderator", MOD, "Marcus"]);
    assert.equal(entry.summary, "A message by LuxTester was deleted in #general by Marcus");
    assert.equal(entry.actorId, MOD);
  });

  test("names the bot when the audit log shows the bot", async () => {
    clearDeletionNotes();
    const { row } = await deleteMessage("302", context({ executor: BOT }));
    assert.deepEqual([row.deletedBy, row.deletedByName], ["bot", "TierZero"]);
  });

  test("says the author when the audit log has no line, since authors leave none", async () => {
    clearDeletionNotes();
    const { entry, row } = await deleteMessage("303", context("none"));
    assert.deepEqual([row.deletedBy, row.deletedById, row.deletedByName], ["author", AUTHOR, "LuxTester"]);
    assert.equal(entry.summary, "A message by LuxTester was deleted in #general by its author");
  });

  test("falls back to the author without the View Audit Log permission", async () => {
    clearDeletionNotes();
    const { row } = await deleteMessage("304", context("denied"));
    assert.equal(row.deletedBy, "author");
  });

  test("does not take a line about someone else's messages", async () => {
    clearDeletionNotes();
    const { row } = await deleteMessage("305", context({ executor: MOD, target: "999999999999999999" }));
    assert.equal(row.deletedBy, "author");
  });

  test("leaves it unknown when the message was never cached and the author cannot be known", async () => {
    clearDeletionNotes();
    const partial = { id: "306", guildId: GUILD, channelId: CHANNEL, channel: { name: "general" }, partial: true, content: null, author: null };
    await serverLogEvents.messageDelete!(partial as never, context("none") as never);
    const [entry] = await prisma.serverLogEntry.findMany({ where: { guildId: GUILD, type: "message.delete" }, orderBy: { id: "desc" }, take: 1 });
    assert.equal(entry!.summary, "A message was deleted in #general");
    assert.equal(entry!.actorId, null);
  });

  test("a bulk delete is a purge and records no deleter", async () => {
    clearDeletionNotes();
    const first = message("307");
    await logCreated(first as never, settings);
    const channel = { id: CHANNEL, name: "general" };
    await serverLogEvents.messageDeleteBulk!(new Map([["307", first]]) as never, channel as never, context("none") as never);
    const row = await prisma.loggedMessage.findUniqueOrThrow({ where: { guildId_messageId: { guildId: GUILD, messageId: "307" } } });
    assert.ok(row.deletedAt);
    assert.equal(row.deletedBy, null);
  });
});
