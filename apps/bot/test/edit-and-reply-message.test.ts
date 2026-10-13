import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Collection, MessageFlags } from "discord.js";
import { embedReply, emptyEmbed, plainReply, type MessageBody } from "@tier0/core";
import { editMessage, replyMessage, sendMessage } from "../dist/runtime/send-message.js";

const GUILD_ID = "100000000000000001";
const CHANNEL_ID = "200000000000000002";

const body = (overrides: Partial<MessageBody>): MessageBody => ({ ...plainReply(""), ...overrides });
const linkButton = { label: "Docs", emoji: "", style: "link", url: "https://example.com", disabled: false, action: { type: "none" } } as const;
const primaryButton = { label: "Go", emoji: "", style: "primary", url: "", disabled: false, action: { type: "none" } } as const;

const client = { user: { username: "TierZero" } };

function fakeGuild() {
  return {
    id: GUILD_ID,
    name: "Test server",
    memberCount: 10,
    channels: { cache: new Collection<string, { id: string; name: string }>() },
    roles: { cache: new Collection<string, { id: string; name: string }>() },
    members: { me: { displayName: "TierZero" } },
    iconURL: () => null,
  };
}

async function quietly<T>(run: () => Promise<T> | T): Promise<T> {
  const original = console.error;
  console.error = () => undefined;
  try {
    return await run();
  } finally {
    console.error = original;
  }
}

describe("rows and files given to sendMessage", () => {
  test("go out after the message's own components", async () => {
    const payloads: Record<string, unknown>[] = [];
    const channel = {
      id: CHANNEL_ID,
      name: "general",
      guild: fakeGuild(),
      client,
      isTextBased: () => true,
      isDMBased: () => false,
      send: async (payload: Record<string, unknown>) => {
        payloads.push(payload);
        return { id: "3", channelId: CHANNEL_ID, react: async () => undefined };
      },
    };
    const ownRow = { own: true };
    const file = { file: true };
    await sendMessage(channel as never, body({ content: "Hi", buttons: [linkButton] }), {}, {
      rows: [ownRow as never],
      files: [file as never],
      persist: async () => undefined,
    });
    const components = payloads[0]?.components as unknown[];
    assert.equal(components.length, 2);
    assert.equal(components[1], ownRow);
    assert.deepEqual(payloads[0]?.files, [file]);
  });
});

describe("editMessage without Embed Links", () => {
  const refusal = (code: number) => Object.assign(new Error("Discord refused"), { code });

  function fakeMessage(edits: Record<string, unknown>[], failFirstWith?: Error) {
    return {
      id: "300000000000000003",
      channelId: CHANNEL_ID,
      guild: fakeGuild(),
      client,
      channel: { id: CHANNEL_ID, name: "roles" },
      edit: async (payload: Record<string, unknown>) => {
        if (failFirstWith && (payload.embeds as unknown[]).length > 0) throw failFirstWith;
        edits.push(payload);
        return { id: "300000000000000003", channelId: CHANNEL_ID, react: async () => undefined };
      },
    };
  }

  test("edits to text once when the channel refuses the embed", async () => {
    const edits: Record<string, unknown>[] = [];
    const result = await quietly(() =>
      editMessage(fakeMessage(edits, refusal(50013)) as never, embedReply("Updated.", "info"), {}, { persist: async () => undefined }),
    );
    assert.ok(result);
    assert.equal(edits.length, 1);
    assert.equal(edits[0]?.content, "Updated.");
    assert.deepEqual(edits[0]?.embeds, []);
  });

  test("returns null for other failures", async () => {
    const result = await quietly(() =>
      editMessage(fakeMessage([], refusal(10008)) as never, embedReply("Updated."), {}, { persist: async () => undefined }),
    );
    assert.equal(result, null);
  });
});

describe("editMessage", () => {
  function fakeMessage(edits: Record<string, unknown>[]) {
    return {
      id: "300000000000000003",
      channelId: CHANNEL_ID,
      guild: fakeGuild(),
      client,
      channel: { id: CHANNEL_ID, name: "roles" },
      edit: async (payload: Record<string, unknown>) => {
        edits.push(payload);
        return { id: "300000000000000003", channelId: CHANNEL_ID, react: async () => undefined };
      },
    };
  }

  test("replaces the text and embeds and keeps the module's rows", async () => {
    const edits: Record<string, unknown>[] = [];
    const row = { own: true };
    const edited = await editMessage(
      fakeMessage(edits) as never,
      body({ embeds: [{ ...emptyEmbed(), title: "Menu {menu}" }] }),
      { menu: "Pings" },
      { rows: [row as never], persist: async () => undefined },
    );
    assert.ok(edited);
    assert.equal(edits[0]?.content, "");
    assert.deepEqual(edits[0]?.components, [row]);
    assert.equal((edits[0]?.embeds as { data: { title: string } }[])[0]?.data.title, "Menu Pings");
  });

  test("uses the fallback when the owner's message no longer fits", async () => {
    const edits: Record<string, unknown>[] = [];
    await quietly(() =>
      editMessage(fakeMessage(edits) as never, plainReply("{big}"), { big: "x".repeat(2001) }, { fallback: plainReply("Default"), persist: async () => undefined }),
    );
    assert.equal(edits[0]?.content, "Default");
  });

  test("resolves to null instead of throwing when Discord refuses", async () => {
    const message = { ...fakeMessage([]), edit: async () => Promise.reject(new Error("Missing Access")) };
    assert.equal(await quietly(() => editMessage(message as never, plainReply("Hi"))), null);
  });
});

describe("replyMessage", () => {
  function fakeInteraction(state: { deferred?: boolean; replied?: boolean } = {}) {
    const calls: { method: string; payload: Record<string, unknown> }[] = [];
    const record = (method: string) => async (payload: Record<string, unknown>) => {
      calls.push({ method, payload });
    };
    return {
      calls,
      interaction: {
        guild: fakeGuild(),
        user: { id: "42", displayName: "Ada" },
        channelId: CHANNEL_ID,
        channel: { id: CHANNEL_ID, name: "general" },
        client,
        deferred: state.deferred ?? false,
        replied: state.replied ?? false,
        reply: record("reply"),
        editReply: record("editReply"),
        followUp: record("followUp"),
      },
    };
  }

  test("is ephemeral by default and fills the module's variables", async () => {
    const { interaction, calls } = fakeInteraction();
    assert.equal(await replyMessage(interaction as never, plainReply("Gave you **{role}**."), { role: "Gamers" }), true);
    assert.equal(calls[0]?.method, "reply");
    assert.equal(calls[0]?.payload.content, "Gave you **Gamers**.");
    assert.equal(calls[0]?.payload.flags, MessageFlags.Ephemeral);
  });

  test("can be public, and then can mention people", async () => {
    const { interaction, calls } = fakeInteraction();
    await replyMessage(interaction as never, plainReply("Added {member}"), { member: "<@7>" }, { ephemeral: false });
    assert.equal(calls[0]?.payload.flags, undefined);
    assert.deepEqual(calls[0]?.payload.allowedMentions, { parse: ["users", "roles"] });
  });

  test("edits the reply when the interaction was already deferred", async () => {
    const { interaction, calls } = fakeInteraction({ deferred: true });
    await replyMessage(interaction as never, plainReply("Done"));
    assert.equal(calls[0]?.method, "editReply");
    assert.equal(calls[0]?.payload.flags, undefined);
  });

  test("leaves out buttons nothing would answer but keeps link buttons", async () => {
    const { interaction, calls } = fakeInteraction();
    await replyMessage(interaction as never, body({ content: "Hi", buttons: [primaryButton, linkButton] }));
    const rows = calls[0]?.payload.components as { components: unknown[] }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.components.length, 1);
  });

  test("uses the fallback, and says false when nothing can be sent", async () => {
    const first = fakeInteraction();
    assert.equal(
      await quietly(() => replyMessage(first.interaction as never, plainReply("{big}"), { big: "x".repeat(2001) }, { fallback: plainReply("Default") })),
      true,
    );
    assert.equal(first.calls[0]?.payload.content, "Default");
    const second = fakeInteraction();
    assert.equal(await quietly(() => replyMessage(second.interaction as never, plainReply("{big}"), { big: "x".repeat(2001) })), false);
    assert.equal(second.calls.length, 0);
  });
});
