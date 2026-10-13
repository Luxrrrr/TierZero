import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "../../../packages/modules/moderation/test/db-helper.ts";

const GUILD = "100000000000000090";
const BOT = "100000000000000091";
const HUMAN = "100000000000000092";
const MEMBER = "100000000000000093";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { listAudit } = await import("../dist/control/mod/audit-list.js");
const { auditAutomodCase } = await import("@tier0/module-moderation");
const { writeAudit } = await import("../dist/control/mod/audit.js");

const names = new Map([
  [MEMBER, "LuxTester"],
  [HUMAN, "Tamsin"],
]);
const ctx = {
  client: { user: { id: BOT }, users: { cache: new Map(), fetch: async () => null } },
  guild: {
    id: GUILD,
    members: {
      cache: new Map([...names].map(([id, displayName]) => [id, { displayName, displayAvatarURL: () => "" }])),
      fetch: async () => null,
    },
  },
} as never;

let automodCase: number;
let manualCase: number;

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Audit list test guild" } });
  const automod = await prisma.infraction.create({
    data: { guildId: GUILD, userId: MEMBER, moderatorId: BOT, action: "automod-warn", caseNumber: 4 },
  });
  automodCase = automod.id;
  await auditAutomodCase({
    guildId: GUILD,
    botUserId: BOT,
    targetUserId: MEMBER,
    targetName: "LuxTester",
    infractionId: automod.id,
    caseNumber: 4,
    action: "automod-warn",
    reason: "Posted a Discord invite link",
  });
  const manual = await prisma.infraction.create({
    data: { guildId: GUILD, userId: MEMBER, moderatorId: HUMAN, action: "warn", caseNumber: 5 },
  });
  manualCase = manual.id;
  await writeAudit({
    guildId: GUILD,
    actor: { userId: HUMAN, name: "Tamsin", role: "admin" },
    kind: "action.take",
    summary: "Warned LuxTester (case #5)",
    targetUserId: MEMBER,
    infractionId: manual.id,
  });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

const list = async (query: string) => {
  const reply = await listAudit(ctx, new URLSearchParams(query));
  assert.equal(reply.status, 200);
  return reply.body as { items: Array<{ actor: { userId: string; name: string; role: string }; kind: string; summary: string; infractionId: number | null }>; total: number };
};

describe("the staff activity list", () => {
  test("shows an automod entry as Automod, with a role of its own", async () => {
    const { items } = await list(`infractionId=${automodCase}`);
    assert.equal(items.length, 1);
    assert.deepEqual(items[0]!.actor, { userId: BOT, name: "Automod", role: "automod" });
    assert.equal(items[0]!.kind, "action.take");
    assert.equal(items[0]!.summary, "Automod warned LuxTester (case #4): Posted a Discord invite link");
  });

  test("a person's entry keeps their staff role", async () => {
    const { items } = await list(`actorId=${HUMAN}`);
    assert.equal(items.length, 1);
    assert.equal(items[0]!.actor.role, "admin");
  });

  test("the action filter finds automod's cases next to staff's", async () => {
    const { items, total } = await list("kind=action.take");
    assert.equal(total, 2);
    assert.deepEqual(items.map((item) => item.actor.role).sort(), ["admin", "automod"]);
  });

  test("the Automod staff filter finds only the bot's entries, without knowing its id", async () => {
    const { items } = await list("actorId=automod");
    assert.deepEqual(items.map((item) => item.actor.role), ["automod"]);
  });

  test("an unknown stored role still renders as a moderator", async () => {
    await prisma.modAudit.create({
      data: { guildId: GUILD, actorId: HUMAN, actorName: "Tamsin", actorRole: "none", kind: "channel.purge", summary: "Deleted 2 messages" },
    });
    const { items } = await list("kind=channel.purge");
    assert.equal(items[0]!.actor.role, "mod");
  });
});

describe("what a staff activity entry needs to open the member's record", () => {
  type Item = { id: number; kind: string; actor: { name: string; role: string }; targetUser: { userId: string } | null; infractionId: number | null; caseNumber: number | null; noteId: number | null };
  const all = async (query = "") => ((await list(query)).items as unknown as Item[]);

  test("carries the member, the case number and the note id", async () => {
    const note = await prisma.modNote.create({ data: { guildId: GUILD, userId: MEMBER, authorId: HUMAN, content: "watch this one" } });
    await writeAudit({
      guildId: GUILD,
      actor: { userId: HUMAN, name: "Tamsin", role: "admin" },
      kind: "note.edit",
      summary: "Edited a note",
      targetUserId: MEMBER,
      noteId: note.id,
    });
    const items = await all("");
    const byInfraction = (id: number) => items.find((item) => item.infractionId === id)!;

    assert.equal(byInfraction(automodCase).caseNumber, 4);
    assert.equal(byInfraction(manualCase).caseNumber, 5);
    assert.equal(byInfraction(manualCase).targetUser?.userId, MEMBER);
    const edited = items.find((item) => item.kind === "note.edit")!;
    assert.equal(edited.noteId, note.id);
    assert.equal(edited.caseNumber, null);
  });

  test("looks the case numbers up in one query for the whole page", async () => {
    const original = prisma.infraction.findMany;
    let calls = 0;
    (prisma.infraction as { findMany: unknown }).findMany = (...args: Parameters<typeof original>) => {
      calls += 1;
      return original.apply(prisma.infraction, args);
    };
    try {
      const items = await all("");
      assert.ok(items.filter((item) => item.infractionId !== null).length >= 2);
      assert.equal(calls, 1);
    } finally {
      (prisma.infraction as { findMany: unknown }).findMany = original;
    }
  });

  test("a case that was deleted for good keeps the number its snapshot recorded", async () => {
    await writeAudit({
      guildId: GUILD,
      actor: { userId: HUMAN, name: "Tamsin", role: "admin" },
      kind: "infraction.void",
      summary: "Removed case #77",
      targetUserId: MEMBER,
      infractionId: 987654,
      before: { caseNumber: 77, action: "warn" },
    });
    const gone = (await all("kind=infraction.void")).find((item) => item.infractionId === 987654)!;
    assert.equal(gone.caseNumber, 77);
  });

  test("an entry that is not about a case has no number", async () => {
    await writeAudit({
      guildId: GUILD,
      actor: { userId: HUMAN, name: "Tamsin", role: "admin" },
      kind: "staff.add",
      summary: "Added Sam as a moderator",
    });
    const entry = (await all("kind=staff.add"))[0]!;
    assert.equal(entry.caseNumber, null);
    assert.equal(entry.targetUser, null);
  });

  test("shows the bot's entries as Automod whatever name an old row stored", async () => {
    await prisma.modAudit.create({
      data: { guildId: GUILD, actorId: BOT, actorName: "TierZero", actorRole: "mod", kind: "action.take", summary: "old row" },
    });
    const old = (await all("kind=action.take")).find((item) => item.actor.name === "Automod" && item.id > 0 && item.infractionId === null)!;
    assert.deepEqual(old.actor, { userId: BOT, name: "Automod", role: "automod" });
  });
});

