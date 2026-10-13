import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Collection } from "discord.js";
import { ModuleRegistry } from "@tier0/core";
import automod from "@tier0/module-automod";
import { NOTICE_MESSAGE, tripValues } from "../../../packages/modules/automod/dist/messages.js";
import { sendMessage } from "../dist/runtime/send-message.js";

const registry = new ModuleRegistry();
registry.register(automod);

const guild = {
  id: "100000000000000001",
  name: "Test Server",
  memberCount: 10,
  roles: { cache: new Collection<string, { id: string; name: string }>() },
  channels: { cache: new Collection<string, { id: string; name: string }>() },
  members: { me: { displayName: "TierZero" } },
  iconURL: () => null,
};

function fakeChannel(payloads: Record<string, unknown>[]) {
  return {
    id: "200000000000000002",
    name: "general",
    guild,
    client: { user: { username: "TierZero" } },
    isTextBased: () => true,
    isDMBased: () => false,
    async send(payload: Record<string, unknown>) {
      payloads.push(payload);
      return { id: "1", channelId: "200000000000000002", react: async () => undefined };
    },
  };
}

const facts = { userId: "111111111111111111", rule: "invites", actions: ["delete"], reason: "Spam", timeoutMs: undefined, deleted: true, warned: false, timedOut: false } as const;
const onlyTheMember = { users: ["111111111111111111"], roles: [] };

describe("the automod notice", () => {
  test("is sent as it always was, pinging the member", async () => {
    const stored = registry.resolveSettings("automod", {});
    assert.ok(stored.ok);
    const payloads: Record<string, unknown>[] = [];
    const sent = await sendMessage(fakeChannel(payloads) as never, (stored.value as { noticeMessage: never }).noticeMessage, tripValues(facts), {
      guild: guild as never,
      fallback: NOTICE_MESSAGE,
      mentions: onlyTheMember,
    });
    assert.ok(sent);
    assert.equal(payloads[0]?.content, "<@111111111111111111>, your message was removed (invites: Spam).");
  });

  test("can ping only the member, whatever the reason or the owner's text says", async () => {
    const stored = registry.resolveSettings("automod", { noticeMessage: { content: "{user} {reasonNote} <@&123456789012345678> @everyone" } });
    assert.ok(stored.ok);
    const payloads: Record<string, unknown>[] = [];
    await sendMessage(fakeChannel(payloads) as never, (stored.value as { noticeMessage: never }).noticeMessage, tripValues({ ...facts, reason: "x <@&987654321098765432> @here" }), {
      guild: guild as never,
      fallback: NOTICE_MESSAGE,
      mentions: onlyTheMember,
    });
    assert.deepEqual(payloads[0]?.allowedMentions, { users: ["111111111111111111"], roles: [] });
    assert.ok(!String(payloads[0]?.content).includes("<@&987654321098765432>"), "text from the offender is defused too");
  });

  test("falls back to the stock notice when the owner's no longer fits", async () => {
    const stored = registry.resolveSettings("automod", { noticeMessage: { content: "{reason}{reason}{reason}!" } });
    assert.ok(stored.ok);
    const payloads: Record<string, unknown>[] = [];
    const original = console.error;
    console.error = () => undefined;
    try {
      await sendMessage(fakeChannel(payloads) as never, (stored.value as { noticeMessage: never }).noticeMessage, tripValues({ ...facts, reason: "z".repeat(700) }), {
        guild: guild as never,
        fallback: NOTICE_MESSAGE,
        mentions: onlyTheMember,
      });
    } finally {
      console.error = original;
    }
    assert.equal(payloads[0]?.content, `<@111111111111111111>, your message was removed (invites: ${"z".repeat(700)}).`);
  });
});
