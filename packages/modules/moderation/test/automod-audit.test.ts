import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./db-helper.ts";

const GUILD = "100000000000000080";
const BOT = "100000000000000081";
const HUMAN = "100000000000000082";
const MEMBER = "100000000000000083";
const STRANGER = "100000000000000084";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { auditAutomodCase, automodAuditSummary, backfillAutomodAudit, genericReasonOf } = await import(
  "../dist/automod-audit.js"
);

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Automod audit test guild" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

const facts = (over: Record<string, unknown> = {}) => ({
  guildId: GUILD,
  botUserId: BOT,
  targetUserId: MEMBER,
  targetName: "LuxTester",
  infractionId: 1,
  caseNumber: 4,
  action: "automod-warn",
  reason: "Posted a Discord invite link",
  ...over,
});

describe("automodAuditSummary", () => {
  const table: Array<[string, Record<string, unknown>, string]> = [
    ["a warning", {}, "Automod warned LuxTester (case #4): Posted a Discord invite link"],
    ["no reason", { reason: null }, "Automod warned LuxTester (case #4)"],
    ["an unnamed member reads as the id", { targetName: null }, `Automod warned ${MEMBER} (case #4): Posted a Discord invite link`],
    ["a delete from the case alone", { action: "automod-delete" }, "Automod deleted a message from LuxTester (case #4): Posted a Discord invite link"],
    ["a timeout from the case alone", { action: "automod-timeout" }, "Automod timed out LuxTester (case #4): Posted a Discord invite link"],
    ["delete and warn", { deleted: true, warned: true }, "Automod deleted a message from LuxTester and warned them (case #4): Posted a Discord invite link"],
    ["all three", { deleted: true, warned: true, timedOut: true }, "Automod deleted a message from LuxTester, warned them and timed them out (case #4): Posted a Discord invite link"],
    ["a long reason is clipped", { reason: "x".repeat(200) }, `Automod warned LuxTester (case #4): ${"x".repeat(117)}...`],
  ];
  for (const [name, over, expected] of table) {
    test(name, () => assert.equal(automodAuditSummary(facts(over)), expected));
  }
});

describe("genericReasonOf", () => {
  const table: Array<[string | null, string | null]> = [
    [null, null],
    ["invites", null],
    ["invites: Posted a Discord invite link", "Posted a Discord invite link"],
    ["bannedWords: Used a banned word or phrase (matched `badword`, `other thing`)", "Used a banned word or phrase"],
    ["links: Posted a link (Could not delete the message: missing permission)", "Posted a link"],
    ["bannedWords: Used a banned word or phrase (matched `x`) (Could not time out: missing permission)", "Used a banned word or phrase"],
  ];
  for (const [stored, expected] of table) {
    test(String(stored), () => assert.equal(genericReasonOf(stored), expected));
  }
});

describe("auditAutomodCase", () => {
  test("writes an action entry made by the bot, tied to the case", async () => {
    const infraction = await prisma.infraction.create({
      data: { guildId: GUILD, userId: MEMBER, moderatorId: BOT, action: "automod-warn", caseNumber: 1 },
    });
    assert.equal(await auditAutomodCase(facts({ infractionId: infraction.id, caseNumber: 1 })), true);

    const [row] = await prisma.modAudit.findMany({ where: { infractionId: infraction.id } });
    assert.equal(row!.kind, "action.take");
    assert.equal(row!.actorId, BOT);
    assert.equal(row!.actorName, "Automod");
    assert.equal(row!.actorRole, "automod");
    assert.equal(row!.targetUserId, MEMBER);
    assert.equal(row!.summary, "Automod warned LuxTester (case #1): Posted a Discord invite link");
  });

  test("never throws, and says it did not write", async () => {
    const original = console.error;
    console.error = () => undefined;
    try {
      assert.equal(await auditAutomodCase(facts({ guildId: "no-such-guild" })), false);
    } finally {
      console.error = original;
    }
  });
});

describe("backfillAutomodAudit", () => {
  const client = (userId: string | undefined) =>
    ({
      user: userId ? { id: userId } : null,
      guilds: { cache: new Map([[GUILD, { members: { cache: new Map([[MEMBER, { displayName: "LuxTester" }]]) } }]]) },
      users: { cache: new Map() },
    }) as never;

  test("adds one entry per automod case that has none, and is safe to run again", async () => {
    const made = (data: { caseNumber: number; action: string; moderatorId?: string; userId?: string; reason?: string | null; createdAt?: Date }) =>
      prisma.infraction.create({
        data: { guildId: GUILD, userId: data.userId ?? MEMBER, moderatorId: data.moderatorId ?? BOT, ...data },
      });
    const old = new Date("2026-09-01T10:00:00Z");
    const warn = await made({
      caseNumber: 10,
      action: "automod-warn",
      reason: "invites: Posted a Discord invite link (matched `abc`)",
      createdAt: old,
    });
    const timeout = await made({ caseNumber: 11, action: "automod-timeout", userId: STRANGER, reason: null });
    const manual = await made({ caseNumber: 12, action: "warn", moderatorId: HUMAN });
    // Already has its entry from the live path.
    const audited = await made({ caseNumber: 13, action: "automod-delete" });
    await prisma.modAudit.create({
      data: {
        guildId: GUILD,
        actorId: BOT,
        actorName: "Automod",
        actorRole: "automod",
        kind: "action.take",
        infractionId: audited.id,
        summary: "already there",
      },
    });

    assert.equal(await backfillAutomodAudit(client(BOT)), 2);

    const rows = await prisma.modAudit.findMany({
      where: { infractionId: { in: [warn.id, timeout.id, manual.id, audited.id] } },
      orderBy: { infractionId: "asc" },
    });
    assert.equal(rows.filter((row) => row.infractionId === manual.id).length, 0);
    assert.equal(rows.filter((row) => row.infractionId === audited.id).length, 1);

    const [first] = rows.filter((row) => row.infractionId === warn.id);
    assert.equal(first!.summary, "Automod warned LuxTester (case #10): Posted a Discord invite link");
    assert.equal(first!.actorRole, "automod");
    assert.equal(first!.actorId, BOT);
    assert.equal(first!.at.toISOString(), old.toISOString());
    assert.equal(first!.targetUserId, MEMBER);
    assert.ok(!first!.summary.includes("abc"));

    const [second] = rows.filter((row) => row.infractionId === timeout.id);
    assert.equal(second!.summary, `Automod timed out ${STRANGER} (case #11)`);

    assert.equal(await backfillAutomodAudit(client(BOT)), 0);
    assert.equal(await prisma.modAudit.count({ where: { infractionId: { in: [warn.id, timeout.id] } } }), 2);
  });

  test("does nothing before the bot knows who it is", async () => {
    assert.equal(await backfillAutomodAudit(client(undefined)), 0);
  });
});
