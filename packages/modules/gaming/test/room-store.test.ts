import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./db-helper.ts";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const store = await import("../dist/room-store.js");

const GUILD = "400000000000000001";
const OWNER = "410000000000000001";
const channel = (n: number) => `42000000000000${String(n).padStart(4, "0")}`;

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Test" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

describe("room records", () => {
  test("are found by channel, within their own server", async () => {
    await store.recordRoom({ guildId: GUILD, channelId: channel(1), hubId: "hub1", ownerId: OWNER, number: 1 });
    assert.equal((await store.roomByChannel(GUILD, channel(1)))?.ownerId, OWNER);
    assert.equal(await store.roomByChannel("another", channel(1)), null);
    assert.equal(await store.roomByChannel(GUILD, channel(99)), null);
  });

  test("hand out the lowest number free in their hub", async () => {
    await store.recordRoom({ guildId: GUILD, channelId: channel(2), hubId: "hub2", ownerId: OWNER, number: 1 });
    await store.recordRoom({ guildId: GUILD, channelId: channel(3), hubId: "hub2", ownerId: OWNER, number: 2 });
    assert.equal(await store.nextNumber(GUILD, "hub2"), 3);
    await store.forgetRoom(channel(2));
    assert.equal(await store.nextNumber(GUILD, "hub2"), 1);
    assert.equal(await store.nextNumber(GUILD, "unused hub"), 1);
  });

  test("find the room someone owns in a hub", async () => {
    const owner = "410000000000000002";
    await store.recordRoom({ guildId: GUILD, channelId: channel(4), hubId: "hub3", ownerId: owner, number: 1 });
    assert.equal((await store.roomOwnedBy(GUILD, owner, "hub3"))?.channelId, channel(4));
    assert.equal(await store.roomOwnedBy(GUILD, owner, "hub4"), null);
  });

  test("change owner", async () => {
    await store.recordRoom({ guildId: GUILD, channelId: channel(5), hubId: "hub5", ownerId: OWNER, number: 1 });
    const updated = await store.setOwner(channel(5), "410000000000000009");
    assert.equal(updated.ownerId, "410000000000000009");
  });

  test("list for the sweep", async () => {
    const rooms = await store.roomsOf(GUILD);
    assert.ok(rooms.length >= 3);
    assert.ok(rooms.every((room) => room.guildId === GUILD));
  });

  test("forgetting a room that is not there does nothing", async () => {
    await store.forgetRoom(channel(77));
  });
});
