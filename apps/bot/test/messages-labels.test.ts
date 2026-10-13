import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ChannelType, Collection } from "discord.js";
import { LABEL_DEFAULTS, type SystemLabels } from "@tier0/module-system";
import { handleMessages } from "../dist/control/messages.js";

const GUILD_ID = "100000000000000001";
const CHANNEL_ID = "200000000000000002";
const BOT_ID = "999999999999999999";

interface Hook {
  name: string;
  owner: { id: string };
  send(payload: Record<string, unknown>): Promise<unknown>;
}

function setup(existing: Hook[] = []) {
  const created: string[] = [];
  const hookPayloads: Record<string, unknown>[] = [];
  const channelPayloads: Record<string, unknown>[] = [];
  const sentMessage = { id: "300000000000000003", url: "https://discord.com/x", react: async () => undefined, pin: async () => undefined };

  const channel = {
    id: CHANNEL_ID,
    name: "general",
    type: ChannelType.GuildText,
    isTextBased: () => true,
    isDMBased: () => false,
    permissionsFor: () => ({ has: () => true }),
    send: async (payload: Record<string, unknown>) => {
      channelPayloads.push(payload);
      return sentMessage;
    },
    fetchWebhooks: async () => new Collection(existing.map((hook, index) => [String(index), hook])),
    createWebhook: async ({ name }: { name: string }) => {
      created.push(name);
      return {
        name,
        owner: { id: BOT_ID },
        send: async (payload: Record<string, unknown>) => {
          hookPayloads.push(payload);
          return sentMessage;
        },
      };
    },
  };

  const guild = {
    id: GUILD_ID,
    name: "Test server",
    memberCount: 10,
    client: { user: { id: BOT_ID, username: "TierZero" } },
    channels: { cache: new Collection<string, unknown>([[CHANNEL_ID, channel]]) },
    roles: { cache: new Collection<string, { id: string; name: string }>() },
    members: { me: { displayName: "TierZero" }, fetchMe: async () => ({ displayName: "TierZero" }) },
    iconURL: () => null,
  };
  return { guild, created, hookPayloads, channelPayloads };
}

const send = (guild: unknown, body: Record<string, unknown>, labels?: SystemLabels) =>
  handleMessages({ guild: guild as never, method: "POST", segments: ["send"], body: { channelId: CHANNEL_ID, content: "Hi", embeds: [], buttons: [], selects: [], reactions: [], ...body }, ...(labels ? { labels } : {}) });

describe("the webhook for a message sent under another name", () => {
  test("is called TierZero messages by default", async () => {
    const { guild, created } = setup();
    const reply = await send(guild, { asName: "Announcer" });
    assert.equal(reply?.status, 200);
    assert.deepEqual(created, ["TierZero messages"]);
  });

  test("takes the name the owner gave it", async () => {
    const { guild, created } = setup();
    await send(guild, { asName: "Announcer" }, { ...LABEL_DEFAULTS, webhookName: "Announcements" });
    assert.deepEqual(created, ["Announcements"]);
  });

  test("reuses the webhook it already made under that name", async () => {
    const sent: Record<string, unknown>[] = [];
    const existing: Hook = { name: "Announcements", owner: { id: BOT_ID }, send: async (payload) => (sent.push(payload), { id: "1", url: "u", react: async () => undefined }) };
    const { guild, created } = setup([existing]);
    await send(guild, { asName: "Announcer" }, { ...LABEL_DEFAULTS, webhookName: "Announcements" });
    assert.deepEqual(created, []);
    assert.equal(sent.length, 1);
  });

  test("makes a new one when the owner renames it, since the old one is found by its name", async () => {
    const old: Hook = { name: "TierZero messages", owner: { id: BOT_ID }, send: async () => ({ id: "1", url: "u", react: async () => undefined }) };
    const { guild, created } = setup([old]);
    await send(guild, { asName: "Announcer" }, { ...LABEL_DEFAULTS, webhookName: "Announcements" });
    assert.deepEqual(created, ["Announcements"]);
  });
});

describe("who {sender} is when the dashboard does not say", () => {
  test("is the dashboard by default", async () => {
    const { guild, channelPayloads } = setup();
    await send(guild, { content: "From {sender}" });
    assert.equal(channelPayloads[0]?.content, "From the dashboard");
  });

  test("is what the owner wrote", async () => {
    const { guild, channelPayloads } = setup();
    await send(guild, { content: "From {sender}" }, { ...LABEL_DEFAULTS, defaultSender: "the staff team" });
    assert.equal(channelPayloads[0]?.content, "From the staff team");
  });

  test("is still the name the dashboard sent when there is one", async () => {
    const { guild, channelPayloads } = setup();
    await send(guild, { content: "From {sender}", sender: "Ada" }, { ...LABEL_DEFAULTS, defaultSender: "the staff team" });
    assert.equal(channelPayloads[0]?.content, "From Ada");
  });
});
