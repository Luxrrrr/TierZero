import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./db-helper.ts";

const GUILD = "100000000000000030";
const ACTOR = "100000000000000031";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { auditPurge } = await import("../dist/purge-audit.js");

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Purge test guild" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

describe("auditPurge", () => {
  test("records who deleted how many messages in which channel", async () => {
    await auditPurge({ guildId: GUILD, actorId: ACTOR, actorName: "ada", channelId: "9", channelName: "general", deleted: 20 });

    const [row] = await prisma.modAudit.findMany({ where: { guildId: GUILD } });
    assert.equal(row!.kind, "channel.purge");
    assert.equal(row!.actorId, ACTOR);
    assert.equal(row!.actorName, "ada");
    assert.equal(row!.summary, "Deleted 20 messages in #general");
    assert.deepEqual(JSON.parse(row!.after!), { channelId: "9", deleted: 20 });
  });

  test("records the actor's staff role when they have one, and says none when they do not", async () => {
    await prisma.staffMember.create({ data: { guildId: GUILD, userId: ACTOR, role: "admin", addedBy: "1" } });
    await auditPurge({ guildId: GUILD, actorId: ACTOR, actorName: "ada", channelId: "9", channelName: "", deleted: 1 });
    await prisma.staffMember.deleteMany();
    await auditPurge({ guildId: GUILD, actorId: ACTOR, actorName: "ada", channelId: "9", channelName: "", deleted: 1 });

    const rows = await prisma.modAudit.findMany({ where: { guildId: GUILD }, orderBy: { id: "asc" } });
    assert.deepEqual(rows.slice(-2).map((r) => r.actorRole), ["admin", "none"]);
    assert.equal(rows.at(-1)!.summary, "Deleted 1 message in a channel");
  });

  test("never throws, even when the guild is unknown", async () => {
    await auditPurge({ guildId: "no-such-guild", actorId: ACTOR, actorName: "ada", channelId: "9", channelName: "x", deleted: 3 });
  });
});
