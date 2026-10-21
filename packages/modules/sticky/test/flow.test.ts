import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry } from "@tier0/core";
import { createTestDatabase } from "./db-helper.ts";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { default: sticky } = await import("../dist/index.js");
const { repost, remove, isPosted } = await import("../dist/post.js");

const GUILD = "600000000000000001";
const CHANNEL = "610000000000000001";
const OTHER = "610000000000000002";

const registry = new ModuleRegistry();
registry.register(sticky);

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Test" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

const text = (content: string) => ({ content, embeds: [], buttons: [], selects: [], reactions: [] });

function settingsFor(stickies: Record<string, unknown>[]) {
  const result = registry.resolveSettings("sticky", { stickies });
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors));
  return result.value as import("../dist/settings.js").StickySettings;
}

function world(stickies: Record<string, unknown>[]) {
  const sent: { channel: string; content: string; mentions: unknown }[] = [];
  const deleted: string[] = [];
  let next = 1;
  const channelOf = (id: string) => ({
    id,
    isTextBased: () => true,
    messages: { delete: async (messageId: string) => void deleted.push(messageId) },
  });
  const ctx: any = {
    guild: { id: GUILD, channels: { cache: new Map([[CHANNEL, channelOf(CHANNEL)], [OTHER, channelOf(OTHER)]]) } },
    settings: settingsFor(stickies),
    send: async (channel: { id: string }, body: { content: string }, _values: unknown, options: { mentions: unknown }) => {
      sent.push({ channel: channel.id, content: body.content, mentions: options.mentions });
      return { id: `70000000000000000${next++}` };
    },
  };
  return { ctx, sent, deleted };
}

test("the first post sends the message and remembers it", async () => {
  const { ctx, sent, deleted } = world([{ channel: CHANNEL, message: text("Read the rules") }]);
  const row = ctx.settings.stickies[0];
  assert.equal(await repost(ctx, row), true);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]?.mentions, { users: [], roles: [] });
  assert.equal(deleted.length, 0);
  assert.equal(await isPosted(GUILD, CHANNEL), true);
  await remove(ctx, CHANNEL);
});

test("a repost deletes the old copy only after the new one is out", async () => {
  const { ctx, sent, deleted } = world([{ channel: CHANNEL, message: text("Read the rules") }]);
  const row = ctx.settings.stickies[0];
  await repost(ctx, row);
  await repost(ctx, row);
  assert.equal(sent.length, 2);
  assert.deepEqual(deleted, ["700000000000000001"]);
  const stored = await prisma.stickyPost.findUnique({ where: { guildId_channelId: { guildId: GUILD, channelId: CHANNEL } } });
  assert.equal(stored?.messageId, "700000000000000002");
  await remove(ctx, CHANNEL);
});

test("two quick reposts never leave two copies", async () => {
  const { ctx, deleted } = world([{ channel: CHANNEL, message: text("Hi") }]);
  const row = ctx.settings.stickies[0];
  await repost(ctx, row);
  await Promise.all([repost(ctx, row), repost(ctx, row)]);
  // The first post, then two more that each took the one before away: one copy is left.
  assert.deepEqual(deleted, ["700000000000000001", "700000000000000002"]);
  await remove(ctx, CHANNEL);
});

test("removing deletes the message and forgets it", async () => {
  const { ctx, deleted } = world([{ channel: OTHER, message: text("Hi") }]);
  await repost(ctx, ctx.settings.stickies[0]);
  assert.equal(await remove(ctx, OTHER), true);
  assert.equal(deleted.length, 1);
  assert.equal(await isPosted(GUILD, OTHER), false);
  assert.equal(await remove(ctx, OTHER), false);
});

test("a channel the bot cannot see posts nothing", async () => {
  const { ctx, sent } = world([{ channel: "610000000000000099", message: text("Hi") }]);
  assert.equal(await repost(ctx, ctx.settings.stickies[0]), false);
  assert.equal(sent.length, 0);
});

test("changing the settings posts new rows and takes away removed ones", async () => {
  const before = world([{ channel: CHANNEL, message: text("One") }]);
  await sticky.onEnable?.(before.ctx);
  assert.equal(await isPosted(GUILD, CHANNEL), true);

  const after = world([{ channel: OTHER, message: text("Two") }]);
  await sticky.onSettingsChange?.(after.ctx, before.ctx.settings);
  assert.equal(await isPosted(GUILD, CHANNEL), false);
  assert.equal(await isPosted(GUILD, OTHER), true);
  await sticky.onDisable?.(after.ctx);
  assert.equal(await isPosted(GUILD, OTHER), false);
});

test("an unchanged row that is already posted is left alone", async () => {
  const first = world([{ channel: CHANNEL, message: text("Same") }]);
  await sticky.onEnable?.(first.ctx);
  const second = world([{ channel: CHANNEL, message: text("Same"), pause: 10_000 }]);
  await sticky.onSettingsChange?.(second.ctx, first.ctx.settings);
  assert.equal(second.sent.length, 0);
  await sticky.onDisable?.(second.ctx);
});

test("a new row whose message is already out, such as one just sent from the dashboard, is not posted again", async () => {
  await prisma.stickyPost.create({ data: { guildId: GUILD, channelId: CHANNEL, messageId: "700000000000000050" } });
  const first = world([]);
  const second = world([{ channel: CHANNEL, message: text("Just sent") }]);
  await sticky.onSettingsChange?.(second.ctx, first.ctx.settings);
  assert.equal(second.sent.length, 0);
  assert.equal(second.deleted.length, 0);
  await sticky.onDisable?.(second.ctx);
});
