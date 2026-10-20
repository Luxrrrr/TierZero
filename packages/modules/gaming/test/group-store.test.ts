import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./db-helper.ts";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const store = await import("../dist/group-store.js");

const GUILD = "600000000000000001";
const OWNER = "610000000000000001";
const voice = (n: number) => `62000000000000${String(n).padStart(4, "0")}`;
const soon = () => new Date(Date.now() + 60_000);

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Test" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

const make = (n: number, extra: Partial<Parameters<typeof store.createGroup>[0]> = {}) =>
  store.createGroup({ guildId: GUILD, panelId: "panel1", optionId: "opt1", ownerId: OWNER, voiceChannelId: voice(n), number: n, isPrivate: false, joinBy: soon(), ...extra });

describe("group records", () => {
  test("start waiting for their owner and are found by voice channel within their own server", async () => {
    const group = await make(1);
    assert.equal(group.status, "waiting");
    assert.equal((await store.groupByVoice(GUILD, voice(1)))?.id, group.id);
    assert.equal(await store.groupByVoice("another", voice(1)), null);
    assert.equal(await store.groupById("another", group.id), null);
  });

  test("become active once, for the one caller that changed them", async () => {
    const group = await make(2);
    const results = await Promise.all([store.claimActive(group.id), store.claimActive(group.id), store.claimActive(group.id)]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal((await store.groupById(GUILD, group.id))?.status, "active");
    assert.equal(await store.claimActive(group.id), false);
  });

  test("remember their thread and the controls message", async () => {
    const group = await make(3);
    await store.attachThread(group.id, "630000000000000001", "640000000000000001");
    const found = await store.groupByThread(GUILD, "630000000000000001");
    assert.equal(found?.id, group.id);
    assert.equal(found?.controlsMessageId, "640000000000000001");
  });

  test("keep who can join and who runs the group", async () => {
    const group = await make(4);
    assert.equal((await store.setPrivate(group.id, true)).isPrivate, true);
    assert.equal((await store.setGroupOwner(group.id, "610000000000000009")).ownerId, "610000000000000009");
  });

  test("remember the game, empty until one is given", async () => {
    const group = await make(7);
    assert.equal(group.game, "");
    assert.equal((await store.setGame(group.id, "Apex Legends")).game, "Apex Legends");
  });

  test("find the group a member runs, and stop being found once they are deleted", async () => {
    const owner = "610000000000000005";
    const group = await make(5, { ownerId: owner });
    assert.equal((await store.groupOfOwner(GUILD, owner))?.id, group.id);
    await store.deleteGroup(group.id);
    assert.equal(await store.groupOfOwner(GUILD, owner), null);
    await store.deleteGroup(group.id);
  });

  test("a voice channel belongs to one group", async () => {
    await make(6);
    await assert.rejects(make(6));
  });
});

describe("panel posts", () => {
  test("are kept per panel and replaced when the panel is posted again", async () => {
    await store.savePanelPost(GUILD, "panelA", "650000000000000001", "660000000000000001");
    assert.equal((await store.panelPostOf(GUILD, "panelA"))?.messageId, "660000000000000001");
    await store.savePanelPost(GUILD, "panelA", "650000000000000002", "660000000000000002");
    const post = await store.panelPostOf(GUILD, "panelA");
    assert.equal(post?.messageId, "660000000000000002");
    assert.equal(post?.channelId, "650000000000000002");
    assert.equal(await prisma.groupPanelPost.count({ where: { guildId: GUILD, panelId: "panelA" } }), 1);
  });

  test("can be forgotten", async () => {
    await store.savePanelPost(GUILD, "panelB", "650000000000000001", "660000000000000003");
    await store.forgetPanelPost(GUILD, "panelB");
    assert.equal(await store.panelPostOf(GUILD, "panelB"), null);
  });
});
