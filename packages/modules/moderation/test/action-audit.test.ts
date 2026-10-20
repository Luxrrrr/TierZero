import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { EvidenceMessage } from "@tier0/shared-moderation";
import { createTestDatabase } from "./db-helper.ts";
import { moderationSettingsWith } from "./settings-helper.ts";

const GUILD = "100000000000000080";
const OWNER = "100000000000000081";
const BOT = "100000000000000082";
const ACTOR = "100000000000000083";
const TARGET = "100000000000000084";
const CHANNEL = "100000000000000085";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { performAction } = await import("../dist/perform.js");

const discordError = (code: number) => Object.assign(new Error("Discord said no"), { code });
let banned = false;

function member(id: string) {
  return {
    id,
    displayName: id === ACTOR ? "Ada" : "Target",
    roles: { highest: { position: id === ACTOR ? 5 : 1 } },
    permissions: { has: () => true },
    moderatable: true,
    kickable: true,
    bannable: true,
    isCommunicationDisabled: () => true,
    timeout: async () => undefined,
    kick: async () => undefined,
  };
}

const channel = {
  id: CHANNEL,
  name: "general",
  isTextBased: () => true,
  isDMBased: () => false,
  permissionsFor: () => ({ has: () => true }),
  messages: { delete: async () => undefined, fetch: async () => null },
};

function context() {
  return {
    client: { user: { id: BOT }, users: { fetch: async (id: string) => ({ id }) } },
    guild: {
      id: GUILD,
      ownerId: OWNER,
      members: {
        me: { roles: { highest: { position: 10 } } },
        fetch: async (id: string) => {
          if (id !== TARGET && id !== ACTOR) throw discordError(10007);
          return member(id);
        },
        ban: async () => undefined,
        unban: async () => undefined,
      },
      bans: {
        fetch: async () => {
          if (!banned) throw discordError(10026);
          return { user: { id: TARGET } };
        },
      },
      channels: { cache: new Map([[CHANNEL, channel]]) },
    },
    settings: { ...moderationSettingsWith({}), dmOnAction: false, modLogChannel: null, requireReason: false, deleteMessageDays: 0, defaultTimeoutDuration: 600_000 },
    tasks: { schedule: async () => undefined, cancel: async () => 0 },
    send: async () => ({}),
  } as never;
}

function copy(n: number): EvidenceMessage {
  const id = `3000000000000000${String(n).padStart(2, "0")}`;
  return {
    id,
    channelId: CHANNEL,
    channelName: "general",
    content: `spam ${n}`,
    attachments: [],
    createdAt: "2026-10-18T12:00:00.000Z",
    url: `https://discord.com/channels/${GUILD}/${CHANNEL}/${id}`,
    deleted: false,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    action: "warn",
    targetId: TARGET,
    targetName: "target",
    moderatorId: ACTOR,
    reason: "because",
    durationMs: null,
    deleteDays: null,
    actorMember: member(ACTOR),
    actorIsInstanceOwner: false,
    origin: "command",
    ...overrides,
  } as never;
}

const entries = () => prisma.modAudit.findMany({ where: { guildId: GUILD }, orderBy: { id: "asc" } });

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Action audit" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

beforeEach(async () => {
  banned = false;
  await prisma.modAudit.deleteMany();
  await prisma.infraction.deleteMany();
  await prisma.staffMember.deleteMany();
});

describe("Staff activity for actions taken from Discord", () => {
  test("a slash command warning leaves an entry for the case, under Discord moderator when the actor is not staff", async () => {
    const { record } = await performAction(context(), input({ audit: { actorName: "ada" } }));
    const [row, ...rest] = await entries();
    assert.equal(rest.length, 0);
    assert.equal(row!.kind, "action.take");
    assert.equal(row!.actorRole, "discord");
    assert.equal(row!.actorId, ACTOR);
    assert.equal(row!.actorName, "ada");
    assert.equal(row!.targetUserId, TARGET);
    assert.equal(row!.infractionId, record.id);
    assert.equal(row!.summary, `Warned target (case #${record.caseNumber}): because`);
    assert.deepEqual(JSON.parse(row!.after!), { action: "warn", caseNumber: record.caseNumber, reason: "because" });
  });

  test("the actor's staff role is recorded when they have one, and the owner is the owner", async () => {
    await prisma.staffMember.create({ data: { guildId: GUILD, userId: ACTOR, role: "admin", addedBy: OWNER } });
    await performAction(context(), input());
    await performAction(context(), input({ actorIsInstanceOwner: true }));
    assert.deepEqual((await entries()).map((row) => row.actorRole), ["admin", "owner"]);
  });

  test("a right-click warning on a message says how many messages were deleted", async () => {
    const { record } = await performAction(
      context(),
      input({ evidence: [copy(1), copy(2)], deleteMessages: true, audit: { actorName: "ada", targetName: null } }),
    );
    const [row] = await entries();
    assert.equal(row!.summary, `Warned ${TARGET} (case #${record.caseNumber}): because. Deleted 2 messages`);
    assert.deepEqual(JSON.parse(row!.after!), { action: "warn", caseNumber: record.caseNumber, reason: "because", messagesDeleted: 2, messagesNotDeleted: 0 });
  });

  test("a right-click action on a member with no message to delete has no deletion line", async () => {
    await performAction(context(), input({ action: "kick", audit: { actorName: "ada" } }));
    const [row] = await entries();
    assert.doesNotMatch(row!.summary, /Deleted/);
    assert.match(row!.summary, /^Kicked target/);
  });

  test("a lifted ban and a cleared timeout are recorded", async () => {
    banned = true;
    await performAction(context(), input({ action: "unban", reason: "second chance" }));
    await performAction(context(), input({ action: "timeout-clear", reason: null }));
    const rows = await entries();
    assert.deepEqual(rows.map((row) => row.kind), ["action.take", "action.take"]);
    assert.match(rows[0]!.summary, /^Unbanned target \(case #\d+\): second chance$/);
    assert.match(rows[1]!.summary, /^Cleared the timeout of target \(case #\d+\)$/);
  });

  test("the dashboard path writes one entry, under the name and role the dashboard gives", async () => {
    await performAction(context(), input({ origin: "dashboard", audit: { actorName: "Ada (dashboard)", actorRole: "admin", targetName: "Target" } }));
    const rows = await entries();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.actorName, "Ada (dashboard)");
    assert.equal(rows[0]!.actorRole, "admin");
    assert.match(rows[0]!.summary, /^Warned Target /);
  });

  test("a caller that writes its own entry can turn this one off", async () => {
    await performAction(context(), input({ origin: "dashboard", audit: { skip: true } }));
    assert.equal((await entries()).length, 0);
  });

  test("an action Discord refuses leaves no entry", async () => {
    await assert.rejects(performAction(context(), input({ action: "unban" })));
    assert.equal((await entries()).length, 0);
  });
});
