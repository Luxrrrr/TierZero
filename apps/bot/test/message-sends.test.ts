import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ChannelType, Collection } from "discord.js";
import { LABEL_DEFAULTS } from "@tier0/module-system";
import { handleMessages, messageUrl, sendDto, sendMessage, type SendRecord } from "../dist/control/messages.js";

const GUILD_ID = "100000000000000001";
const CHANNEL_ID = "200000000000000002";
const SENT_ID = "300000000000000003";
const ACTOR = "700000000000000007";

function guildWith() {
  const sent: Record<string, unknown>[] = [];
  const channel = {
    id: CHANNEL_ID,
    name: "patch-notes",
    type: ChannelType.GuildText,
    isTextBased: () => true,
    isDMBased: () => false,
    isThread: () => false,
    permissionsFor: () => ({ has: () => true }),
    send: async (payload: Record<string, unknown>) => {
      sent.push(payload);
      return { id: SENT_ID, url: messageUrl(GUILD_ID, CHANNEL_ID, SENT_ID), react: async () => undefined };
    },
  };
  const guild = {
    id: GUILD_ID,
    ownerId: ACTOR,
    name: "Northwind Gaming",
    memberCount: 306,
    client: { user: { id: "999999999999999999", username: "TierZero" } },
    channels: { cache: new Collection<string, unknown>([[CHANNEL_ID, channel]]) },
    roles: { cache: new Collection<string, { id: string; name: string }>() },
    members: { me: { displayName: "TierZero" } },
    iconURL: () => null,
  };
  return { guild, sent };
}

const BODY = { actor: ACTOR, channelId: CHANNEL_ID, content: "Raid night at 8", embeds: [], buttons: [], selects: [], reactions: [] };

describe("recording what the Message creator sends", () => {
  test("a send is recorded with where it went", async () => {
    const { guild, sent } = guildWith();
    const records: SendRecord[] = [];
    const reply = await sendMessage(guild as never, BODY, { ...LABEL_DEFAULTS }, async (record) => {
      records.push(record);
    });
    assert.equal(reply.status, 200);
    assert.equal(sent.length, 1);
    assert.deepEqual(records, [{ guildId: GUILD_ID, templateId: null, channelId: CHANNEL_ID, messageId: SENT_ID, viaWebhook: false }]);
  });

  test("a record that cannot be written is a warning, not a failed send", async () => {
    const { guild } = guildWith();
    const reply = await sendMessage(guild as never, BODY, { ...LABEL_DEFAULTS }, async () => {
      throw new Error("disk full");
    });
    assert.equal(reply.status, 200);
    const warnings = (reply.body as { warnings: string[] }).warnings;
    assert.ok(warnings.some((warning) => /list of sent messages/.test(warning)));
  });

  test("nothing is recorded when Discord refuses the message", async () => {
    const { guild } = guildWith();
    const channel = guild.channels.cache.get(CHANNEL_ID) as { send: () => Promise<never> };
    channel.send = async () => {
      throw new Error("Missing Access");
    };
    const records: SendRecord[] = [];
    const reply = await sendMessage(guild as never, BODY, { ...LABEL_DEFAULTS }, async (record) => {
      records.push(record);
    });
    assert.equal(reply.status, 400);
    assert.equal(records.length, 0);
  });
});

describe("the sends list", () => {
  test("links each send to its message and names its template", () => {
    const row = { id: 4, guildId: GUILD_ID, templateId: 7, channelId: CHANNEL_ID, messageId: SENT_ID, viaWebhook: true, sentAt: new Date("2026-10-17T18:00:00Z") };
    const dto = sendDto(row, new Map([[7, "Patch notes"]]));
    assert.equal(dto.url, `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/${SENT_ID}`);
    assert.equal(dto.templateName, "Patch notes");
    assert.equal(dto.sentAt, "2026-10-17T18:00:00.000Z");
  });

  test("a deleted template leaves the send readable", () => {
    const row = { id: 4, guildId: GUILD_ID, templateId: 7, channelId: CHANNEL_ID, messageId: SENT_ID, viaWebhook: false, sentAt: new Date() };
    assert.equal(sendDto(row, new Map()).templateName, null);
  });

  test("ids in the path are checked before anything is read", async () => {
    const { guild } = guildWith();
    const bad = await handleMessages({ guild: guild as never, method: "GET", segments: ["templates", "abc", "sends"], body: undefined });
    assert.equal(bad?.status, 400);
    const forget = await handleMessages({ guild: guild as never, method: "DELETE", segments: ["sends", "-1"], body: undefined });
    assert.equal(forget?.status, 400);
  });
});
