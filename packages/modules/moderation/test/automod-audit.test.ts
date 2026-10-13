import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./db-helper.ts";

const GUILD = "100000000000000080";
const BOT = "100000000000000081";
const HUMAN = "100000000000000082";
const MEMBER = "100000000000000083";
const STRANGER = "100000000000000084";
const FETCHABLE = "100000000000000085";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { auditAutomodCase, automodAuditSummary, backfillAutomodAudit, repairAutomodAudit, staffReasonOf } = await import(
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
    ["a long reason is clipped", { reason: "x".repeat(300) }, `Automod warned LuxTester (case #4): ${"x".repeat(197)}...`],
    [
      "what matched is part of the line",
      { reason: "Posted a Discord invite link (matched gta6)" },
      "Automod warned LuxTester (case #4): Posted a Discord invite link (matched gta6)",
    ],
  ];
  for (const [name, over, expected] of table) {
    test(name, () => assert.equal(automodAuditSummary(facts(over)), expected));
  }
});

describe("staffReasonOf", () => {
  const table: Array<[string | null, string | null]> = [
    [null, null],
    ["invites", null],
    ["invites: Posted a Discord invite link", "Posted a Discord invite link"],
    ["invites: Posted a Discord invite link (matched `gta6`)", "Posted a Discord invite link (matched gta6)"],
    [
      "bannedWords: Used a banned word or phrase (matched `free nitro`, `crypto airdrop`)",
      "Used a banned word or phrase (matched free nitro, crypto airdrop)",
    ],
    ["links: Posted a link (Could not delete the message: missing permission)", "Posted a link"],
    [
      "bannedWords: Used a banned word or phrase (matched `x`) (Could not time out: missing permission)",
      "Used a banned word or phrase (matched x)",
    ],
  ];
  for (const [stored, expected] of table) {
    test(String(stored), () => assert.equal(staffReasonOf(stored), expected));
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
      users: { cache: new Map(), fetch: async (id: string) => (id === FETCHABLE ? { displayName: "Fetched Name" } : Promise.reject(new Error("Unknown User"))) },
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
    assert.equal(first!.summary, "Automod warned LuxTester (case #10): Posted a Discord invite link (matched abc)");
    assert.equal(first!.actorRole, "automod");
    assert.equal(first!.actorId, BOT);
    assert.equal(first!.at.toISOString(), old.toISOString());
    assert.equal(first!.targetUserId, MEMBER);

    const [second] = rows.filter((row) => row.infractionId === timeout.id);
    assert.equal(second!.summary, `Automod timed out ${STRANGER} (case #11)`);

    assert.equal(await backfillAutomodAudit(client(BOT)), 0);
    assert.equal(await prisma.modAudit.count({ where: { infractionId: { in: [warn.id, timeout.id] } } }), 2);
  });

  test("does nothing before the bot knows who it is", async () => {
    assert.equal(await backfillAutomodAudit(client(undefined)), 0);
  });
});

describe("repairAutomodAudit", () => {
  const client = (userId: string | undefined) =>
    ({
      user: userId ? { id: userId } : null,
      guilds: { cache: new Map([[GUILD, { members: { cache: new Map([[MEMBER, { displayName: "LuxTester" }]]) } }]]) },
      users: {
        cache: new Map(),
        fetch: async (id: string) => (id === FETCHABLE ? { displayName: "Fetched Name" } : Promise.reject(new Error("Unknown User"))),
      },
    }) as never;

  const entry = async (caseNumber: number, userId: string, stored: string | null, summary: string, role = "automod") => {
    const infraction = await prisma.infraction.create({
      data: { guildId: GUILD, userId, moderatorId: BOT, action: "automod-warn", caseNumber, reason: stored },
    });
    const row = await prisma.modAudit.create({
      data: {
        guildId: GUILD,
        actorId: role === "automod" ? BOT : HUMAN,
        actorName: role === "automod" ? "Automod" : "Tamsin",
        actorRole: role,
        kind: "action.take",
        targetUserId: userId,
        infractionId: infraction.id,
        summary,
      },
    });
    return row.id;
  };
  const summaryOf = async (id: number) => (await prisma.modAudit.findUniqueOrThrow({ where: { id } })).summary;

  test("puts names in place of ids, restores the match, writes once and leaves everything else alone", async () => {
    const known = await entry(
      20,
      MEMBER,
      "invites: Posted a Discord invite link (matched `gta6`)",
      `Automod warned ${MEMBER} (case #20): Posted a Discord invite link`,
    );
    const fetched = await entry(
      21,
      FETCHABLE,
      "bannedWords: Used a banned word or phrase (matched `free nitro`, `crypto airdrop`)",
      `Automod deleted a message from ${FETCHABLE} (case #21): Used a banned word or phrase`,
    );
    const unknown = await entry(
      22,
      STRANGER,
      "invites: Posted a Discord invite link (matched `abc`)",
      `Automod warned ${STRANGER} (case #22): Posted a Discord invite link`,
    );
    const edited = await entry(
      23,
      MEMBER,
      "invites: A moderator rewrote this reason (matched `abc`)",
      `Automod warned LuxTester (case #23): Posted a Discord invite link`,
    );
    const other = await entry(24, MEMBER, "invites: Posted a Discord invite link (matched `abc`)", `something else entirely ${MEMBER}`);
    const byStaff = await entry(
      25,
      MEMBER,
      "invites: Posted a Discord invite link (matched `abc`)",
      `Warned ${MEMBER} (case #25): Posted a Discord invite link`,
      "admin",
    );
    const current = await entry(
      26,
      MEMBER,
      "invites: Posted a Discord invite link (matched `abc`)",
      "Automod warned LuxTester (case #26): Posted a Discord invite link (matched abc)",
    );

    assert.equal(await repairAutomodAudit(client(BOT)), 3);

    assert.equal(await summaryOf(known), "Automod warned LuxTester (case #20): Posted a Discord invite link (matched gta6)");
    assert.equal(
      await summaryOf(fetched),
      "Automod deleted a message from Fetched Name (case #21): Used a banned word or phrase (matched free nitro, crypto airdrop)",
    );
    // No name to be had, so the id stays, but the match is still restored.
    assert.equal(await summaryOf(unknown), `Automod warned ${STRANGER} (case #22): Posted a Discord invite link (matched abc)`);
    assert.equal(await summaryOf(edited), "Automod warned LuxTester (case #23): Posted a Discord invite link");
    assert.equal(await summaryOf(other), `something else entirely ${MEMBER}`);
    assert.equal(await summaryOf(byStaff), `Warned ${MEMBER} (case #25): Posted a Discord invite link`);
    assert.equal(await summaryOf(current), "Automod warned LuxTester (case #26): Posted a Discord invite link (matched abc)");

    assert.equal(await repairAutomodAudit(client(BOT)), 0);
  });

  test("an id that could not be named is picked up once a later start can name it", async () => {
    const id = await entry(
      30,
      FETCHABLE,
      "invites: Posted a Discord invite link",
      `Automod warned ${FETCHABLE} (case #30): Posted a Discord invite link`,
    );
    const failing = {
      ...(client(BOT) as object),
      users: { cache: new Map(), fetch: async () => Promise.reject(new Error("offline")) },
    } as never;
    assert.equal(await repairAutomodAudit(failing), 0);
    assert.equal(await summaryOf(id), `Automod warned ${FETCHABLE} (case #30): Posted a Discord invite link`);
    assert.equal(await repairAutomodAudit(client(BOT)), 1);
    assert.equal(await summaryOf(id), "Automod warned Fetched Name (case #30): Posted a Discord invite link");
  });
});
