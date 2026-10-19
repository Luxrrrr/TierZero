import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ChannelType, Collection, PermissionFlagsBits } from "discord.js";
import { handleMessages } from "../dist/control/messages.js";
import { roleActionsOf, senderProblem } from "../dist/control/message-rights.js";

const GUILD_ID = "100000000000000001";
const CHANNEL_ID = "200000000000000002";
const BOT_ID = "999999999999999999";
const OWNER = "700000000000000001";
const MANAGER = "700000000000000002";
const OUTSIDER = "700000000000000003";
const ROLE = "800000000000000001";

// Names an install owner so the check never reaches for a database, and nobody in these tests is it.
process.env.INSTANCE_OWNER_ID = "700000000000000009";

type Granted = bigint[];

const memberWith = (granted: Granted, top = 5) => ({
  permissions: { has: (flag: bigint) => granted.includes(flag) },
  roles: { highest: { position: top } },
});

function setup() {
  const sent: Record<string, unknown>[] = [];
  const channelRights = new Map<string, Granted>([
    [MANAGER, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]],
    [OUTSIDER, []],
  ]);
  const channel = {
    id: CHANNEL_ID,
    name: "announcements",
    type: ChannelType.GuildText,
    isTextBased: () => true,
    isDMBased: () => false,
    isThread: () => false,
    // The bot may send anywhere here. What differs is the person asking.
    permissionsFor: (who: { id?: string }) => {
      if (who.id === undefined || who.id === BOT_ID) return { has: () => true };
      const granted = channelRights.get(who.id) ?? [];
      return { has: (flag: bigint) => granted.includes(flag) };
    },
    send: async (payload: Record<string, unknown>) => {
      sent.push(payload);
      return { id: "300000000000000003", url: "https://discord.com/x", react: async () => undefined };
    },
    fetchWebhooks: async () => new Collection(),
    createWebhook: async () => ({ name: "x", owner: { id: BOT_ID }, send: async () => ({ id: "1", url: "u" }) }),
  };
  const members = new Map<string, unknown>([
    [MANAGER, { id: MANAGER, ...memberWith([PermissionFlagsBits.ManageGuild], 5) }],
    [OUTSIDER, { id: OUTSIDER, ...memberWith([], 5) }],
  ]);
  const guild = {
    id: GUILD_ID,
    ownerId: OWNER,
    name: "Northwind",
    memberCount: 10,
    client: { user: { id: BOT_ID, username: "TierZero" } },
    channels: { cache: new Collection<string, unknown>([[CHANNEL_ID, channel]]) },
    roles: { cache: new Collection([[ROLE, { id: ROLE, name: "Admins", position: 9 }]]), fetch: async () => null },
    members: {
      me: { id: BOT_ID, displayName: "TierZero" },
      fetchMe: async () => ({ id: BOT_ID, displayName: "TierZero" }),
      fetch: async (id: string) => members.get(id) ?? Promise.reject(new Error("unknown member")),
    },
    iconURL: () => null,
  };
  return { guild, channel, sent, channelRights };
}

const send = (guild: unknown, body: Record<string, unknown>) =>
  handleMessages({
    guild: guild as never,
    method: "POST",
    segments: ["send"],
    body: { channelId: CHANNEL_ID, content: "Hello", embeds: [], buttons: [], selects: [], reactions: [], ...body },
  }) as Promise<{ status: number; body: { error?: string } }>;

describe("who may send through the Message creator", () => {
  test("the server owner may send", async () => {
    const { guild, sent } = setup();
    const reply = await send(guild, { actor: OWNER });
    assert.equal(reply.status, 200);
    assert.equal(sent.length, 1);
  });

  test("a member who can post in the channel may send", async () => {
    const { guild, sent } = setup();
    assert.equal((await send(guild, { actor: MANAGER })).status, 200);
    assert.equal(sent.length, 1);
  });

  test("a request that does not say who is sending is refused", async () => {
    const { guild, sent } = setup();
    const reply = await send(guild, {});
    assert.equal(reply.status, 403);
    assert.match(reply.body.error ?? "", /who is sending/);
    assert.equal(sent.length, 0);
  });

  test("a channel the person cannot post in is refused, though the bot can", async () => {
    const { guild, sent } = setup();
    const reply = await send(guild, { actor: OUTSIDER });
    assert.equal(reply.status, 403);
    assert.match(reply.body.error ?? "", /can't send messages in #announcements/);
    assert.equal(sent.length, 0);
  });

  test("someone who is not in the server is refused", async () => {
    const { guild } = setup();
    const reply = await send(guild, { actor: "700000000000000099" });
    assert.equal(reply.status, 403);
  });

  test("an @everyone ping needs Mention Everyone in that channel", async () => {
    const { guild, sent, channelRights } = setup();
    const refused = await send(guild, { actor: MANAGER, allowEveryone: true });
    assert.equal(refused.status, 403);
    assert.match(refused.body.error ?? "", /Mention Everyone/);
    channelRights.set(MANAGER, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.MentionEveryone]);
    assert.equal((await send(guild, { actor: MANAGER, allowEveryone: true })).status, 200);
    assert.equal(sent.length, 1);
  });

  test("sending under another name needs Manage Webhooks in that channel", async () => {
    const { guild } = setup();
    const reply = await send(guild, { actor: MANAGER, asName: "Announcer" });
    assert.equal(reply.status, 403);
    assert.match(reply.body.error ?? "", /Manage Webhooks/);
  });

  test("a button that hands out a role needs the rights to hand it out", async () => {
    const { guild, sent } = setup();
    const button = { label: "Join", emoji: "", style: "primary", url: "", disabled: false, action: { type: "role", mode: "toggle", roleId: ROLE, confirmation: "" } };
    const reply = await send(guild, { actor: MANAGER, buttons: [button] });
    assert.equal(reply.status, 403);
    assert.match(reply.body.error ?? "", /Manage Roles/);
    assert.equal(sent.length, 0);
    assert.equal((await send(guild, { actor: OWNER, buttons: [button] })).status, 200);
  });
});

describe("senderProblem", () => {
  test("a request cannot name its own rights through a field the dashboard does not set", async () => {
    const { guild, channel } = setup();
    const problem = await senderProblem(guild as never, "700000000000000099", channel as never, { allowEveryone: false, viaWebhook: false, roles: new Map() });
    assert.match(problem ?? "", /Only a member/);
  });
});

describe("roleActionsOf", () => {
  const roleAction = (roleId: string) => ({ type: "role", mode: "add", roleId, confirmation: "" });
  const none = { type: "none" };

  test("finds the roles on buttons, menus and menu choices, and skips the rest", () => {
    const found = roleActionsOf({
      content: "",
      embeds: [],
      reactions: [],
      buttons: [{ action: roleAction("1") }, { action: none }],
      selects: [{ action: roleAction("2"), options: [{ action: roleAction("3") }, { action: none }] }],
    } as never);
    assert.deepEqual([...found].sort(), [["1", "buttons[0]"], ["2", "selects[0]"], ["3", "selects[0].options[0]"]].sort());
  });
});
