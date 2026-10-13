import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Collection } from "discord.js";
import { plainReply, type MessageBody } from "@tier0/core";
import { renderMessage, sendMessage } from "../dist/runtime/send-message.js";

const GUILD_ID = "100000000000000001";
const CHANNEL_ID = "200000000000000002";

const body = (overrides: Partial<MessageBody>): MessageBody => ({ ...plainReply(""), ...overrides });

const primaryButton = { label: "Go", emoji: "", style: "primary", url: "", disabled: false, action: { type: "none" } } as const;

function fakeGuild() {
  return {
    id: GUILD_ID,
    name: "Test server",
    memberCount: 1234,
    channels: { cache: new Collection<string, { id: string; name: string }>([[CHANNEL_ID, { id: CHANNEL_ID, name: "general" }]]) },
    roles: { cache: new Collection<string, { id: string; name: string }>() },
    members: { me: { displayName: "TierZero" } },
    iconURL: () => "https://cdn.example/icon.png",
  };
}

interface Sent {
  payloads: Record<string, unknown>[];
  reactions: string[];
}

function fakeChannel(guild: ReturnType<typeof fakeGuild>, sent: Sent, failWith?: Error) {
  return {
    id: CHANNEL_ID,
    name: "general",
    guild,
    client: { user: { username: "TierZero" } },
    isTextBased: () => true,
    isDMBased: () => false,
    async send(payload: Record<string, unknown>) {
      if (failWith) throw failWith;
      sent.payloads.push(payload);
      return {
        id: "300000000000000003",
        channelId: CHANNEL_ID,
        react: async (reaction: string) => {
          sent.reactions.push(reaction);
        },
      };
    },
  };
}

function fakeUser(sent: Sent, failWith?: Error) {
  return {
    id: "400000000000000004",
    client: { user: { username: "TierZero" } },
    async send(payload: Record<string, unknown>) {
      if (failWith) throw failWith;
      sent.payloads.push(payload);
      return {
        id: "500000000000000005",
        channelId: "600000000000000006",
        react: async (reaction: string) => {
          sent.reactions.push(reaction);
        },
      };
    },
  };
}

/** The sender logs what it could not do; a passing test should not print it. */
async function quietly<T>(run: () => Promise<T> | T): Promise<T> {
  const original = console.error;
  console.error = () => undefined;
  try {
    return await run();
  } finally {
    console.error = original;
  }
}

const emptySent = (): Sent => ({ payloads: [], reactions: [] });

describe("renderMessage", () => {
  test("fills in variables and lets a channel post mention people and roles only", () => {
    const rendered = renderMessage(plainReply("{user} reached level {level}"), { user: "<@1>", level: "5" });
    assert.equal(rendered?.payload.content, "<@1> reached level 5");
    assert.deepEqual(rendered?.payload.allowedMentions, { parse: ["users", "roles"] });
  });

  test("mentions nobody from a direct message", () => {
    const rendered = renderMessage(plainReply("Hello @everyone"), {}, undefined, "dm");
    assert.deepEqual(rendered?.payload.allowedMentions, { parse: [] });
  });

  test("pings only the ids it is given, with no blanket permission", () => {
    const rendered = renderMessage(plainReply("<@1> <@&2> @everyone"), {}, undefined, "channel", { users: ["1"] });
    assert.deepEqual(rendered?.payload.allowedMentions, { users: ["1"], roles: [] });
  });

  test("pings no one when given empty lists", () => {
    const rendered = renderMessage(plainReply("<@1>"), {}, undefined, "channel", { users: [], roles: [] });
    assert.deepEqual(rendered?.payload.allowedMentions, { users: [], roles: [] });
  });

  test("returns null when filling in a variable breaks Discord's limits", async () => {
    const rendered = await quietly(() => renderMessage(plainReply("{big}"), { big: "x".repeat(2001) }));
    assert.equal(rendered, null);
  });

  test("leaves braces it does not know exactly as typed", () => {
    assert.equal(renderMessage(plainReply("{nobody} {user}"), { user: "Ada" })?.payload.content, "{nobody} Ada");
  });

  test("takes reactions out of a direct message", () => {
    const rendered = renderMessage(body({ content: "Hi", reactions: ["🎉"] }), {}, undefined, "dm");
    assert.deepEqual(rendered?.message.reactions, []);
  });
});

describe("sendMessage to a channel", () => {
  test("merges the shared variables with the module's own, the module's winning", async () => {
    const sent = emptySent();
    const message = await sendMessage(
      fakeChannel(fakeGuild(), sent) as never,
      plainReply("{user} in {server} ({members}) {channel} {channel.name} by {bot}, level {level}"),
      { user: "<@1>", level: 7, server: "Overridden" },
    );
    assert.ok(message);
    assert.equal(sent.payloads[0]?.content, `<@1> in Overridden (1,234) <#${CHANNEL_ID}> general by TierZero, level 7`);
  });

  test("passes the allowed mentions through to what is sent, for the fallback too", async () => {
    const sent = emptySent();
    await quietly(() =>
      sendMessage(fakeChannel(fakeGuild(), sent) as never, plainReply("{big}"), { big: "x".repeat(2001) }, {
        fallback: plainReply("<@1> <@&2>"),
        mentions: { users: ["1"] },
      }),
    );
    assert.deepEqual(sent.payloads[0]?.allowedMentions, { users: ["1"], roles: [] });
  });

  test("adds the reactions after sending", async () => {
    const sent = emptySent();
    await sendMessage(fakeChannel(fakeGuild(), sent) as never, body({ content: "Hi", reactions: ["🎉", "👍"] }));
    assert.deepEqual(sent.reactions, ["🎉", "👍"]);
  });

  test("keeps what a message's buttons do, under the id of the sent message", async () => {
    const saved: unknown[][] = [];
    await sendMessage(fakeChannel(fakeGuild(), emptySent()) as never, body({ content: "Pick", buttons: [primaryButton] }), {}, {
      persist: async (...args) => {
        saved.push(args);
      },
    });
    assert.deepEqual(saved[0]?.slice(0, 3), [GUILD_ID, CHANNEL_ID, "300000000000000003"]);
  });

  test("sends the fallback when the owner's message breaks a limit once filled in", async () => {
    const sent = emptySent();
    await quietly(() =>
      sendMessage(fakeChannel(fakeGuild(), sent) as never, plainReply("{big}"), { big: "x".repeat(2001), level: 3 }, {
        fallback: plainReply("Level {level}"),
      }),
    );
    assert.equal(sent.payloads[0]?.content, "Level 3");
  });

  test("sends nothing and returns null when there is no fallback", async () => {
    const sent = emptySent();
    const result = await quietly(() =>
      sendMessage(fakeChannel(fakeGuild(), sent) as never, plainReply("{big}"), { big: "x".repeat(2001) }),
    );
    assert.equal(result, null);
    assert.equal(sent.payloads.length, 0);
  });

  test("never throws when Discord refuses the message", async () => {
    const result = await quietly(() =>
      sendMessage(fakeChannel(fakeGuild(), emptySent(), new Error("Missing Permissions")) as never, plainReply("Hi")),
    );
    assert.equal(result, null);
  });
});

describe("sendMessage as a direct message", () => {
  test("sends with no mentions or reactions, and keeps what its buttons do for the server it is about", async () => {
    const sent = emptySent();
    const saved: unknown[][] = [];
    const result = await sendMessage(
      fakeUser(sent) as never,
      body({ content: "Hello {user}", reactions: ["🎉"], buttons: [primaryButton] }),
      { user: "Ada" },
      {
        guild: fakeGuild() as never,
        persist: async (...args) => {
          saved.push(args);
        },
      },
    );
    assert.ok(result);
    assert.equal(sent.payloads[0]?.content, "Hello Ada");
    assert.deepEqual(sent.payloads[0]?.allowedMentions, { parse: [] });
    assert.equal((sent.payloads[0]?.components as unknown[]).length, 1);
    assert.deepEqual(saved[0]?.slice(0, 3), [GUILD_ID, "600000000000000006", "500000000000000005"]);
    assert.deepEqual(sent.reactions, []);
  });

  test("keeps text menus and drops the menus a direct message cannot fill in", async () => {
    const sent = emptySent();
    const saved: { selects: unknown[] }[] = [];
    await sendMessage(
      fakeUser(sent) as never,
      body({
        content: "Pick",
        selects: [
          { kind: "string", placeholder: "", disabled: false, minValues: 1, maxValues: 1, options: [{ label: "A", value: "a", description: "", emoji: "", action: { type: "none" } }] },
          { kind: "role", placeholder: "", disabled: false, minValues: 1, maxValues: 1, limitTo: [], action: { type: "none" } },
        ] as never,
      }),
      {},
      {
        guild: fakeGuild() as never,
        persist: async (_g, _c, _m, message) => {
          saved.push(message);
        },
      },
    );
    assert.equal(saved[0]?.selects.length, 1);
    assert.equal((sent.payloads[0]?.components as unknown[]).length, 1);
  });

  test("with no server to act on, keeps only link buttons and stores nothing", async () => {
    const sent = emptySent();
    let persisted = false;
    await sendMessage(
      fakeUser(sent) as never,
      body({ content: "Hi", buttons: [primaryButton, { ...primaryButton, style: "link", url: "https://example.com" }] }),
      {},
      {
        persist: async () => {
          persisted = true;
        },
      },
    );
    const rows = sent.payloads[0]?.components as { components: unknown[] }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.components.length, 1);
    assert.equal(persisted, false);
  });

  test("returns null, without throwing, when the person has direct messages closed", async () => {
    const result = await quietly(() =>
      sendMessage(fakeUser(emptySent(), new Error("Cannot send messages to this user")) as never, plainReply("Hi")),
    );
    assert.equal(result, null);
  });

  test("fills the server variables from the guild it is given", async () => {
    const sent = emptySent();
    await sendMessage(fakeUser(sent) as never, plainReply("Welcome to {server}"), {}, { guild: fakeGuild() as never });
    assert.equal(sent.payloads[0]?.content, "Welcome to Test server");
  });
});
