import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ChannelType, Collection } from "discord.js";
import { handleMessages, parseMessageLink } from "../dist/control/messages.js";
import { nextRun, parseSchedule } from "../dist/control/message-schedules.js";

const GUILD_ID = "100000000000000001";
const CHANNEL_ID = "200000000000000002";
const MESSAGE_ID = "300000000000000003";
const BOT_ID = "999999999999999999";
const HOOK_ID = "400000000000000004";
const LINK = `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/${MESSAGE_ID}`;

function setup(author: { kind: "bot" } | { kind: "member" } | { kind: "webhook"; ours: boolean }) {
  const edits: Record<string, unknown>[] = [];
  const hookEdits: Record<string, unknown>[] = [];
  const message = {
    id: MESSAGE_ID,
    url: LINK,
    webhookId: author.kind === "webhook" ? HOOK_ID : null,
    author: { id: author.kind === "bot" ? BOT_ID : "500000000000000005" },
    edit: async (payload: Record<string, unknown>) => {
      edits.push(payload);
      return message;
    },
  };
  const hook = {
    id: HOOK_ID,
    owner: { id: author.kind === "webhook" && author.ours ? BOT_ID : "600000000000000006" },
    editMessage: async (_id: string, payload: Record<string, unknown>) => {
      hookEdits.push(payload);
    },
  };
  const channel = {
    id: CHANNEL_ID,
    name: "rules",
    type: ChannelType.GuildText,
    isTextBased: () => true,
    isDMBased: () => false,
    isThread: () => false,
    messages: { fetch: async (id: string) => (id === MESSAGE_ID ? message : null) },
    fetchWebhooks: async () => new Collection([[HOOK_ID, hook]]),
  };
  const guild = {
    id: GUILD_ID,
    name: "Northwind Gaming",
    memberCount: 306,
    client: { user: { id: BOT_ID, username: "TierZero" } },
    channels: { cache: new Collection<string, unknown>([[CHANNEL_ID, channel]]), fetch: async () => null },
    roles: { cache: new Collection<string, { id: string; name: string }>() },
    members: { me: { displayName: "TierZero" } },
    iconURL: () => "https://cdn.discordapp.com/icons/1/a.png",
  };
  return { guild, edits, hookEdits };
}

const edit = (guild: unknown, body: Record<string, unknown>) =>
  handleMessages({ guild: guild as never, method: "POST", segments: ["edit"], body: { link: LINK, content: "New rules for {server}", embeds: [], buttons: [], selects: [], reactions: [], ...body } });

describe("parseMessageLink", () => {
  test("reads Discord's Copy Message Link format", () => {
    assert.deepEqual(parseMessageLink(LINK), { guildId: GUILD_ID, channelId: CHANNEL_ID, messageId: MESSAGE_ID });
    assert.ok(parseMessageLink(LINK.replace("discord.com", "ptb.discord.com")));
  });

  test("refuses anything else", () => {
    assert.equal(parseMessageLink(MESSAGE_ID), null);
    assert.equal(parseMessageLink("https://example.com/channels/1/2/3"), null);
    assert.equal(parseMessageLink(undefined), null);
  });
});

describe("editing a message that was already sent", () => {
  test("replaces the bot's own message, variables filled in", async () => {
    const { guild, edits } = setup({ kind: "bot" });
    const reply = await edit(guild, {});
    assert.equal(reply?.status, 200);
    assert.equal(edits[0]?.content, "New rules for Northwind Gaming");
  });

  test("clears the text when the new version has none", async () => {
    const { guild, edits } = setup({ kind: "bot" });
    await edit(guild, { content: "", embeds: [{ title: "Rules", description: "Be kind" }] });
    assert.equal(edits[0]?.content, "");
  });

  test("goes through the bot's webhook for a message sent under another name", async () => {
    const { guild, edits, hookEdits } = setup({ kind: "webhook", ours: true });
    const reply = await edit(guild, {});
    assert.equal(reply?.status, 200);
    assert.equal(edits.length, 0);
    assert.equal(hookEdits.length, 1);
  });

  test("refuses a message someone else sent", async () => {
    for (const author of [{ kind: "member" } as const, { kind: "webhook", ours: false } as const]) {
      const { guild, edits, hookEdits } = setup(author);
      const reply = await edit(guild, {});
      assert.equal(reply?.status, 403);
      assert.equal(edits.length + hookEdits.length, 0);
    }
  });

  test("refuses a link to another server", async () => {
    const { guild } = setup({ kind: "bot" });
    const reply = await edit(guild, { link: LINK.replace(GUILD_ID, "100000000000000009") });
    assert.equal(reply?.status, 400);
  });
});

describe("{server.icon} when sending", () => {
  test("is the server's icon", async () => {
    const { guild, edits } = setup({ kind: "bot" });
    await edit(guild, { content: "{server.icon}" });
    assert.equal(edits[0]?.content, "https://cdn.discordapp.com/icons/1/a.png");
  });
});

describe("nextRun", () => {
  const at = new Date("2026-10-17T18:00:00Z");

  test("a one-off send has no next time", () => {
    assert.equal(nextRun(at, "once", at), null);
  });

  test("keeps the time of day", () => {
    assert.equal(nextRun(at, "daily", new Date("2026-10-17T18:00:30Z"))?.toISOString(), "2026-10-18T18:00:00.000Z");
    assert.equal(nextRun(at, "weekly", new Date("2026-10-17T18:00:30Z"))?.toISOString(), "2026-10-24T18:00:00.000Z");
  });

  test("skips the times missed while the bot was down instead of sending them all", () => {
    assert.equal(nextRun(at, "daily", new Date("2026-10-20T19:00:00Z"))?.toISOString(), "2026-10-21T18:00:00.000Z");
  });
});

describe("parseSchedule", () => {
  const now = new Date("2026-10-17T12:00:00Z");
  const base = { channelId: CHANNEL_ID, content: "Patch night", embeds: [], buttons: [], selects: [], reactions: [] };

  test("accepts a time in the future and keeps the send options", () => {
    const parsed = parseSchedule({ ...base, runAt: "2026-10-18T12:00:00Z", repeat: "weekly", silent: true }, now);
    assert.ok(parsed.ok);
    assert.equal(parsed.value.payload.repeat, "weekly");
    assert.equal(parsed.value.payload.options.silent, true);
    assert.equal(parsed.value.payload.label, "Patch night");
  });

  test("refuses a time in the past, too soon or more than a year ahead", () => {
    assert.equal(parseSchedule({ ...base, runAt: "2026-10-16T12:00:00Z" }, now).ok, false);
    assert.equal(parseSchedule({ ...base, runAt: "2026-10-17T12:00:20Z" }, now).ok, false);
    assert.equal(parseSchedule({ ...base, runAt: "2027-12-01T12:00:00Z" }, now).ok, false);
    assert.equal(parseSchedule({ ...base, runAt: "soon" }, now).ok, false);
  });

  test("an unknown repeat is a one-off", () => {
    const parsed = parseSchedule({ ...base, runAt: "2026-10-18T12:00:00Z", repeat: "hourly" }, now);
    assert.ok(parsed.ok);
    assert.equal(parsed.value.payload.repeat, "once");
  });
});
