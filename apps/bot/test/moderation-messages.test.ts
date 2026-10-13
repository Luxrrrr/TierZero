import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Collection } from "discord.js";
import { ModuleRegistry } from "@tier0/core";
import moderation from "@tier0/module-moderation";
import { tryCorrectionMessage, tryDirectMessage } from "../../../packages/modules/moderation/dist/dm.js";
import { postModLog, say } from "../../../packages/modules/moderation/dist/reply.js";
import { replyMessage, sendMessage } from "../dist/runtime/send-message.js";

const GUILD_ID = "100000000000000001";
const LOG_CHANNEL_ID = "200000000000000002";
const MEMBER_ID = "300000000000000003";
const MODERATOR_ID = "400000000000000004";

const registry = new ModuleRegistry();
registry.register(moderation);

function settingsWith(stored: Record<string, unknown>) {
  const resolved = registry.resolveSettings("moderation", stored);
  assert.ok(resolved.ok, "settings should resolve");
  return resolved.value;
}

const guild = {
  id: GUILD_ID,
  name: "Test Server",
  memberCount: 10,
  roles: { cache: new Collection<string, { id: string; name: string }>() },
  channels: { cache: new Collection<string, { id: string; name: string }>() },
  members: { me: { displayName: "TierZero" } },
  iconURL: () => null,
};

interface Delivered {
  payloads: Record<string, unknown>[];
}

function fakeUser(delivered: Delivered, failWith?: Error) {
  return {
    id: MEMBER_ID,
    client: { user: { username: "TierZero" } },
    async send(payload: Record<string, unknown>) {
      if (failWith) throw failWith;
      delivered.payloads.push(payload);
      return { id: "1", channelId: "2", react: async () => undefined };
    },
  };
}

function fakeLogChannel(delivered: Delivered, failWith?: Error) {
  return {
    id: LOG_CHANNEL_ID,
    name: "mod-log",
    guild,
    client: { user: { username: "TierZero" } },
    isTextBased: () => true,
    isDMBased: () => false,
    async send(payload: Record<string, unknown>) {
      if (failWith) throw failWith;
      delivered.payloads.push(payload);
      return { id: "5", channelId: LOG_CHANNEL_ID, react: async () => undefined };
    },
  };
}

/** A module context holding only what the two senders read, with the real sender behind `send`. */
function context(stored: Record<string, unknown>, user: ReturnType<typeof fakeUser>, channel: ReturnType<typeof fakeLogChannel>, dashboard = "") {
  const settings = settingsWith(stored);
  return {
    settings,
    dashboardUrl: async () => dashboard,
    client: { users: { fetch: async () => user } },
    guild: {
      ...guild,
      channels: { cache: new Collection<string, unknown>([[LOG_CHANNEL_ID, channel]]) },
    },
    send: (target: never, body: never, values: never, options: object) =>
      sendMessage(target, body, values, { guild: guild as never, persist: async () => undefined, ...options }),
  } as never;
}

async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => undefined;
  try {
    return await run();
  } finally {
    console.error = original;
  }
}

describe("the moderation direct message", () => {
  test("says what it always has by default, and mentions nobody", async () => {
    const delivered: Delivered = { payloads: [] };
    const ctx = context({}, fakeUser(delivered), fakeLogChannel({ payloads: [] }));
    const sent = await tryDirectMessage(ctx, MEMBER_ID, { action: "kick", reason: "Broke rule 4", expiresAt: null, moderatorId: MODERATOR_ID });
    assert.equal(sent, true);
    assert.equal(delivered.payloads[0]?.content, "You were kicked in Test Server. Reason: Broke rule 4");
    assert.deepEqual(delivered.payloads[0]?.allowedMentions, { parse: [] });
  });

  test("sends the owner's message instead", async () => {
    const delivered: Delivered = { payloads: [] };
    const ctx = context({ dmOnAction: true, dmMessage: { content: "{server} says: you were {action}. Why: {reason}" } }, fakeUser(delivered), fakeLogChannel({ payloads: [] }));
    await tryDirectMessage(ctx, MEMBER_ID, { action: "ban", reason: null, expiresAt: null });
    assert.equal(delivered.payloads[0]?.content, "Test Server says: you were banned. Why: No reason given");
  });

  test("sends the stock message when the owner's no longer fits once the reason is in it", async () => {
    const delivered: Delivered = { payloads: [] };
    const reason = "x".repeat(500);
    const ctx = context({ dmMessage: { content: "{reason}{reason}{reason}{reason}!" } }, fakeUser(delivered), fakeLogChannel({ payloads: [] }));
    const sent = await quietly(() => tryDirectMessage(ctx, MEMBER_ID, { action: "warn", reason, expiresAt: null }));
    assert.equal(sent, true);
    assert.equal(delivered.payloads[0]?.content, `You were warned in Test Server. Reason: ${reason}`);
  });

  test("reports a member with direct messages closed without throwing", async () => {
    const ctx = context({}, fakeUser({ payloads: [] }, new Error("Cannot send messages to this user")), fakeLogChannel({ payloads: [] }));
    const sent = await quietly(() => tryDirectMessage(ctx, MEMBER_ID, { action: "warn", reason: null, expiresAt: null }));
    assert.equal(sent, false);
  });
});

describe("the moderation mod log post", () => {
  const entry = { caseNumber: 12, action: "timeout", targetId: MEMBER_ID, moderatorId: MODERATOR_ID, reason: "Spam", expiresAt: new Date("2030-01-01T00:00:00.000Z"), durationMs: 600_000 };
  const seconds = Math.floor(entry.expiresAt.getTime() / 1000);

  test("is the embed the module has always posted by default", async () => {
    const delivered: Delivered = { payloads: [] };
    const channel = fakeLogChannel(delivered);
    const ctx = context({ modLogChannel: LOG_CHANNEL_ID }, fakeUser({ payloads: [] }), channel);
    assert.equal(await postModLog(ctx, entry), "posted");
    const embed = (delivered.payloads[0]?.embeds as { toJSON(): Record<string, unknown> }[])[0]?.toJSON();
    assert.equal(embed?.title, "Case #12 - Timed out");
    assert.deepEqual(embed?.fields, [
      { name: "Member", value: `<@${MEMBER_ID}> (${MEMBER_ID})`, inline: true },
      { name: "Moderator", value: `<@${MODERATOR_ID}> (${MODERATOR_ID})`, inline: true },
      { name: "Reason", value: "Spam", inline: false },
      { name: "Expires", value: `<t:${seconds}:f> (<t:${seconds}:R>)`, inline: false },
    ]);
    assert.equal(embed?.color, undefined);
    assert.ok(typeof embed?.timestamp === "string");
  });

  test("has no button while the dashboard's address is not known", async () => {
    const delivered: Delivered = { payloads: [] };
    const ctx = context({ modLogChannel: LOG_CHANNEL_ID }, fakeUser({ payloads: [] }), fakeLogChannel(delivered));
    assert.equal(await postModLog(ctx, entry), "posted");
    assert.deepEqual(delivered.payloads[0]?.components, []);
  });

  test("carries a View in dashboard button for the case once the address is known, and pings no one", async () => {
    const delivered: Delivered = { payloads: [] };
    const ctx = context({ modLogChannel: LOG_CHANNEL_ID }, fakeUser({ payloads: [] }), fakeLogChannel(delivered), "https://bot.example.com");
    assert.equal(await postModLog(ctx, entry), "posted");
    const rows = delivered.payloads[0]?.components as { toJSON(): { components: { label: string; url: string; style: number }[] } }[];
    assert.equal(rows.length, 1);
    const [button] = rows[0]!.toJSON().components;
    assert.equal(button?.label, "View in dashboard");
    assert.equal(button?.style, 5);
    assert.equal(button?.url, `https://bot.example.com/guilds/${GUILD_ID}/mod/members/${MEMBER_ID}?case=12`);
    assert.deepEqual(delivered.payloads[0]?.allowedMentions, { parse: ["users", "roles"] });
    assert.equal(delivered.payloads[0]?.content, undefined);
  });

  test("offers the links to a message the owner wrote", async () => {
    const delivered: Delivered = { payloads: [] };
    const ctx = context(
      { modLogChannel: LOG_CHANNEL_ID, modLogMessage: { content: "{caseUrl} | {memberUrl}" } },
      fakeUser({ payloads: [] }),
      fakeLogChannel(delivered),
      "https://bot.example.com",
    );
    await postModLog(ctx, entry);
    assert.equal(
      delivered.payloads[0]?.content,
      `https://bot.example.com/guilds/${GUILD_ID}/mod/members/${MEMBER_ID}?case=12 | https://bot.example.com/guilds/${GUILD_ID}/mod/members/${MEMBER_ID}`,
    );
  });

  test("still posts when the owner's button cannot be made into a link", async () => {
    const delivered: Delivered = { payloads: [] };
    const link = { label: "Open", style: "link", url: "{caseUrl}" };
    const ctx = context({ modLogChannel: LOG_CHANNEL_ID, modLogMessage: { content: "Case {case}", buttons: [link] } }, fakeUser({ payloads: [] }), fakeLogChannel(delivered));
    assert.equal(await postModLog(ctx, entry), "posted");
    assert.equal(delivered.payloads[0]?.content, "Case 12");
    assert.deepEqual(delivered.payloads[0]?.components, []);
  });

  test("falls back to the stock post when dropping the button leaves the owner's message empty", async () => {
    const delivered: Delivered = { payloads: [] };
    const link = { label: "Open", style: "link", url: "{caseUrl}" };
    const ctx = context({ modLogChannel: LOG_CHANNEL_ID, modLogMessage: { content: "{caseUrl}", buttons: [link] } }, fakeUser({ payloads: [] }), fakeLogChannel(delivered));
    assert.equal(await quietly(() => postModLog(ctx, entry)), "posted");
    assert.equal((delivered.payloads[0]?.embeds as unknown[]).length, 1);
  });

  test("leaves the Expires line out of an action that does not expire", async () => {
    const delivered: Delivered = { payloads: [] };
    const ctx = context({ modLogChannel: LOG_CHANNEL_ID }, fakeUser({ payloads: [] }), fakeLogChannel(delivered));
    await postModLog(ctx, { ...entry, action: "kick", expiresAt: null, durationMs: null });
    const embed = (delivered.payloads[0]?.embeds as { toJSON(): { fields: { name: string }[] } }[])[0]?.toJSON();
    assert.deepEqual(embed?.fields.map((f) => f.name), ["Member", "Moderator", "Reason"]);
  });

  test("posts the owner's message with the moderator's duration", async () => {
    const delivered: Delivered = { payloads: [] };
    const ctx = context(
      { modLogChannel: LOG_CHANNEL_ID, modLogMessage: { content: "Case {case}: {member} {action} for {duration} by {moderator}" } },
      fakeUser({ payloads: [] }),
      fakeLogChannel(delivered),
    );
    await postModLog(ctx, entry);
    assert.equal(delivered.payloads[0]?.content, `Case 12: <@${MEMBER_ID}> timed out for 10 minutes by <@${MODERATOR_ID}>`);
  });

  test("posts the stock embed when the owner's no longer fits", async () => {
    const delivered: Delivered = { payloads: [] };
    const reason = "y".repeat(600);
    const ctx = context(
      { modLogChannel: LOG_CHANNEL_ID, modLogMessage: { content: "{reason}{reason}{reason}{reason}!" } },
      fakeUser({ payloads: [] }),
      fakeLogChannel(delivered),
    );
    const outcome = await quietly(() => postModLog(ctx, { ...entry, reason }));
    assert.equal(outcome, "posted");
    assert.equal(delivered.payloads[0]?.content, undefined);
    assert.equal((delivered.payloads[0]?.embeds as unknown[]).length, 1);
  });

  test("says when there is no channel set, or the send failed", async () => {
    const unset = context({}, fakeUser({ payloads: [] }), fakeLogChannel({ payloads: [] }));
    assert.equal(await postModLog(unset, entry), "unset");
    const failing = context({ modLogChannel: LOG_CHANNEL_ID }, fakeUser({ payloads: [] }), fakeLogChannel({ payloads: [] }, new Error("Missing Access")));
    assert.equal(await quietly(() => postModLog(failing, entry)), "failed");
  });
});

describe("the moderation replies, sent for real", () => {
  function interaction(state: { deferred?: boolean } = {}) {
    const calls: { method: string; payload: Record<string, unknown> }[] = [];
    const record = (method: string) => async (payload: Record<string, unknown>) => {
      calls.push({ method, payload });
    };
    return {
      calls,
      interaction: {
        guild,
        user: { id: MODERATOR_ID, displayName: "Ada" },
        channelId: LOG_CHANNEL_ID,
        channel: { id: LOG_CHANNEL_ID, name: "mod-chat" },
        client: { user: { username: "TierZero" } },
        deferred: state.deferred ?? false,
        replied: false,
        reply: record("reply"),
        editReply: record("editReply"),
        followUp: record("followUp"),
      } as never,
    };
  }

  function replying(stored: Record<string, unknown>) {
    const base = context(stored, fakeUser({ payloads: [] }), fakeLogChannel({ payloads: [] })) as unknown as object;
    return {
      ...base,
      reply: (target: never, body: never, values: never, options: object) => replyMessage(target, body, values, { guild: guild as never, ...options }),
    } as never;
  }

  test("a refusal reads as it always did, privately", async () => {
    const { interaction: i, calls } = interaction();
    await say(replying({}), i, "refusals", "notBanned", { name: "spamlord_42" });
    assert.equal(calls[0]?.method, "reply");
    assert.equal(calls[0]?.payload.content, "spamlord_42 is not banned.");
    assert.equal(calls[0]?.payload.flags, 64);
  });

  test("the owner's wording is used, with the values filled in", async () => {
    const { interaction: i, calls } = interaction();
    await say(replying({ replies: { refusals: { notBanned: "{name} is free to go, says {server}." } } }), i, "refusals", "notBanned", { name: "sam" });
    assert.equal(calls[0]?.payload.content, "sam is free to go, says Test Server.");
  });

  test("falls back to the stock sentence when the owner's no longer fits once the name is in it", async () => {
    const { interaction: i, calls } = interaction();
    const long = { replies: { refusals: { notBanned: `${"x".repeat(1990)} {name}` } } };
    await quietly(() => say(replying(long), i, "refusals", "notBanned", { name: "n".repeat(30) }));
    assert.equal(calls[0]?.payload.content, `${"n".repeat(30)} is not banned.`);
  });

  test("a purge that was deferred edits its answer", async () => {
    const { interaction: i, calls } = interaction({ deferred: true });
    await say(replying({}), i, "purge", "purgeFailed");
    assert.equal(calls[0]?.method, "editReply");
    assert.equal(calls[0]?.payload.content, "I could not delete those messages. Check my permissions in this channel.");
  });

  test("the correction to a member says what it always did and mentions nobody", async () => {
    const delivered: Delivered = { payloads: [] };
    const ctx = context({}, fakeUser(delivered), fakeLogChannel({ payloads: [] }));
    assert.equal(await tryCorrectionMessage(ctx, MEMBER_ID, "ban"), true);
    assert.equal(delivered.payloads[0]?.content, "Correction: the message you were just sent about being banned was sent in error. Nothing happened to you.");
    assert.deepEqual(delivered.payloads[0]?.allowedMentions, { parse: [] });

    const reworded: Delivered = { payloads: [] };
    const own = context({ replies: { direct: { correction: "Sorry {server}: not {action}." } } }, fakeUser(reworded), fakeLogChannel({ payloads: [] }));
    await tryCorrectionMessage(own, MEMBER_ID, "timeout");
    assert.equal(reworded.payloads[0]?.content, "Sorry Test Server: not timed out.");
  });

  test("a mod log post for a case with a very long reason is still posted", async () => {
    const delivered: Delivered = { payloads: [] };
    const ctx = context({ modLogChannel: LOG_CHANNEL_ID }, fakeUser({ payloads: [] }), fakeLogChannel(delivered));
    const outcome = await postModLog(ctx, { caseNumber: 3, action: "warn", targetId: MEMBER_ID, moderatorId: MODERATOR_ID, reason: "r".repeat(1500), expiresAt: null });
    assert.equal(outcome, "posted");
    const embed = (delivered.payloads[0]?.embeds as { toJSON(): { fields: { name: string; value: string }[] } }[])[0]!.toJSON();
    assert.equal(embed.fields.find((field) => field.name === "Reason")?.value.length, 1024);
  });
});
