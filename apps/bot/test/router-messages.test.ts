import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Collection, MessageFlags } from "discord.js";
import { ModuleRegistry, defineModule, plainReply, s, type MessageBody } from "@tier0/core";
import system, { type SystemSettings } from "@tier0/module-system";
import { commandLabel, handleCommand, type RouterState } from "../dist/runtime/router.js";

const GUILD_ID = "100000000000000001";
const CHANNEL_ID = "200000000000000002";
const OTHER_CHANNEL = "200000000000000003";
const ROLE_A = "400000000000000004";
const ROLE_B = "400000000000000005";

let ran = 0;
let failWith: Error | null = null;

const registry = new ModuleRegistry();
registry.register(system);
registry.register(
  defineModule({
    id: "leveling",
    name: "Leveling",
    summary: "Levels.",
    settings: s.object({}),
    commands: [
      {
        name: "rank",
        description: "Your rank.",
        build: () => ({ toJSON: () => ({ name: "rank" }) }) as never,
        async run() {
          ran += 1;
          if (failWith) throw failWith;
        },
      },
    ],
  }),
);

function settingsWith(stored: unknown): SystemSettings {
  const resolved = registry.resolveSettings("system", stored);
  assert.ok(resolved.ok);
  return resolved.value as SystemSettings;
}

const policy = (overrides: Partial<Awaited<ReturnType<RouterState["commandPolicy"]>>> = {}) => ({
  allowRoles: [] as string[],
  denyChannels: [] as string[],
  ephemeral: null,
  customReply: null,
  permissions: null,
  ...overrides,
});

function fakeState(options: { enabled?: boolean; policy?: ReturnType<typeof policy>; settings?: SystemSettings } = {}): RouterState {
  return {
    isEnabled: async () => options.enabled ?? true,
    commandPolicy: async () => options.policy ?? policy(),
    context: async () => ({ settings: {} }) as never,
    systemSettings: async () => options.settings ?? settingsWith({}),
  };
}

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

interface Sent {
  how: "reply" | "followUp";
  payload: Record<string, unknown>;
}

function fakeInteraction(options: { channelId?: string; roles?: string[]; deferred?: boolean; context?: boolean } = {}) {
  const sent: Sent[] = [];
  const interaction = {
    commandName: "rank",
    guild: fakeGuild(),
    channelId: options.channelId ?? CHANNEL_ID,
    channel: { id: options.channelId ?? CHANNEL_ID, name: "general" },
    member: { roles: options.roles ?? [] },
    user: { id: "300000000000000003", displayName: "Ada" },
    client: { user: { username: "TierZero" } },
    replied: false,
    deferred: options.deferred ?? false,
    ephemeral: false,
    isChatInputCommand: () => !(options.context ?? false),
    isContextMenuCommand: () => options.context ?? false,
    inGuild: () => true,
    reply: async (payload: Record<string, unknown>) => void sent.push({ how: "reply", payload }),
    followUp: async (payload: Record<string, unknown>) => void sent.push({ how: "followUp", payload }),
  };
  return { interaction, sent };
}

const body = (content: string): MessageBody => plainReply(content);

async function quietly<T>(run: () => Promise<T> | T): Promise<T> {
  const original = console.error;
  console.error = () => undefined;
  try {
    return await run();
  } finally {
    console.error = original;
  }
}

const run = (state: RouterState, interaction: unknown) => handleCommand({ registry, state }, interaction as never);

describe("a feature that is switched off", () => {
  test("is turned away with the usual sentence, privately", async () => {
    ran = 0;
    const { interaction, sent } = fakeInteraction();
    await run(fakeState({ enabled: false }), interaction);
    assert.equal(ran, 0);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.payload.content, "That feature is switched off on this server.");
    assert.equal(sent[0]?.payload.flags, MessageFlags.Ephemeral);
  });

  test("is turned away with the owner's sentence, naming the feature and the command", async () => {
    const settings = settingsWith({ replies: { commands: { featureOff: body("{command} needs {module}, which is off.") } } });
    const { interaction, sent } = fakeInteraction();
    await run(fakeState({ enabled: false, settings }), interaction);
    assert.equal(sent[0]?.payload.content, "/rank needs Leveling, which is off.");
  });

  test("names a right-click entry as it is written, without a slash", async () => {
    const settings = settingsWith({ replies: { commands: { featureOff: body("{command} is off.") } } });
    const { interaction, sent } = fakeInteraction({ context: true });
    await run(fakeState({ enabled: false, settings }), interaction);
    assert.equal(sent[0]?.payload.content, "rank is off.");
  });
});

describe("a command turned off in a channel", () => {
  test("is refused with the usual sentence", async () => {
    ran = 0;
    const { interaction, sent } = fakeInteraction({ channelId: OTHER_CHANNEL });
    await run(fakeState({ policy: policy({ denyChannels: [OTHER_CHANNEL] }) }), interaction);
    assert.equal(ran, 0);
    assert.equal(sent[0]?.payload.content, "That command is turned off in this channel.");
  });

  test("is refused with the owner's sentence, linking the channel", async () => {
    const settings = settingsWith({ replies: { commands: { channelOff: body("Not in {channel}, try another channel.") } } });
    const { interaction, sent } = fakeInteraction({ channelId: OTHER_CHANNEL });
    await run(fakeState({ policy: policy({ denyChannels: [OTHER_CHANNEL] }), settings }), interaction);
    assert.equal(sent[0]?.payload.content, `Not in <#${OTHER_CHANNEL}>, try another channel.`);
  });
});

describe("a command limited to roles", () => {
  const limited = policy({ allowRoles: [ROLE_A, ROLE_B] });

  test("is refused with the usual sentence to someone without them", async () => {
    ran = 0;
    const { interaction, sent } = fakeInteraction({ roles: ["500000000000000006"] });
    await run(fakeState({ policy: limited }), interaction);
    assert.equal(ran, 0);
    assert.equal(sent[0]?.payload.content, "You do not have a role that is allowed to use that command.");
  });

  test("can name the roles that are allowed", async () => {
    const settings = settingsWith({ replies: { commands: { noRole: body("{command} is for {roles}.") } } });
    const { interaction, sent } = fakeInteraction();
    await run(fakeState({ policy: limited, settings }), interaction);
    assert.equal(sent[0]?.payload.content, `/rank is for <@&${ROLE_A}>, <@&${ROLE_B}>.`);
  });

  test("lets someone with one of the roles through", async () => {
    ran = 0;
    const { interaction, sent } = fakeInteraction({ roles: [ROLE_B] });
    await run(fakeState({ policy: limited }), interaction);
    assert.equal(ran, 1);
    assert.equal(sent.length, 0);
  });
});

describe("a command that fails", () => {
  test("says so with the usual sentence", async () => {
    failWith = new Error("boom");
    const { interaction, sent } = fakeInteraction();
    await quietly(() => run(fakeState(), interaction));
    failWith = null;
    assert.equal(sent[0]?.how, "reply");
    assert.equal(sent[0]?.payload.content, "That command did not finish. The server log has the details.");
    assert.equal(sent[0]?.payload.flags, MessageFlags.Ephemeral);
  });

  test("follows up privately when the command had already deferred its reply", async () => {
    failWith = new Error("boom");
    const { interaction, sent } = fakeInteraction({ deferred: true });
    await quietly(() => run(fakeState(), interaction));
    failWith = null;
    assert.equal(sent[0]?.how, "followUp");
    assert.equal(sent[0]?.payload.flags, MessageFlags.Ephemeral);
  });

  test("says so in the owner's words", async () => {
    const settings = settingsWith({ replies: { commands: { commandFailed: body("{command} hit a snag. Tell a moderator.") } } });
    failWith = new Error("boom");
    const { interaction, sent } = fakeInteraction();
    await quietly(() => run(fakeState({ settings }), interaction));
    failWith = null;
    assert.equal(sent[0]?.payload.content, "/rank hit a snag. Tell a moderator.");
  });

  test("falls back to the usual sentence when the owner's no longer fits once filled in", async () => {
    // Each {server} is eight characters written and eleven filled in, which tips the text past Discord's 2000.
    const settings = settingsWith({ replies: { commands: { commandFailed: body("{server}".repeat(240)) } } });
    failWith = new Error("boom");
    const { interaction, sent } = fakeInteraction();
    await quietly(() => run(fakeState({ settings }), interaction));
    failWith = null;
    assert.equal(sent[0]?.payload.content, "That command did not finish. The server log has the details.");
  });
});

describe("a command that is not ours or has no server", () => {
  test("is ignored", async () => {
    const { interaction, sent } = fakeInteraction();
    (interaction as { commandName: string }).commandName = "unknown";
    await run(fakeState(), interaction);
    assert.equal(sent.length, 0);
  });
});

describe("commandLabel", () => {
  test("puts a slash on a slash command and leaves a right-click entry alone", () => {
    assert.equal(commandLabel({ commandName: "rank", isChatInputCommand: () => true } as never), "/rank");
    assert.equal(commandLabel({ commandName: "Report message", isChatInputCommand: () => false } as never), "Report message");
  });
});
