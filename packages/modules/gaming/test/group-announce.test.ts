import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./db-helper.ts";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const store = await import("../dist/group-store.js");
const groups = await import("../dist/groups.js");

const GUILD = "700000000000000001";
const PANEL_CHANNEL = "710000000000000001";
const VOICE = "720000000000000001";
const OWNER = "730000000000000001";
const ROLE = "740000000000000001";

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Test" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

interface Sent {
  kind: "send" | "edit";
  values: Record<string, unknown>;
  mentions?: { roles?: string[] };
}

/** Just enough of a server and a module context for the announcement code, which only reads a few things and sends through the context. */
function fake(announce: boolean, members = 1, userLimit = 4, panel: { announce?: boolean; pingRole?: string; mode?: string } = {}) {
  const deleted: string[] = [];
  const sent: Sent[] = [];
  const messages = new Map<string, object>();
  const textChannel = {
    id: PANEL_CHANNEL,
    isTextBased: () => true,
    messages: {
      fetch: async (id: string) => messages.get(id) ?? Promise.reject(new Error("gone")),
      delete: async (id: string) => {
        deleted.push(id);
        messages.delete(id);
      },
    },
  };
  const voice = {
    id: VOICE,
    userLimit,
    isVoiceBased: () => true,
    members: { size: members },
  };
  let counter = 0;
  const ctx = {
    guild: {
      id: GUILD,
      channels: { cache: new Map<string, unknown>([[PANEL_CHANNEL, textChannel], [VOICE, voice]]) },
      members: { cache: new Map([[OWNER, { displayName: "Ada" }]]), fetch: async () => null },
    },
    settings: {
      messages: { groupAnnouncement: {} },
      groups: {
        labels: { groupJoin: "Join", groupLeave: "Leave", groupNoLimit: "No limit", groupModeOpen: "Open", groupModePrivate: "Private" },
        panels: [{ id: "panel1", channel: PANEL_CHANNEL, announce: panel.announce ?? false, pingRole: panel.pingRole, options: [{ id: "opt1", label: "LFG", game: "Valorant", announceMode: panel.mode ?? (announce ? "always" : "never"), pingRole: panel.pingRole ? undefined : ROLE }] }],
      },
    },
    send: async (_target: unknown, _body: unknown, values: Record<string, unknown>, options: { mentions?: { roles?: string[] } }) => {
      const id = `800000000000000${++counter}`;
      messages.set(id, { id, delete: async () => void deleted.push(id).valueOf() });
      sent.push({ kind: "send", values, mentions: options.mentions });
      return { id };
    },
    edit: async (_message: unknown, _body: unknown, values: Record<string, unknown>) => {
      sent.push({ kind: "edit", values });
      return {};
    },
    tasks: { cancel: async () => undefined, reschedule: async () => undefined, schedule: async () => undefined },
  };
  return { ctx: ctx as never, voice: voice as never, sent, deleted };
}

let n = 0;
const active = async (extra: { isPrivate?: boolean } = {}) => {
  n += 1;
  const group = await store.createGroup({
    guildId: GUILD,
    panelId: "panel1",
    optionId: "opt1",
    ownerId: OWNER,
    voiceChannelId: `${VOICE.slice(0, -2)}${String(n).padStart(2, "0")}`,
    number: n,
    isPrivate: extra.isPrivate ?? false,
    joinBy: new Date(Date.now() + 60_000),
  });
  await store.claimActive(group.id);
  return (await store.groupById(GUILD, group.id))!;
};

describe("placesLeft", () => {
  test("counts what is free below the limit and never goes under zero", () => {
    assert.equal(groups.placesLeft({ userLimit: 4, members: { size: 1 } } as never), 3);
    assert.equal(groups.placesLeft({ userLimit: 2, members: { size: 5 } } as never), 0);
  });

  test("is null when there is no limit", () => {
    assert.equal(groups.placesLeft({ userLimit: 0, members: { size: 3 } } as never), null);
  });
});

describe("the announcement", () => {
  test("follows the panel when the option does, and a private group opened later gets one", async () => {
    const { ctx, voice, sent } = fake(false, 1, 4, { announce: true, mode: "panel", pingRole: "750000000000000001" });
    const group = await active({ isPrivate: true });
    await groups.syncAnnouncement(ctx, group, voice);
    assert.equal(sent.length, 0);
    await store.setPrivate(group.id, false);
    await groups.syncAnnouncement(ctx, group, voice);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]!.mentions, { users: [], roles: ["750000000000000001"] });
  });

  test("an option that never announces stays quiet even when the panel announces", async () => {
    const { ctx, voice, sent } = fake(false, 1, 4, { announce: true, mode: "never" });
    await groups.syncAnnouncement(ctx, await active(), voice);
    assert.equal(sent.length, 0);
  });

  test("is posted once for an open group that announces, pinging the chosen role", async () => {
    const { ctx, voice, sent } = fake(true);
    const group = await active();
    await groups.syncAnnouncement(ctx, group, voice);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.kind, "send");
    assert.deepEqual(sent[0]!.mentions, { users: [], roles: [ROLE] });
    assert.equal(sent[0]!.values.ping, `<@&${ROLE}>`);
    assert.equal(sent[0]!.values.spots, "3");
    assert.ok((await store.groupById(GUILD, group.id))!.announcementMessageId);
  });

  test("is edited, without pinging again, when the group changes", async () => {
    const { ctx, voice, sent } = fake(true);
    const group = await active();
    await groups.syncAnnouncement(ctx, group, voice);
    await groups.syncAnnouncement(ctx, group, voice);
    assert.deepEqual(sent.map((entry) => entry.kind), ["send", "edit"]);
    assert.equal(sent[1]!.values.ping, "");
  });

  test("bursts of changes make one post, not one each", async () => {
    const { ctx, voice, sent } = fake(true);
    const group = await active();
    await Promise.all([1, 2, 3, 4].map(() => groups.syncAnnouncement(ctx, group, voice)));
    assert.equal(sent.filter((entry) => entry.kind === "send").length, 1);
  });

  test("is not posted when the option does not announce", async () => {
    const { ctx, voice, sent } = fake(false);
    await groups.syncAnnouncement(ctx, await active(), voice);
    assert.equal(sent.length, 0);
  });

  test("is not posted for a private group", async () => {
    const { ctx, voice, sent } = fake(true);
    await groups.syncAnnouncement(ctx, await active({ isPrivate: true }), voice);
    assert.equal(sent.length, 0);
  });

  test("is removed when the group is made private", async () => {
    const { ctx, voice, deleted } = fake(true);
    const group = await active();
    await groups.syncAnnouncement(ctx, group, voice);
    await store.setPrivate(group.id, true);
    await groups.syncAnnouncement(ctx, group, voice);
    assert.equal(deleted.length, 1);
    assert.equal((await store.groupById(GUILD, group.id))!.announcementMessageId, null);
  });

  test("shows the no-limit text when the voice channel has no limit", async () => {
    const { ctx, voice, sent } = fake(true, 2, 0);
    await groups.syncAnnouncement(ctx, await active(), voice);
    assert.equal(sent[0]!.values.spots, "No limit");
    assert.equal(sent[0]!.values.players, "2");
  });
});
