import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import { DELETE_MESSAGES_LIMIT, clearDeletionNotes, deletedMessagesText, readEvidence, takeDeletionNote, type EvidenceMessage } from "@tier0/core";
import { createTestDatabase } from "./db-helper.ts";
import { moderationSettingsWith } from "./settings-helper.ts";

const GUILD = "100000000000000060";
const OWNER = "100000000000000061";
const BOT = "100000000000000062";
const ACTOR = "100000000000000063";
const TARGET = "100000000000000064";
const CHANNEL = "100000000000000065";
const OTHER_CHANNEL = "100000000000000066";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { performAction } = await import("../dist/perform.js");
const { ActionRefused } = await import("../dist/action-rules.js");
const { deleteAttachedMessages, deletionNotes } = await import("../dist/delete-evidence.js");
const { resolveEvidence } = await import("../dist/evidence.js");
const { recentMessages } = await import("../dist/recent-messages.js");

interface World {
  sent: { to: string; values: Record<string, unknown> }[];
  /** Message ids the fake Discord was asked to delete, in order. */
  deleteCalls: string[];
  /** Message ids Discord reports as already gone. */
  gone: Set<string>;
  /** Message ids Discord refuses to delete. */
  refused: Set<string>;
  /** Channels where the bot may manage messages. */
  manageable: Set<string>;
  failBan: boolean;
  /** Set when the first delete call sees the case already written, to show the order. */
  caseCountAtFirstDelete: number | null;
}

let world: World;

const discordError = (code: number) => Object.assign(new Error("Discord said no"), { code });

function member(id: string, perms: bigint[] = [], name = "Mod") {
  return {
    id,
    displayName: name,
    roles: { highest: { position: id === ACTOR ? 5 : 1 } },
    permissions: { has: (flag: bigint) => perms.includes(flag) },
    moderatable: true,
    kickable: true,
    bannable: true,
    isCommunicationDisabled: () => true,
    timeout: async () => undefined,
    kick: async () => undefined,
  };
}

function channel(id: string, name: string) {
  return {
    id,
    name,
    isTextBased: () => true,
    isDMBased: () => false,
    permissionsFor: () => ({
      has: (flags: bigint | bigint[]) => {
        const list = Array.isArray(flags) ? flags : [flags];
        return list.every((flag) => flag === PermissionFlagsBits.ViewChannel || world.manageable.has(id));
      },
    }),
    messages: {
      delete: async (messageId: string) => {
        if (world.caseCountAtFirstDelete === null) world.caseCountAtFirstDelete = await prisma.infraction.count();
        world.deleteCalls.push(messageId);
        if (world.gone.has(messageId)) throw discordError(10008);
        if (world.refused.has(messageId)) throw discordError(50013);
      },
      fetch: async () => null,
    },
  };
}

function guild() {
  return {
    id: GUILD,
    ownerId: OWNER,
    members: {
      me: { roles: { highest: { position: 10 } } },
      fetch: async (id: string) => {
        if (id !== TARGET) throw discordError(10007);
        return member(TARGET);
      },
      ban: async () => {
        if (world.failBan) throw discordError(50013);
      },
      unban: async () => undefined,
    },
    bans: { fetch: async () => Promise.reject(discordError(10026)) },
    channels: {
      cache: new Map([
        [CHANNEL, channel(CHANNEL, "general")],
        [OTHER_CHANNEL, channel(OTHER_CHANNEL, "memes")],
      ]),
    },
  };
}

function context(stored: Record<string, unknown> = {}) {
  return {
    client: { user: { id: BOT }, users: { fetch: async (id: string) => ({ id }) } },
    guild: guild(),
    settings: {
      ...moderationSettingsWith(stored),
      dmOnAction: true,
      modLogChannel: null,
      requireReason: false,
      deleteMessageDays: 0,
      defaultTimeoutDuration: 600_000,
      dmMessage: {},
      modLogMessage: {},
    },
    tasks: { schedule: async () => undefined, cancel: async () => 0 },
    send: async (target: { id: string }, _body: unknown, values: Record<string, unknown> = {}) => {
      world.sent.push({ to: target.id, values });
      return {};
    },
  } as never;
}

function copy(n: number, over: Partial<EvidenceMessage> = {}): EvidenceMessage {
  const id = `2000000000000000${String(n).padStart(2, "0")}`;
  return {
    id,
    channelId: CHANNEL,
    channelName: "general",
    content: `spam number ${n}`,
    attachments: [],
    createdAt: "2026-10-18T12:00:00.000Z",
    url: `https://discord.com/channels/${GUILD}/${CHANNEL}/${id}`,
    deleted: false,
    ...over,
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
    actorMember: member(ACTOR, [PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers]),
    actorIsInstanceOwner: false,
    origin: "dashboard",
    ...overrides,
  } as never;
}

const stored = async () => {
  const [row] = await prisma.infraction.findMany({ orderBy: { id: "desc" }, take: 1 });
  return { row: row!, evidence: readEvidence(row?.evidence) };
};

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Delete with action" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

beforeEach(async () => {
  world = { sent: [], deleteCalls: [], gone: new Set(), refused: new Set(), manageable: new Set([CHANNEL, OTHER_CHANNEL]), failBan: false, caseCountAtFirstDelete: null };
  clearDeletionNotes();
  await prisma.infraction.deleteMany();
});

describe("deleting the attached messages with the action", () => {
  test("deletes them after the case is written, and marks them on it with their text kept", async () => {
    const evidence = [copy(1), copy(2)];
    const { record, notes, deletion } = await performAction(context(), input({ action: "warn", evidence, deleteMessages: true }));

    assert.deepEqual(world.deleteCalls, evidence.map((m) => m.id));
    assert.equal(world.caseCountAtFirstDelete, 1, "the case existed before anything was deleted");
    assert.equal(deletion?.deleted.length, 2);
    assert.ok(notes.includes("Deleted 2 messages."));

    const saved = (await stored()).evidence;
    assert.equal(saved.length, 2);
    for (const [index, message] of saved.entries()) {
      assert.equal(message.deleted, true);
      assert.equal(message.deletedWithAction, true);
      assert.equal(message.deletedBy, "moderator");
      assert.equal(message.deletedByName, "Mod");
      assert.ok(message.deletedAt);
      assert.equal(message.content, `spam number ${index + 1}`, "the copy of what was said is kept");
    }
    assert.equal(deletedMessagesText(readEvidence(record.evidence)), "Deleted 2 messages");
  });

  test("asks for nothing to be deleted unless it was asked", async () => {
    await performAction(context(), input({ evidence: [copy(1)] }));
    await performAction(context(), input({ evidence: [copy(1)], deleteMessages: false }));
    assert.deepEqual(world.deleteCalls, []);
    assert.equal((await stored()).evidence[0]?.deletedWithAction, undefined);
  });

  test("works for a timeout, a kick and a ban, and never for lifting one", async () => {
    for (const action of ["timeout", "kick", "ban"]) {
      world.deleteCalls = [];
      await performAction(context(), input({ action, durationMs: 60_000, evidence: [copy(1)], deleteMessages: true }));
      assert.deepEqual(world.deleteCalls, [copy(1).id], action);
    }
    for (const action of ["timeout-clear", "unban"]) {
      world.deleteCalls = [];
      await performAction(context(), input({ action, evidence: [copy(1)], deleteMessages: true })).catch((error: unknown) => {
        if (!(error instanceof ActionRefused)) throw error;
      });
      assert.deepEqual(world.deleteCalls, [], action);
    }
  });

  test("an action Discord refuses deletes nothing and leaves no case", async () => {
    world.failBan = true;
    await assert.rejects(performAction(context(), input({ action: "ban", evidence: [copy(1)], deleteMessages: true })), ActionRefused);
    assert.deepEqual(world.deleteCalls, []);
    assert.equal(await prisma.infraction.count(), 0);
  });

  test("a refusal before the action deletes nothing", async () => {
    await assert.rejects(
      performAction(context(), input({ evidence: [copy(1)], deleteMessages: true, actorMember: member(ACTOR) })),
      ActionRefused,
    );
    assert.deepEqual(world.deleteCalls, []);
  });

  test("without Manage Messages the action goes through and the result says so", async () => {
    world.manageable.clear();
    const { notes, deletion } = await performAction(context(), input({ evidence: [copy(1)], deleteMessages: true }));

    assert.deepEqual(world.deleteCalls, []);
    assert.equal(deletion?.deleted.length, 0);
    assert.ok(notes.some((note) => /could not be deleted \(#general\)/.test(note) && /Manage Messages/.test(note)), notes.join(" | "));
    const saved = await stored();
    assert.equal(saved.row.action, "warn");
    assert.equal(saved.evidence[0]?.deletedWithAction, undefined);
    assert.equal(saved.evidence[0]?.deleted, false);
  });

  test("a message that is already deleted is tolerated and not claimed by the action", async () => {
    const evidence = [copy(1), copy(2)];
    world.gone.add(evidence[0]!.id);
    const { notes, deletion } = await performAction(context(), input({ evidence, deleteMessages: true }));

    assert.deepEqual(deletion?.alreadyGone, [evidence[0]!.id]);
    assert.deepEqual(deletion?.deleted, [evidence[1]!.id]);
    assert.deepEqual(deletion?.failed, []);
    assert.ok(notes.includes("Deleted 1 message."));
    assert.equal(takeDeletionNote(evidence[0]!.id), null, "no moderator note is left for a message the action did not delete");
    const saved = (await stored()).evidence;
    assert.equal(saved[0]?.deleted, true);
    assert.equal(saved[0]?.deletedWithAction, undefined);
    assert.equal(saved[1]?.deletedWithAction, true);
  });

  test("a message Discord refuses is reported and the rest are still deleted", async () => {
    const evidence = [copy(1), copy(2)];
    world.refused.add(evidence[0]!.id);
    const { notes, deletion } = await performAction(context(), input({ evidence, deleteMessages: true }));

    assert.deepEqual(world.deleteCalls, evidence.map((m) => m.id));
    assert.equal(deletion?.failed.length, 1);
    assert.equal(deletion?.deleted.length, 1);
    assert.ok(notes.some((note) => /The action went through, but 1 message could not be deleted/.test(note)));
    assert.equal(takeDeletionNote(evidence[0]!.id), null);
  });

  test("deletes at most twenty and says how many were left", async () => {
    const evidence = Array.from({ length: DELETE_MESSAGES_LIMIT + 5 }, (_, i) => copy(i + 1));
    const report = await deleteAttachedMessages(guild() as never, evidence, { id: ACTOR });
    assert.equal(report.deleted.length, DELETE_MESSAGES_LIMIT);
    assert.equal(report.beyondLimit, 5);
    assert.equal(world.deleteCalls.length, DELETE_MESSAGES_LIMIT);
    assert.ok(deletionNotes(report).some((note) => /Only the first 20 messages/.test(note) && /5 messages were left/.test(note)));
  });

  test("never reaches a message that is not in the attached copies, or a channel the server does not have", async () => {
    const stray = copy(9, { channelId: "100000000000000099", channelName: "elsewhere" });
    const report = await deleteAttachedMessages(guild() as never, [stray], { id: ACTOR });
    assert.deepEqual(world.deleteCalls, []);
    assert.equal(report.failed.length, 1);

    await performAction(context(), input({ evidence: [copy(1)], deleteMessages: true }));
    assert.deepEqual(world.deleteCalls, [copy(1).id], "only the attached message");
  });

  test("a message from another member is refused when it is attached, before anything can be deleted", async () => {
    await assert.rejects(
      resolveEvidence(guild() as never, TARGET, [{ channelId: "100000000000000099", messageId: "200000000000000001" }], { member: null, isOwner: true }),
      (error: unknown) => error instanceof ActionRefused && error.status === 400,
    );
    assert.deepEqual(world.deleteCalls, []);
  });

  test("a message by someone else in this server is refused when it is attached", async () => {
    const foreign = copy(7);
    recentMessages.record(GUILD, { id: foreign.id, channelId: CHANNEL, channelName: "general", authorId: "100000000000000077", content: "not theirs", attachments: [], createdAt: Date.now(), deleted: false });
    await assert.rejects(
      resolveEvidence(guild() as never, TARGET, [{ channelId: CHANNEL, messageId: foreign.id }], { member: null, isOwner: true }),
      (error: unknown) => error instanceof ActionRefused && error.status === 400 && /wasn't sent by this member/.test(error.message),
    );
    assert.deepEqual(world.deleteCalls, []);
  });

  test("tells the server log a moderator deleted the message", async () => {
    const evidence = [copy(1)];
    await performAction(context(), input({ evidence, deleteMessages: true }));
    assert.deepEqual(takeDeletionNote(evidence[0]!.id), { by: "moderator", byId: ACTOR, byName: "Mod" });
  });

  test("the direct message still shows what the message said, as a removed message", async () => {
    await performAction(context(), input({ evidence: [copy(1)], deleteMessages: true }));
    const dm = world.sent.find((entry) => entry.to === TARGET);
    const text = String(dm?.values.evidence);
    assert.match(text, /spam number 1/);
    assert.match(text, /\(deleted\)/);
    assert.doesNotMatch(text, /Jump to message/);
  });

  test("the direct message keeps its link when nothing will be deleted", async () => {
    await performAction(context(), input({ evidence: [copy(1)] }));
    const text = String(world.sent.find((entry) => entry.to === TARGET)?.values.evidence);
    assert.match(text, /Jump to message/);
  });
});

describe("the setting", () => {
  test("starts off, and is the server's to turn on", () => {
    assert.equal(moderationSettingsWith({}).deleteMessagesByDefault, false);
    assert.equal(moderationSettingsWith({ deleteMessagesByDefault: true }).deleteMessagesByDefault, true);
  });

  test("a server that stored settings before it existed reads as off", () => {
    assert.equal(moderationSettingsWith({ dmOnAction: false, requireReason: true }).deleteMessagesByDefault, false);
  });
});
