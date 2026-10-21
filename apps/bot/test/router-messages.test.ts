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
  enabled: true,
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
    guildCommands: async () => [],
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

/** The sentence of a default, which now sits in an embed rather than in the message text. */
const descOf = (value: { embeds?: unknown } | undefined) =>
  (value?.embeds as Array<{ data: { description?: string } }> | undefined)?.[0]?.data.description;

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
    assert.equal(descOf(sent[0]?.payload), "That feature is switched off on this server.");
    assert.equal((sent[0]?.payload.embeds as Array<{ data: { color: number } }>)[0]?.data.color, 0xed4245);
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
    assert.equal(descOf(sent[0]?.payload), "That command is turned off in this channel.");
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
    assert.equal(descOf(sent[0]?.payload), "You do not have a role that is allowed to use that command.");
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
    assert.equal(descOf(sent[0]?.payload), "That command did not finish. The server log has the details.");
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
    assert.equal(descOf(sent[0]?.payload), "That command did not finish. The server log has the details.");
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

describe("a command a server made up for itself", () => {
  const own = {
    name: "rules",
    description: "Show the rules.",
    build: () => ({ toJSON: () => ({ name: "rules" }) }) as never,
    async run() {
      ran += 1;
    },
  };
  const owner = registry.get("leveling")!;

  test("is found in that server's own list and run by the module that made it", async () => {
    const { interaction } = fakeInteraction();
    (interaction as { commandName: string }).commandName = "rules";
    const before = ran;
    await run({ ...fakeState(), guildCommands: async () => [{ module: owner, command: own as never }] }, interaction);
    assert.equal(ran, before + 1);
  });

  test("is ignored in a server whose list does not have it", async () => {
    const { interaction, sent } = fakeInteraction();
    (interaction as { commandName: string }).commandName = "rules";
    const before = ran;
    await run(fakeState(), interaction);
    assert.equal(ran, before);
    assert.equal(sent.length, 0);
  });
});

describe("commandLabel", () => {
  test("puts a slash on a slash command and leaves a right-click entry alone", () => {
    assert.equal(commandLabel({ commandName: "rank", isChatInputCommand: () => true } as never), "/rank");
    assert.equal(commandLabel({ commandName: "Report message", isChatInputCommand: () => false } as never), "Report message");
  });
});

describe("one part of a command", () => {
  function partInteraction(subcommand: string, group: string | null = null) {
    const made = fakeInteraction();
    Object.assign(made.interaction, {
      options: { getSubcommand: () => subcommand, getSubcommandGroup: () => group },
    });
    return made;
  }

  function stateWith(parts: Record<string, ReturnType<typeof policy>>): RouterState {
    return { ...fakeState(), commandPolicy: async (_guild: string, key: string) => parts[key] ?? policy() };
  }

  test("switched off is refused, naming the part, while the rest of the command runs", async () => {
    ran = 0;
    const state = stateWith({ "rank reset": policy({ enabled: false }) });
    const off = partInteraction("reset");
    await run(state, off.interaction);
    assert.equal(ran, 0);
    assert.equal(descOf(off.sent[0]?.payload), "That command is switched off on this server.");
    assert.equal(off.sent[0]?.payload.flags, MessageFlags.Ephemeral);

    const on = partInteraction("show");
    await run(state, on.interaction);
    assert.equal(ran, 1);
    assert.equal(on.sent.length, 0);
  });

  test("names the part in the owner's wording", async () => {
    const settings = settingsWith({ replies: { commands: { commandOff: body("{command} is off here.") } } });
    const state = { ...stateWith({ "rank reset": policy({ enabled: false }) }), systemSettings: async () => settings };
    const { interaction, sent } = partInteraction("reset");
    await run(state, interaction);
    assert.equal(sent[0]?.payload.content, "/rank reset is off here.");
  });

  test("keeps its own role and channel limits", async () => {
    ran = 0;
    const state = stateWith({ "rank reset": policy({ allowRoles: [ROLE_A] }), "rank season wipe": policy({ denyChannels: [CHANNEL_ID] }) });
    const limited = partInteraction("reset");
    await run(state, limited.interaction);
    assert.equal(descOf(limited.sent[0]?.payload), "You do not have a role that is allowed to use that command.");
    const grouped = partInteraction("wipe", "season");
    await run(state, grouped.interaction);
    assert.equal(descOf(grouped.sent[0]?.payload), "That command is turned off in this channel.");
    assert.equal(ran, 0);
  });

  test("the whole command's limits still come first", async () => {
    ran = 0;
    const state = stateWith({ rank: policy({ allowRoles: [ROLE_B] }) });
    const { interaction, sent } = partInteraction("show");
    await run(state, interaction);
    assert.equal(ran, 0);
    assert.equal(descOf(sent[0]?.payload), "You do not have a role that is allowed to use that command.");
  });
});
