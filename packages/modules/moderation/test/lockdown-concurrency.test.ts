import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { createTestDatabase } from "./db-helper.ts";
import { moderationSettingsWith } from "./settings-helper.ts";

const GUILD = "100000000000000030";
const CHANNEL = "400000000000000030";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { lockChannels, unlockChannels, lockPatch, LOCK_PERMISSIONS } = await import("../dist/lockdown.js");

/** A channel whose @everyone overwrite behaves as Discord's does, with the round trip taking a moment. */
function fakeChannel(initial: { allow: bigint; deny: bigint } | null) {
  let overwrite = initial;
  const cache = {
    get: () => (overwrite ? { allow: { bitfield: overwrite.allow }, deny: { bitfield: overwrite.deny } } : undefined),
  };
  return {
    id: CHANNEL,
    name: "general",
    type: ChannelType.GuildText,
    parent: null,
    parentId: null,
    rawPosition: 0,
    isTextBased: () => false,
    permissionsFor: () => ({ has: () => true }),
    permissionOverwrites: {
      cache,
      edit: async (_id: string, patch: Record<string, boolean | null>) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        let allow = overwrite?.allow ?? 0n;
        let deny = overwrite?.deny ?? 0n;
        for (const [name, value] of Object.entries(patch)) {
          const flag = PermissionFlagsBits[name as keyof typeof PermissionFlagsBits];
          allow &= ~flag;
          deny &= ~flag;
          if (value === true) allow |= flag;
          if (value === false) deny |= flag;
        }
        overwrite = { allow, deny };
      },
      delete: async () => {
        overwrite = null;
      },
    },
    state: () => overwrite,
  };
}

function context(channel: ReturnType<typeof fakeChannel>) {
  return {
    guild: {
      id: GUILD,
      roles: { everyone: { id: GUILD } },
      channels: { cache: new Map([[CHANNEL, channel]]) },
    },
    settings: moderationSettingsWith({ lockdown: { notify: false } }),
    tasks: { schedule: async () => undefined, cancel: async () => 0 },
    send: async () => ({}),
  } as never;
}

const request = { channels: [CHANNEL], actorId: "1", reason: null, endsAt: null };
const everything = LOCK_PERMISSIONS.reduce((sum, name) => sum | PermissionFlagsBits[name], 0n);

describe("overlapping locks", () => {
  before(async () => {
    await prisma.guild.upsert({ where: { id: GUILD }, create: { id: GUILD, name: "Lockdown test guild" }, update: {} });
  });
  after(async () => {
    await prisma.$disconnect();
    db.cleanup();
  });

  test("a second lock started during the first never records the locked state, so unlocking restores the original", async () => {
    const channel = fakeChannel(null);
    const ctx = context(channel);
    const [first, second] = await Promise.all([lockChannels(ctx, request), lockChannels(ctx, request)]);
    assert.deepEqual(first.changed, [CHANNEL]);
    assert.deepEqual(second.changed, []);
    assert.deepEqual(second.skipped, [CHANNEL]);
    assert.equal(channel.state()?.deny, everything);

    const result = await unlockChannels(ctx, "all");
    assert.deepEqual(result.changed, [CHANNEL]);
    assert.equal(channel.state(), null);
    assert.equal(await prisma.lockedChannel.count({ where: { guildId: GUILD } }), 0);
  });

  test("an unlock started during a lock waits for it, so the channel is not left locked with no record", async () => {
    const channel = fakeChannel({ allow: PermissionFlagsBits.AddReactions, deny: 0n });
    const ctx = context(channel);
    const locking = lockChannels(ctx, request);
    const unlocking = unlockChannels(ctx, "all");
    await Promise.all([locking, unlocking]);
    assert.equal(channel.state()?.allow, PermissionFlagsBits.AddReactions);
    assert.equal(channel.state()?.deny, 0n);
    assert.equal(await prisma.lockedChannel.count({ where: { guildId: GUILD } }), 0);
  });

  test("an existing record is never overwritten by a later lock", async () => {
    const channel = fakeChannel(null);
    const ctx = context(channel);
    await lockChannels(ctx, request);
    const before = await prisma.lockedChannel.findFirstOrThrow({ where: { guildId: GUILD } });
    await lockChannels(ctx, { ...request, actorId: "2" });
    const after = await prisma.lockedChannel.findFirstOrThrow({ where: { guildId: GUILD } });
    assert.equal(after.previous, before.previous);
    assert.equal(after.lockedBy, "1");
    assert.equal(JSON.parse(after.previous).had, false);
    await unlockChannels(ctx, "all");
    assert.equal(channel.state(), null);
    assert.ok(Object.keys(lockPatch()).length > 0);
  });
});
