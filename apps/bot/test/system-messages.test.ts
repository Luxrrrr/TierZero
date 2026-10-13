import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Collection, MessageFlags } from "discord.js";
import { ModuleRegistry, plainReply, type MessageBody } from "@tier0/core";
import system, { LABEL_DEFAULTS, SYSTEM_MESSAGES, type SystemSettings } from "@tier0/module-system";
import {
  renderSystem,
  replySystem,
  systemBody,
  systemLabels,
  timeoutRemovalReason,
  type SystemSource,
} from "../dist/runtime/system-messages.js";

const GUILD_ID = "100000000000000001";
const CHANNEL_ID = "200000000000000002";

const registry = new ModuleRegistry();
registry.register(system);

/** Settings as the guild state would hand them over: stored values over the defaults. */
function settingsWith(stored: unknown): SystemSettings {
  const resolved = registry.resolveSettings("system", stored);
  assert.ok(resolved.ok);
  return resolved.value as SystemSettings;
}

const sourceOf = (settings: SystemSettings | null): SystemSource => ({ systemSettings: async () => settings });
const brokenSource: SystemSource = {
  systemSettings: async () => {
    throw new Error("database is gone");
  },
};

async function quietly<T>(run: () => Promise<T> | T): Promise<T> {
  const original = console.error;
  console.error = () => undefined;
  try {
    return await run();
  } finally {
    console.error = original;
  }
}

function fakeGuild() {
  return {
    id: GUILD_ID,
    name: "Test server",
    memberCount: 1200,
    channels: { cache: new Collection<string, { id: string; name: string }>() },
    roles: { cache: new Collection<string, { id: string; name: string }>() },
    members: { me: { displayName: "TierZero" } },
    iconURL: () => null,
  };
}

interface Sent {
  how: "reply" | "followUp";
  payload: Record<string, unknown>;
}

function fakeInteraction(state: { replied?: boolean; deferred?: boolean; inGuild?: boolean } = {}) {
  const sent: Sent[] = [];
  const interaction = {
    replied: state.replied ?? false,
    deferred: state.deferred ?? false,
    channelId: CHANNEL_ID,
    channel: { id: CHANNEL_ID, name: "general" },
    user: { id: "300000000000000003", displayName: "Ada" },
    client: { user: { username: "TierZero" } },
    inGuild: () => state.inGuild ?? true,
    reply: async (payload: Record<string, unknown>) => void sent.push({ how: "reply", payload }),
    followUp: async (payload: Record<string, unknown>) => void sent.push({ how: "followUp", payload }),
  };
  return { interaction, sent };
}

/** The sentence of a default, which now sits in an embed rather than in the message text. */
const descOf = (value: { embeds?: unknown } | undefined) =>
  (value?.embeds as Array<{ data: { description?: string } }> | undefined)?.[0]?.data.description;

const body = (content: string, overrides: Partial<MessageBody> = {}): MessageBody => ({ ...plainReply(content), ...overrides });

describe("systemBody", () => {
  test("is the default wording for a server that never saved anything", async () => {
    const found = await systemBody(sourceOf(settingsWith({})), GUILD_ID, "featureOff");
    assert.equal(found.embeds[0]?.description, "That feature is switched off on this server.");
  });

  test("is the owner's wording when they wrote one", async () => {
    const settings = settingsWith({ replies: { commands: { featureOff: body("Ask a moderator to turn {module} on.") } } });
    assert.equal((await systemBody(sourceOf(settings), GUILD_ID, "featureOff")).content, "Ask a moderator to turn {module} on.");
  });

  test("is the default where there is no server to ask", async () => {
    assert.deepEqual(await systemBody(sourceOf(settingsWith({})), null, "notActive"), SYSTEM_MESSAGES.notActive);
  });

  test("is the default when the module is not registered or its settings cannot be read", async () => {
    assert.deepEqual(await systemBody(sourceOf(null), GUILD_ID, "roleGone"), SYSTEM_MESSAGES.roleGone);
    assert.deepEqual(await quietly(() => systemBody(brokenSource, GUILD_ID, "roleGone")), SYSTEM_MESSAGES.roleGone);
  });
});

describe("systemLabels", () => {
  test("reads the owner's labels over the defaults", async () => {
    const labels = await systemLabels(sourceOf(settingsWith({ labels: { webhookName: "Announcements" } })), GUILD_ID);
    assert.equal(labels.webhookName, "Announcements");
    assert.equal(labels.unknownRole, LABEL_DEFAULTS.unknownRole);
  });

  test("falls back to the defaults without a server or settings", async () => {
    assert.deepEqual(await systemLabels(sourceOf(null), GUILD_ID), LABEL_DEFAULTS);
    assert.deepEqual(await systemLabels(sourceOf(settingsWith({})), null), LABEL_DEFAULTS);
    assert.deepEqual(await quietly(() => systemLabels(brokenSource, GUILD_ID)), LABEL_DEFAULTS);
  });
});

describe("renderSystem", () => {
  test("fills in the variables of the message", async () => {
    const settings = settingsWith({ replies: { buttons: { roleGiven: body("Enjoy {role}, {sender}!") } } });
    const rendered = await renderSystem(sourceOf(settings), fakeGuild() as never, "roleGiven", { role: "Events", sender: "Ada" });
    assert.equal(rendered?.payload.content, "Enjoy Events, Ada!");
  });

  test("sends the default when the owner's version no longer fits once filled in", async () => {
    // Each {role} grows to 100 characters, which pushes the text past Discord's 2000.
    const settings = settingsWith({ replies: { buttons: { roleGiven: body("{role}".repeat(30)) } } });
    const rendered = await quietly(() => renderSystem(sourceOf(settings), fakeGuild() as never, "roleGiven", { role: "r".repeat(100) }));
    assert.equal(descOf(rendered?.payload), `You now have **${"r".repeat(100)}**.`);
  });
});

describe("replySystem", () => {
  test("answers a fresh interaction with the default, shown only to the asker", async () => {
    const { interaction, sent } = fakeInteraction();
    const ok = await replySystem(sourceOf(settingsWith({})), interaction as never, fakeGuild() as never, "channelOff", { command: "/rank" });
    assert.equal(ok, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.how, "reply");
    assert.equal(descOf(sent[0]?.payload), "That command is turned off in this channel.");
    assert.equal(sent[0]?.payload.flags, MessageFlags.Ephemeral);
  });

  test("fills in the command and the channel the way an owner would write them", async () => {
    const settings = settingsWith({ replies: { commands: { channelOff: body("{command} does not work in {channel}.") } } });
    const { interaction, sent } = fakeInteraction();
    await replySystem(sourceOf(settings), interaction as never, fakeGuild() as never, "channelOff", { command: "/rank" });
    assert.equal(sent[0]?.payload.content, `/rank does not work in <#${CHANNEL_ID}>.`);
  });

  test("follows up when the interaction was already answered or deferred, so a failure stays private", async () => {
    for (const state of [{ replied: true }, { deferred: true }]) {
      const { interaction, sent } = fakeInteraction(state);
      await replySystem(sourceOf(settingsWith({})), interaction as never, fakeGuild() as never, "commandFailed", { command: "/rank" });
      assert.equal(sent[0]?.how, "followUp");
      assert.equal(sent[0]?.payload.flags, MessageFlags.Ephemeral);
    }
  });

  test("says nothing about being ephemeral in a direct message", async () => {
    const { interaction, sent } = fakeInteraction({ inGuild: false });
    await replySystem(sourceOf(settingsWith({})), interaction as never, null, "notActive");
    assert.equal(descOf(sent[0]?.payload), "This message's buttons and menus are no longer active.");
    assert.equal(sent[0]?.payload.flags, undefined);
  });

  test("never pings @everyone from a reply", async () => {
    const settings = settingsWith({ replies: { commands: { featureOff: body("@everyone {module} is off") } } });
    const { interaction, sent } = fakeInteraction();
    await replySystem(sourceOf(settings), interaction as never, fakeGuild() as never, "featureOff", { module: "Leveling" });
    assert.deepEqual(sent[0]?.payload.allowedMentions, { parse: ["users", "roles"] });
  });

  test("resolves false rather than throwing when Discord refuses the reply", async () => {
    const { interaction } = fakeInteraction();
    interaction.reply = async () => {
      throw new Error("Unknown interaction");
    };
    const ok = await quietly(() => replySystem(sourceOf(settingsWith({})), interaction as never, fakeGuild() as never, "commandFailed"));
    assert.equal(ok, false);
  });
});

describe("timeoutRemovalReason", () => {
  test("is today's reason by default", () => {
    assert.equal(timeoutRemovalReason(undefined, 42, "Ada"), "Case #42 removed by Ada");
    assert.equal(timeoutRemovalReason(LABEL_DEFAULTS.timeoutRemovalReason, 42, "Ada"), "Case #42 removed by Ada");
  });

  test("uses the owner's wording", () => {
    assert.equal(timeoutRemovalReason("Lifted by {actor} (case {case})", 7, "Grace"), "Lifted by Grace (case 7)");
  });

  test("never exceeds what Discord keeps of an audit-log reason", () => {
    assert.equal(timeoutRemovalReason("{actor}", 1, "x".repeat(600)).length, 512);
  });
});
