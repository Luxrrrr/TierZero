import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./db-helper.ts";
import { moderationSettingsWith } from "./settings-helper.ts";

const GUILD = "100000000000000010";
const USER = "200000000000000010";
const BOT = "300000000000000010";
const MINUTE = 60_000;

const db = createTestDatabase();
const { prisma, createInfraction } = await import("@tier0/db");
const { liftTemporaryBan, nextUnbanAttempt, UNBAN_GIVE_UP_AFTER_MS } = await import("../dist/unban-task.js");

interface Calls {
  unban: string[];
  reasons: (string | undefined)[];
  scheduled: { kind: string; at: Date; payload: Record<string, unknown> }[];
  dms: unknown[];
}

let calls: Calls;

function discordError(code: number, message = "Discord said no") {
  return Object.assign(new Error(message), { code });
}

function context(options: { fetch?: () => Promise<unknown>; unban?: () => Promise<unknown>; stored?: Record<string, unknown> } = {}) {
  const guild = {
    id: GUILD,
    bans: { fetch: options.fetch ?? (async () => ({ user: { id: USER } })) },
    members: {
      unban: async (id: string, reason?: string) => {
        calls.unban.push(id);
        calls.reasons.push(reason);
        await options.unban?.();
      },
    },
  };
  return {
    client: { user: { id: BOT }, users: { fetch: async (id: string) => ({ id }) } },
    guild,
    settings: { ...moderationSettingsWith(options.stored), dmOnAction: true, modLogChannel: null, dmMessage: {}, modLogMessage: {} },
    tasks: {
      schedule: async (kind: string, at: Date, payload: Record<string, unknown>) => {
        calls.scheduled.push({ kind, at, payload });
      },
      cancel: async () => 0,
    },
    send: async (_target: unknown, body: unknown) => {
      calls.dms.push(body);
      return {};
    },
  } as never;
}

async function openBan() {
  return createInfraction({ guildId: GUILD, userId: USER, moderatorId: "1", action: "ban", expiresAt: new Date(Date.now() - 1000), active: true });
}

const rows = () => prisma.infraction.findMany({ orderBy: { id: "asc" } });

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Unban test guild" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

beforeEach(async () => {
  calls = { unban: [], reasons: [], scheduled: [], dms: [] };
  await prisma.infraction.deleteMany();
});

describe("liftTemporaryBan", () => {
  test("records, messages and closes the ban once Discord has lifted it", async () => {
    await openBan();
    await liftTemporaryBan({ userId: USER }, context());

    assert.deepEqual(calls.unban, [USER]);
    assert.equal(calls.dms.length, 1, "the member is told once the ban is really gone");
    assert.equal(calls.scheduled.length, 0);
    const [ban, unban] = await rows();
    assert.equal(ban!.active, false);
    assert.equal(unban!.action, "unban");
  });

  test("gives the reason the owner chose to Discord and to the case, and Temporary ban expired until they do", async () => {
    await openBan();
    await liftTemporaryBan({ userId: USER }, context());
    assert.deepEqual(calls.reasons, ["Temporary ban expired"]);
    assert.equal((await rows())[1]!.reason, "Temporary ban expired");

    await prisma.infraction.deleteMany();
    calls.reasons = [];
    await openBan();
    await liftTemporaryBan({ userId: USER }, context({ stored: { labels: { reasons: { tempBanExpired: "Zeit abgelaufen" } } } }));
    assert.deepEqual(calls.reasons, ["Zeit abgelaufen"]);
    assert.equal((await rows())[1]!.reason, "Zeit abgelaufen");
  });

  test("a failed unban is retried, and nothing is recorded or said", async () => {
    await openBan();
    const before = Date.now();
    await liftTemporaryBan({ userId: USER }, context({ unban: async () => { throw discordError(50013, "Missing Permissions"); } }));

    assert.equal(calls.dms.length, 0, "no unban message for a ban that is still in place");
    const all = await rows();
    assert.equal(all.length, 1, "no unban case is written");
    assert.equal(all[0]!.active, true, "the ban still reads as in force");
    assert.equal(calls.scheduled.length, 1);
    const retry = calls.scheduled[0]!;
    assert.equal(retry.kind, "unban");
    assert.equal(retry.payload.userId, USER);
    assert.equal(retry.payload.attempt, 1);
    assert.ok(retry.at.getTime() >= before + MINUTE - 50 && retry.at.getTime() <= Date.now() + MINUTE + 50);
  });

  test("a failed ban lookup is not read as the ban being gone", async () => {
    await openBan();
    await liftTemporaryBan({ userId: USER }, context({ fetch: async () => { throw discordError(500, "Server error"); } }));

    assert.deepEqual(calls.unban, []);
    assert.equal(calls.scheduled.length, 1);
    assert.equal((await rows())[0]!.active, true);
  });

  test("Unknown Ban means someone already lifted it: the record is closed quietly", async () => {
    await openBan();
    await liftTemporaryBan({ userId: USER }, context({ unban: async () => { throw discordError(10026, "Unknown Ban"); } }));

    assert.equal(calls.dms.length, 0);
    assert.equal(calls.scheduled.length, 0);
    const [ban, unban] = await rows();
    assert.equal(ban!.active, false);
    assert.equal(unban!.action, "unban");
  });

  test("no ban on Discord and none on record leaves nothing behind", async () => {
    await liftTemporaryBan({ userId: USER }, context({ fetch: async () => { throw discordError(10026); } }));

    assert.deepEqual(calls.unban, []);
    assert.equal((await rows()).length, 0);
    assert.equal(calls.scheduled.length, 0);
  });

  test("leaves a newer ban alone", async () => {
    await createInfraction({ guildId: GUILD, userId: USER, moderatorId: "1", action: "ban", expiresAt: null, active: true });
    await liftTemporaryBan({ userId: USER }, context());

    assert.deepEqual(calls.unban, []);
    assert.equal(calls.scheduled.length, 0);
  });

  test("keeps backing off, then gives up after a day", async () => {
    await openBan();
    const started = Date.now();
    const failing = context({ unban: async () => { throw discordError(50013); } });

    await liftTemporaryBan({ userId: USER, attempt: 3, startedAt: started }, failing, () => started + 2 * 60 * MINUTE);
    assert.equal(calls.scheduled.length, 1);
    assert.equal(calls.scheduled[0]!.at.getTime(), started + 2 * 60 * MINUTE + 60 * MINUTE, "the delay stays at an hour");
    assert.equal(calls.scheduled[0]!.payload.startedAt, started, "the clock for giving up keeps running from the first attempt");

    calls.scheduled = [];
    await liftTemporaryBan({ userId: USER, attempt: 9, startedAt: started }, failing, () => started + UNBAN_GIVE_UP_AFTER_MS);
    assert.equal(calls.scheduled.length, 0, "after a day it is left alone");
  });
});

describe("nextUnbanAttempt", () => {
  test("waits 1, 5, 15 and then 60 minutes", () => {
    const now = 5_000_000;
    const waits = [0, 1, 2, 3, 4, 10].map((attempt) => nextUnbanAttempt(attempt, now, now)!.getTime() - now);
    assert.deepEqual(waits, [1, 5, 15, 60, 60, 60].map((m) => m * MINUTE));
  });
});
