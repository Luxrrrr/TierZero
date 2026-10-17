import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, type FieldDescriptor, type MessageBody } from "@tier0/core";
import { createTestDatabase } from "./db-helper.ts";

const GUILD = "100000000000000060";
const USER = "200000000000000060";
const OTHER = "200000000000000061";
const CHANNEL = "300000000000000060";
const HERE = "300000000000000061";
const BRONZE = "400000000000000060";
const SILVER = "400000000000000061";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { default: leveling } = await import("../dist/index.js");
const { adjustXp, MAX_XP, totalXpForLevel } = await import("../dist/curve.js");
const { XP_CHANGED, XP_RESET, upgradeAnnounce } = await import("../dist/messages.js");

const registry = new ModuleRegistry();
registry.register(leveling);

function settingsFor(stored: unknown = {}) {
  const result = registry.resolveSettings("leveling", stored);
  assert.ok(result.ok, result.ok ? "" : result.errors.map((e) => `${e.path} ${e.message}`).join("; "));
  return result.value as Record<string, unknown> & { announce: { where: string } };
}

let replied: { body: MessageBody; values: Record<string, unknown> }[];
let sentTo: string[];

function member(id: string, holds: string[] = []) {
  const held = new Set(holds);
  return {
    id,
    user: { id, username: id },
    held,
    roles: {
      cache: { has: (role: string) => held.has(role), some: () => false, map: () => [...held] },
      add: async (role: string) => {
        held.add(role);
      },
      remove: async (role: string) => {
        held.delete(role);
      },
    },
    guild: { id: GUILD, members: { me: { roles: { highest: { position: 9 } } } }, roles: { cache: { get: () => ({ position: 1 }) } } },
  };
}

function context(stored: unknown, members: ReturnType<typeof member>[] = []) {
  const byId = new Map(members.map((entry) => [entry.id, entry]));
  return {
    settings: settingsFor(stored),
    guild: {
      id: GUILD,
      channels: { cache: { get: (id: string) => (id === CHANNEL ? { id, isTextBased: () => true } : undefined) } },
      members: {
        fetch: async (query: string | { user: string[] }) => {
          if (typeof query === "string") {
            const found = byId.get(query);
            if (!found) throw new Error("Unknown Member");
            return found;
          }
          return new Map(query.user.flatMap((id) => (byId.has(id) ? [[id, byId.get(id)!]] : [])));
        },
      },
    },
    send: async (target: { id: string }) => {
      sentTo.push(target.id);
      return {};
    },
    reply: async (_interaction: unknown, body: MessageBody, values: Record<string, unknown> = {}) => {
      replied.push({ body, values });
      return true;
    },
  } as never;
}

const xp = leveling.commands!.find((command) => command.name === "xp")!;
const slash = (sub: string, amount: number | null = null) =>
  ({
    options: {
      getSubcommand: () => sub,
      getUser: () => ({ id: USER }),
      getInteger: () => amount,
    },
  }) as never;

const stored = (id: string) => prisma.levelMember.findUnique({ where: { guildId_userId: { guildId: GUILD, userId: id } } });
const rewards = { rewards: { roles: [{ level: 2, role: BRONZE }, { level: 5, role: SILVER }] } };

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Leveling admin guild" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

beforeEach(async () => {
  replied = [];
  sentTo = [];
  await prisma.levelMember.deleteMany();
});

describe("adjustXp", () => {
  test("adds, takes and sets, never below zero or past the most a member can hold", () => {
    assert.equal(adjustXp(100, "give", 50), 150);
    assert.equal(adjustXp(100, "take", 500), 0);
    assert.equal(adjustXp(100, "set", 7), 7);
    assert.equal(adjustXp(MAX_XP, "give", 10), MAX_XP);
  });
});

describe("/xp", () => {
  test("give stores the new total and level, and gives the rewards it reaches", async () => {
    const target = member(USER);
    await xp.run(slash("give", totalXpForLevel(2)), context(rewards, [target]));
    const row = await stored(USER);
    assert.equal(row?.xp, totalXpForLevel(2));
    assert.equal(row?.level, 2);
    assert.ok(target.held.has(BRONZE));
    assert.deepEqual(replied[0]?.body, XP_CHANGED);
    assert.deepEqual(replied[0]?.values, { member: `<@${USER}>`, xp: totalXpForLevel(2), level: 2 });
  });

  test("take lowers the level, and set replaces the total", async () => {
    await prisma.levelMember.create({ data: { guildId: GUILD, userId: USER, xp: totalXpForLevel(5), level: 5 } });
    await xp.run(slash("take", totalXpForLevel(5)), context({}, [member(USER)]));
    assert.equal((await stored(USER))?.level, 0);
    await xp.run(slash("set", totalXpForLevel(3)), context({}, [member(USER)]));
    assert.equal((await stored(USER))?.level, 3);
  });

  test("reset goes back to 0, for a member who has left too", async () => {
    await prisma.levelMember.create({ data: { guildId: GUILD, userId: USER, xp: 900, level: 3 } });
    await xp.run(slash("reset"), context({}));
    const row = await stored(USER);
    assert.equal(row?.xp, 0);
    assert.equal(row?.level, 0);
    assert.deepEqual(replied[0]?.body, XP_RESET);
  });

  test("is limited to Manage Server", () => {
    const json = xp.build().toJSON() as { default_member_permissions?: string };
    assert.equal(json.default_member_permissions, "32");
  });
});

describe("rewards", () => {
  test("a reward's row gives it to members already past its level", async () => {
    await prisma.levelMember.createMany({
      data: [
        { guildId: GUILD, userId: USER, xp: totalXpForLevel(6), level: 6 },
        { guildId: GUILD, userId: OTHER, xp: 10, level: 0 },
      ],
    });
    const high = member(USER);
    const low = member(OTHER);
    const ctx = context(rewards, [high, low]);
    const action = leveling.rows!["rewards.roles"]!.actions!.sync!;
    const result = await action.run({ ctx, row: { path: "rewards.roles[0]", row: { level: 2, role: BRONZE }, parent: {} }, input: {} });
    assert.deepEqual(result, { ok: true, message: "Updated the rewards of 1 member." });
    assert.deepEqual([...high.held].sort(), [BRONZE, SILVER].sort());
    assert.equal(low.held.size, 0);

    const again = await action.run({ ctx, row: { path: "rewards.roles[0]", row: { level: 2, role: BRONZE }, parent: {} }, input: {} });
    assert.equal(again.message, "Everyone who qualifies already has their rewards.");
  });

  test("come back to a member who leaves and rejoins", async () => {
    await prisma.levelMember.create({ data: { guildId: GUILD, userId: USER, xp: totalXpForLevel(5), level: 5 } });
    const back = member(USER);
    await leveling.events!.memberJoin!(back as never, context(rewards));
    assert.deepEqual([...back.held].sort(), [BRONZE, SILVER].sort());
  });

  test("tag their role as one the bot hands out, and the exclusions and multipliers as not", () => {
    const summary = registry.describe().find((entry) => entry.id === "leveling");
    const fields = summary?.schema.fields as Record<string, FieldDescriptor>;
    const rewardsGroup = fields.rewards?.fields as Record<string, FieldDescriptor>;
    const earning = fields.earning?.fields as Record<string, FieldDescriptor>;
    const reward = (rewardsGroup.roles?.of as FieldDescriptor).fields as Record<string, FieldDescriptor>;
    const multiplier = (earning.multipliers?.of as FieldDescriptor).fields as Record<string, FieldDescriptor>;
    assert.equal(reward.role?.assigns, true);
    assert.equal((earning.noXpRoles?.of as FieldDescriptor).assigns, undefined);
    assert.equal(multiplier.role?.assigns, undefined);
  });
});

describe("settings saved before they were grouped", () => {
  test("are read from their old places", () => {
    const settings = settingsFor({
      cooldown: 120_000,
      noXpRoles: [BRONZE],
      roleRewards: [{ level: 3, role: SILVER }],
      stackRewards: false,
    }) as unknown as { earning: { cooldown: number; noXpRoles: string[] }; rewards: { roles: unknown[]; stack: boolean } };
    assert.equal(settings.earning.cooldown, 120_000);
    assert.deepEqual(settings.earning.noXpRoles, [BRONZE]);
    assert.deepEqual(settings.rewards.roles, [{ level: 3, role: SILVER }]);
    assert.equal(settings.rewards.stack, false);
  });

  test("no group on the page is a catch-all", () => {
    const summary = registry.describe().find((entry) => entry.id === "leveling");
    const loose = Object.entries(summary?.schema.fields as Record<string, FieldDescriptor>).filter(([, field]) => field.kind !== "object");
    assert.deepEqual(loose, []);
  });
});

describe("level-up announcements", () => {
  test("saved before they said where keep going to their channel, or stay off", () => {
    assert.equal(upgradeAnnounce({ channel: CHANNEL }).where, "channel");
    assert.equal(upgradeAnnounce({}).where, "off");
    assert.equal(upgradeAnnounce({ where: "dm", channel: CHANNEL }).where, "dm");
    assert.equal(settingsFor({ announce: { channel: CHANNEL } }).announce.where, "channel");
    assert.equal(settingsFor({}).announce.where, "off");
  });

  async function levelUp(announce: Record<string, unknown>) {
    const target = Object.assign(member(USER), { displayName: "Ada" });
    const message = { member: target, channelId: HERE, channel: { id: HERE, isTextBased: () => true, isThread: () => false } };
    await prisma.levelMember.deleteMany();
    await leveling.events!.messageCreate!(message as never, context({ announce, earning: { cooldown: "0s" }, xp: { min: 1000, max: 1000 } }));
  }

  test("go where the owner chose", async () => {
    await levelUp({ where: "current" });
    await levelUp({ where: "dm" });
    await levelUp({ where: "channel", channel: CHANNEL });
    await levelUp({ where: "off", channel: CHANNEL });
    assert.deepEqual(sentTo, [HERE, USER, CHANNEL]);
  });
});
