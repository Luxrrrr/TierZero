import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import { createTestDatabase } from "./db-helper.ts";
import { moderationSettingsWith } from "./settings-helper.ts";

const GUILD = "100000000000000020";
const OWNER = "100000000000000021";
const BOT = "100000000000000022";
const ACTOR = "100000000000000023";
const TARGET = "100000000000000024";
const STRANGER = "100000000000000025";

const db = createTestDatabase();
const { prisma, createInfraction } = await import("@tier0/db");
const { performAction } = await import("../dist/perform.js");
const { ActionRefused } = await import("../dist/action-rules.js");

interface World {
  sent: { to: string; text: string; values: Record<string, unknown> }[];
  discord: string[];
  failBan: boolean;
  /** Who Discord says is in the server. */
  members: Map<string, ReturnType<typeof member>>;
  /** The ban Discord reports for anyone, or null for none. */
  banned: boolean;
}

let world: World;

function member(
  id: string,
  options: { top?: number; perms?: bigint[]; moderatable?: boolean; kickable?: boolean; bannable?: boolean } = {},
) {
  const perms = options.perms ?? [];
  return {
    id,
    roles: { highest: { position: options.top ?? 1 } },
    permissions: { has: (flag: bigint) => perms.includes(flag) },
    moderatable: options.moderatable ?? true,
    kickable: options.kickable ?? true,
    bannable: options.bannable ?? true,
    isCommunicationDisabled: () => true,
    timeout: async () => {
      world.discord.push(`timeout ${id}`);
    },
    kick: async () => {
      world.discord.push(`kick ${id}`);
    },
  };
}

const discordError = (code: number) => Object.assign(new Error("Discord said no"), { code });

function context(stored: Record<string, unknown> = {}) {
  const guild = {
    id: GUILD,
    ownerId: OWNER,
    members: {
      me: { roles: { highest: { position: 10 } } },
      fetch: async (id: string) => {
        const found = world.members.get(id);
        if (!found) throw discordError(10007);
        return found;
      },
      ban: async (id: string) => {
        if (world.failBan) throw discordError(50013);
        world.discord.push(`ban ${id}`);
      },
      unban: async (id: string) => {
        world.discord.push(`unban ${id}`);
      },
    },
    bans: {
      fetch: async () => {
        if (!world.banned) throw discordError(10026);
        return { user: { id: STRANGER } };
      },
    },
    channels: { cache: new Map() },
  };
  return {
    client: { user: { id: BOT }, users: { fetch: async (id: string) => ({ id }) } },
    guild,
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
    send: async (target: { id: string }, body: { content?: string; embeds?: { description?: string }[] }, values: Record<string, unknown> = {}) => {
      // The stock messages are embeds, an owner's plain text is content.
      world.sent.push({ to: target.id, text: body.content || body.embeds?.[0]?.description || "", values });
      return {};
    },
  } as never;
}

const ALL_PERMISSIONS = [
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
];

function input(overrides: Record<string, unknown> = {}) {
  return {
    action: "warn",
    targetId: TARGET,
    targetName: "target",
    moderatorId: ACTOR,
    reason: "because",
    durationMs: null,
    deleteDays: null,
    actorMember: member(ACTOR, { top: 5, perms: ALL_PERMISSIONS }),
    actorIsInstanceOwner: false,
    origin: "command",
    ...overrides,
  } as never;
}

async function refused(promise: Promise<unknown>): Promise<{ status: number; message: string; code: string | undefined; values: Record<string, unknown> }> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ActionRefused, `expected a refusal, got ${String(error)}`);
    return { status: error.status, message: error.message, code: error.code, values: error.values };
  }
  return assert.fail("expected the action to be refused");
}

const cases = () => prisma.infraction.findMany({ orderBy: { id: "asc" } });

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Perform test guild" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

beforeEach(async () => {
  world = {
    sent: [],
    discord: [],
    failBan: false,
    banned: false,
    members: new Map([
      [TARGET, member(TARGET)],
      [ACTOR, member(ACTOR)],
    ]),
  };
  await prisma.infraction.deleteMany();
  await prisma.staffMember.deleteMany();
});

describe("who may act", () => {
  const nobody = () => member(ACTOR, { top: 5 });

  test("a member with no permission and no staff role cannot warn or ban, even from a command that was made visible to them", async () => {
    for (const action of ["warn", "ban"]) {
      const result = await refused(performAction(context(), input({ action, actorMember: nobody() })));
      assert.equal(result.status, 403);
      assert.match(result.message, /not allowed/);
    }
    assert.equal((await cases()).length, 0);
    assert.deepEqual(world.sent, []);
    assert.deepEqual(world.discord, []);
  });

  test("the Discord permission is enough", async () => {
    const actor = member(ACTOR, { top: 5, perms: [PermissionFlagsBits.ModerateMembers] });
    const { record } = await performAction(context(), input({ actorMember: actor }));
    assert.equal(record.action, "warn");
  });

  test("a staff role is enough, at the level it covers", async () => {
    await prisma.staffMember.create({ data: { guildId: GUILD, userId: ACTOR, role: "mod", addedBy: OWNER } });
    await performAction(context(), input({ actorMember: nobody() }));
    const result = await refused(performAction(context(), input({ action: "ban", actorMember: nobody() })));
    assert.equal(result.status, 403);
  });

  test("refuses acting on yourself, the bot or the server owner, from a command", async () => {
    world.members.set(OWNER, member(OWNER, { top: 9 }));
    for (const targetId of [ACTOR, BOT, OWNER]) {
      const result = await refused(performAction(context(), input({ targetId })));
      assert.equal(result.status, 403, targetId);
    }
    assert.equal((await cases()).length, 0);
  });
});

describe("checks before anyone is told", () => {
  test("a member Discord will not time out is refused before they are messaged", async () => {
    world.members.set(TARGET, member(TARGET, { moderatable: false }));
    const result = await refused(performAction(context(), input({ action: "timeout", durationMs: 60_000 })));
    assert.match(result.message, /cannot time that member out/);
    assert.deepEqual(world.sent, []);
    assert.deepEqual(world.discord, []);
  });

  test("the same for a kick and a ban", async () => {
    world.members.set(TARGET, member(TARGET, { kickable: false, bannable: false }));
    await refused(performAction(context(), input({ action: "kick" })));
    await refused(performAction(context(), input({ action: "ban" })));
    assert.deepEqual(world.sent, []);
    assert.equal((await cases()).length, 0);
  });

  test("a ban that Discord refuses after the member was messaged sends them a correction", async () => {
    world.failBan = true;
    const result = await refused(performAction(context(), input({ action: "ban" })));

    assert.equal(result.status, 502);
    assert.match(result.message, /sent a correction/);
    assert.equal(world.sent.length, 2);
    assert.match(world.sent[1]!.text, /^Correction: /);
    assert.equal(world.sent[1]!.to, TARGET);
    assert.equal((await cases()).length, 0, "no case for an action that did not happen");
  });

  test("a ban that Discord refuses when no message went out sends no correction", async () => {
    world.failBan = true;
    world.members.delete(TARGET);
    const result = await refused(performAction(context(), input({ action: "ban" })));
    assert.doesNotMatch(result.message, /correction/);
    assert.deepEqual(world.sent, []);
  });
});

describe("messaging someone who is not in the server", () => {
  test("a slash ban on any user id does not message them, but still bans", async () => {
    world.members.delete(TARGET);
    const { record, notes } = await performAction(context(), input({ action: "ban", targetId: STRANGER }));

    assert.equal(record.action, "ban");
    assert.deepEqual(world.discord, [`ban ${STRANGER}`]);
    assert.deepEqual(world.sent, []);
    assert.ok(notes.some((note) => /not sent a direct message/.test(note)));
  });

  test("a slash unban of a confirmed ban still tells them", async () => {
    world.banned = true;
    await performAction(context(), input({ action: "unban", targetId: STRANGER }));
    assert.equal(world.sent.length, 1);
    assert.equal(world.sent[0]!.to, STRANGER);
  });
});

describe("clearing a timeout", () => {
  test("closes automod's timeout as well as a moderator's", async () => {
    const base = { guildId: GUILD, userId: TARGET, moderatorId: BOT, expiresAt: new Date(Date.now() + 3_600_000), active: true };
    await createInfraction({ ...base, action: "automod-timeout" });
    await createInfraction({ ...base, moderatorId: ACTOR, action: "timeout" });
    await createInfraction({ ...base, action: "automod-warn" });

    await performAction(context(), input({ action: "timeout-clear" }));

    const active = Object.fromEntries((await cases()).filter((row) => row.action !== "timeout-clear").map((row) => [row.action, row.active]));
    assert.equal(active["automod-timeout"], false);
    assert.equal(active["timeout"], false);
    assert.equal(active["automod-warn"], true, "only timeouts are closed");
  });
});

describe("refusals carry what an owner needs to reword them", () => {
  const nobody = () => member(ACTOR, { top: 5 });
  const wording = { labels: { abilities: { ban: "verbannen" }, verbs: { ban: "den Bann setzen" } } };

  test("a command refusal names the action in the owner's words, and the dashboard keeps the plain ones", async () => {
    const fromCommand = await refused(performAction(context(wording), input({ action: "ban", actorMember: nobody() })));
    assert.equal(fromCommand.code, "noPermission");
    assert.deepEqual(fromCommand.values, { action: "verbannen" });

    const fromDashboard = await refused(performAction(context(wording), input({ action: "ban", actorMember: nobody(), origin: "dashboard" })));
    assert.equal(fromDashboard.code, "noPermission");
    assert.deepEqual(fromDashboard.values, { action: "ban members" });
    assert.match(fromDashboard.message, /You are not allowed to ban members here\./);
  });

  test("an existing ban is refused with the member's name, worded for where it was asked", async () => {
    world.banned = true;
    const fromCommand = await refused(performAction(context(), input({ action: "ban" })));
    assert.deepEqual([fromCommand.status, fromCommand.code, fromCommand.values], [409, "alreadyBanned", { name: "target" }]);
    assert.equal(fromCommand.message, "target is already banned. Use /unban first to change it.");

    const fromDashboard = await refused(performAction(context(), input({ action: "ban", origin: "dashboard" })));
    assert.equal(fromDashboard.message, "target is already banned. Lift the ban first to change it.");

    world.banned = false;
    const notBanned = await refused(performAction(context(), input({ action: "unban" })));
    assert.deepEqual([notBanned.code, notBanned.message], ["notBanned", "target is not banned."]);
  });

  test("a length that could not be read is a coded refusal, for a timeout and for a ban", async () => {
    const timeout = await refused(performAction(context(), input({ action: "timeout", durationMs: null, unreadableDuration: true })));
    assert.deepEqual([timeout.status, timeout.code, timeout.message], [400, "durationUnreadableTimeout", "Duration must look like 10m, 2h or 7d."]);
    const ban = await refused(performAction(context(), input({ action: "ban", unreadableDuration: true })));
    assert.deepEqual([ban.code, ban.message], ["durationUnreadableBan", "Duration must look like 1d or 7d."]);
  });

  test("a member Discord would refuse is named with the owner's verb", async () => {
    world.members.set(TARGET, member(TARGET, { bannable: false }));
    const result = await refused(performAction(context(wording), input({ action: "ban" })));
    assert.deepEqual([result.code, result.values], ["cannotActOn", { verb: "den Bann setzen" }]);
    assert.match(result.message, /^I cannot den Bann setzen\./);
  });

  test("a failed call after the member was messaged hands over the owner's correction wording and sends their correction", async () => {
    world.failBan = true;
    const stored = {
      labels: { verbs: { ban: "den Bann setzen" }, notes: { correctionSent: "Sie wurden korrigiert." } },
      replies: { direct: { correction: "Irrtum: {action}." } },
    };
    const result = await refused(performAction(context(stored), input({ action: "ban" })));
    assert.equal(result.code, "discordFailedRank");
    assert.deepEqual(result.values, { verb: "den Bann setzen", correctionNote: " Sie wurden korrigiert." });
    assert.equal(
      result.message,
      "I could not ban that member. Check that my role is above theirs. They had already been sent a message about it, so they were sent a correction.",
    );
    assert.equal(world.sent[1]!.text, "Irrtum: {action}.");
  });

  test("the dashboard's sentence ignores the owner's words altogether", async () => {
    world.failBan = true;
    const result = await refused(performAction(context({ labels: { verbs: { ban: "den Bann setzen" } } }), input({ action: "ban", origin: "dashboard" })));
    assert.equal(
      result.message,
      "The bot could not ban that member. Check that its role is above theirs. They had already been sent a message about it, so they were sent a correction.",
    );
  });

  test("the notes come back by name as well as worded for the dashboard", async () => {
    world.members.delete(TARGET);
    const { notes, noteKeys } = await performAction(context(), input({ action: "ban", targetId: STRANGER }));
    assert.deepEqual(noteKeys, ["banNotInServer", "dmWithheld"]);
    assert.equal(notes.length, 2);
  });
});

describe("what the member's message carries", () => {
  const evidence = [
    { id: "9001", channelId: "5001", channelName: "general", content: "check out my server", attachments: [], createdAt: "2026-10-18T12:00:00.000Z", url: "https://discord.com/channels/1/5001/9001", deleted: false },
    { id: "9002", channelId: "5001", channelName: "general", content: "@everyone join", attachments: [{ name: "ad.png", url: "https://cdn.example/ad.png", contentType: "image/png" }], createdAt: "2026-10-18T12:01:00.000Z", url: "https://discord.com/channels/1/5001/9002", deleted: true },
  ];

  test("a warning tells them the case, the messages and how many warnings count", async () => {
    await performAction(context(), input({ action: "warn", reason: "first" }));
    const { record } = await performAction(context(), input({ action: "warn", reason: "second", evidence }));
    const values = world.sent[1]!.values;
    assert.equal(values.case, record.caseNumber);
    assert.equal(values.caseNote, `Case #${record.caseNumber}`);
    assert.equal(values.warnings, 2);
    assert.equal(values.warningNote, "\nThis is warning 2.");
    assert.equal(values.evidenceTitle, "Messages");
    assert.match(String(values.evidence), /check out my server/);
    assert.match(String(values.evidence), /\(deleted\)/);
    assert.doesNotMatch(String(values.evidence), /cdn\.example/, "attachments are named, never linked");
    assert.doesNotMatch(String(values.evidence), /@everyone/, "a ping is broken");
    assert.equal(values.moderatorName, "", "the moderator is not named unless the server asks");
  });

  test("a ban carries its case before Discord is asked, and the case is gone again when Discord refuses", async () => {
    await performAction(context(), input({ action: "ban", evidence }));
    assert.equal(world.sent[0]!.values.case, (await cases())[0]!.caseNumber);
    assert.equal(world.sent[0]!.values.warnings, "");

    world.failBan = true;
    await refused(performAction(context(), input({ action: "ban", targetId: STRANGER })));
    assert.equal((await cases()).length, 1, "the refused ban left no case");
  });

  test("a timeout tells them how long, and the moderator's name shows only when the server turns that on", async () => {
    const named = { ...member(ACTOR, { top: 5, perms: ALL_PERMISSIONS }), displayName: "Ada" };
    await performAction(context({ dmShowModerator: true }), input({ action: "timeout", durationMs: 600_000, actorMember: named }));
    await performAction(context(), input({ action: "timeout", durationMs: 600_000, actorMember: named }));
    assert.equal(world.sent[0]!.values.duration, "10 minutes");
    assert.equal(world.sent[0]!.values.moderatorName, "Ada");
    assert.equal(world.sent[1]!.values.moderatorName, "");
  });

  test("a timeout cleared says the restriction was lifted, with its case", async () => {
    const { record } = await performAction(context(), input({ action: "timeout-clear" }));
    assert.match(String(world.sent[0]!.values.liftedNote), /lifted/);
    assert.equal(world.sent[0]!.values.case, record.caseNumber);
  });
});
