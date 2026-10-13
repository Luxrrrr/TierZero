import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Collection, EmbedBuilder, Events, MessageFlags } from "discord.js";
import { ModuleRegistry, defineModule, emptyEmbed, plainReply, s, type MessageBody } from "@tier0/core";
import system, { type SystemSettings } from "@tier0/module-system";
import { applyRole, mergePieces } from "../dist/runtime/message-components.js";
import { registerEventDispatch } from "../dist/runtime/dispatch.js";

const GUILD_ID = "100000000000000001";
const CHANNEL_ID = "200000000000000002";
const ROLE_ID = "400000000000000004";

const registry = new ModuleRegistry();
registry.register(system);

function settingsWith(stored: unknown): SystemSettings {
  const resolved = registry.resolveSettings("system", stored);
  assert.ok(resolved.ok);
  return resolved.value as SystemSettings;
}

const body = (content: string): MessageBody => plainReply(content);

/** The sentence of a default, which now sits in an embed rather than in the message text. */
const descOf = (value: { embeds?: unknown } | undefined) =>
  (value?.embeds as Array<{ data: { description?: string } }> | undefined)?.[0]?.data.description;
const source = (settings: SystemSettings) => ({ systemSettings: async () => settings });

interface FakeRole {
  id: string;
  name: string;
  position: number;
}

function fakeGuild(options: { role?: FakeRole | null; botPosition?: number; member?: boolean; change?: "ok" | "fail"; has?: boolean } = {}) {
  const role = options.role === undefined ? { id: ROLE_ID, name: "Events", position: 2 } : options.role;
  const calls: string[] = [];
  const member = {
    roles: {
      cache: { has: () => options.has ?? false },
      add: async () => {
        if (options.change === "fail") throw new Error("Missing Permissions");
        calls.push("add");
      },
      remove: async () => {
        if (options.change === "fail") throw new Error("Missing Permissions");
        calls.push("remove");
      },
    },
  };
  const guild = {
    id: GUILD_ID,
    name: "Test server",
    memberCount: 10,
    channels: { cache: new Collection<string, { id: string; name: string }>() },
    roles: { cache: new Collection<string, FakeRole>(role ? [[role.id, role]] : []) },
    members: {
      me: { displayName: "TierZero", roles: { highest: { position: options.botPosition ?? 10 } } },
      fetch: async () => {
        if (options.member === false) throw new Error("Unknown Member");
        return member;
      },
    },
    iconURL: () => null,
  };
  return { guild, calls };
}

const clicker = { id: "300000000000000003", displayName: "Ada" };

const action = (overrides: Partial<{ mode: "add" | "remove" | "toggle"; confirmation: string }> = {}) =>
  ({ type: "role", roleId: ROLE_ID, mode: "add", confirmation: "", ...overrides }) as never;

const interaction = { user: clicker } as never;

async function say(guild: unknown, settings: SystemSettings, actionOverrides: Parameters<typeof action>[0] = {}, variables: Record<string, string> = {}) {
  return applyRole(source(settings), interaction, guild as never, action(actionOverrides), { server: "Test server", ...variables });
}

describe("what a role button says", () => {
  const defaults = settingsWith({});

  test("a role that was deleted", async () => {
    const piece = await say(fakeGuild({ role: null }).guild, defaults);
    assert.equal(descOf(piece), "That role no longer exists.");
  });

  test("a role above the bot's own", async () => {
    const piece = await say(fakeGuild({ botPosition: 1 }).guild, defaults);
    assert.equal(
      descOf(piece),
      "I can't change **Events** because it sits above my own highest role. Ask an admin to move my role above it.",
    );
  });

  test("a member the bot cannot find", async () => {
    const piece = await say(fakeGuild({ member: false }).guild, defaults);
    assert.equal(descOf(piece), "I couldn't find you on this server.");
  });

  test("a role Discord refuses to change", async () => {
    const piece = await say(fakeGuild({ change: "fail" }).guild, defaults);
    assert.equal(descOf(piece), "I couldn't change **Events**. Check that I have Manage Roles.");
  });

  test("a role given", async () => {
    const { guild, calls } = fakeGuild();
    const piece = await say(guild, defaults);
    assert.deepEqual(calls, ["add"]);
    assert.equal(descOf(piece), "You now have **Events**.");
    assert.equal((piece.embeds[0] as { data: { color: number } }).data.color, 0x3ba55d);
  });

  test("a role taken away, by removing it or by toggling it off", async () => {
    const removed = fakeGuild();
    assert.equal(descOf(await say(removed.guild, defaults, { mode: "remove" })), "**Events** was taken off you.");
    assert.deepEqual(removed.calls, ["remove"]);

    const toggled = fakeGuild({ has: true });
    assert.equal(descOf(await say(toggled.guild, defaults, { mode: "toggle" })), "**Events** was taken off you.");
    assert.deepEqual(toggled.calls, ["remove"]);
  });

  test("uses the owner's wording for each of them", async () => {
    const settings = settingsWith({
      replies: {
        buttons: {
          roleGone: body("Gone."),
          roleTooHigh: body("Too high: {role}"),
          memberNotFound: body("Who are you?"),
          roleChangeFailed: body("Could not change {role}"),
          roleGiven: body("Added {role} for {sender}"),
          roleTaken: body("Dropped {role}"),
        },
      },
    });
    assert.equal((await say(fakeGuild({ role: null }).guild, settings)).content, "Gone.");
    assert.equal((await say(fakeGuild({ botPosition: 1 }).guild, settings)).content, "Too high: Events");
    assert.equal((await say(fakeGuild({ member: false }).guild, settings)).content, "Who are you?");
    assert.equal((await say(fakeGuild({ change: "fail" }).guild, settings)).content, "Could not change Events");
    assert.equal((await say(fakeGuild().guild, settings, {}, { sender: "Ada" })).content, "Added Events for Ada");
    assert.equal((await say(fakeGuild().guild, settings, { mode: "remove" })).content, "Dropped Events");
  });

  test("a confirmation written on the button wins over the server's", async () => {
    const settings = settingsWith({ replies: { buttons: { roleGiven: body("Added {role}") } } });
    const piece = await say(fakeGuild().guild, settings, { confirmation: "Welcome to {role}, {sender}!" }, { sender: "Ada" });
    assert.equal(piece.content, "Welcome to Events, Ada!");
  });

  test("can carry an embed", async () => {
    const embedded: MessageBody = { ...plainReply(""), embeds: [{ ...emptyEmbed(), title: "Done", description: "You have {role}" }] };
    const piece = await say(fakeGuild().guild, settingsWith({ replies: { buttons: { roleGiven: embedded } } }));
    assert.equal(piece.content, undefined);
    assert.equal(piece.embeds.length, 1);
  });
});

describe("mergePieces", () => {
  test("puts each text on its own line", () => {
    assert.equal(mergePieces([{ content: "One", embeds: [] }, { content: "Two", embeds: [] }]).content, "One\nTwo");
  });

  test("leaves out a piece with no text and keeps embeds in order", () => {
    const first = new EmbedBuilder().setTitle("a");
    const second = new EmbedBuilder().setTitle("b");
    const merged = mergePieces([{ embeds: [first] }, { content: "Text", embeds: [second] }]);
    assert.equal(merged.content, "Text");
    assert.deepEqual(merged.embeds, [first, second]);
  });

  test("has no content at all when nothing said any", () => {
    const merged = mergePieces([{ embeds: [] }, { content: "", embeds: [] }]);
    assert.equal("content" in merged, false);
  });

  test("stops at Discord's ten embeds", () => {
    const many = Array.from({ length: 12 }, () => new EmbedBuilder().setTitle("x"));
    assert.equal(mergePieces([{ embeds: many }]).embeds.length, 10);
  });
});

describe("a handler that throws", () => {
  function setup(settings: SystemSettings, handler: () => Promise<void>) {
    const module = defineModule({
      id: "tickets",
      name: "Tickets",
      summary: "Tickets.",
      settings: s.object({}),
      components: { close: handler },
      modals: { reason: handler },
    });
    const handlers = new Map<string, (...args: unknown[]) => Promise<void>>();
    const client = {
      user: { id: "999" },
      on: (event: string, listener: (...args: unknown[]) => Promise<void>) => void handlers.set(event, listener),
    };
    const state = {
      moduleFor: (id: string) => (id === "tickets" ? module : undefined),
      isEnabled: async () => true,
      context: async () => ({ settings: {} }),
      enabledModules: async () => [],
      systemSettings: async () => settings,
    };
    registerEventDispatch({ client: client as never, state: state as never });
    return handlers.get(Events.InteractionCreate)!;
  }

  function click(customId: string, kind: "component" | "modal" = "component") {
    const sent: { how: string; payload: Record<string, unknown> }[] = [];
    return {
      sent,
      interaction: {
        customId,
        guild: { ...fakeGuild().guild },
        channelId: CHANNEL_ID,
        channel: { id: CHANNEL_ID, name: "tickets" },
        user: clicker,
        client: { user: { username: "TierZero" } },
        replied: false,
        deferred: false,
        isMessageComponent: () => kind === "component",
        isModalSubmit: () => kind === "modal",
        isRepliable: () => true,
        inGuild: () => true,
        reply: async (payload: Record<string, unknown>) => void sent.push({ how: "reply", payload }),
        followUp: async (payload: Record<string, unknown>) => void sent.push({ how: "followUp", payload }),
      },
    };
  }

  const quietly = async <T,>(run: () => Promise<T>): Promise<T> => {
    const original = console.error;
    console.error = () => undefined;
    try {
      return await run();
    } finally {
      console.error = original;
    }
  };

  const boom = async () => {
    throw new Error("boom");
  };

  test("tells the member something went wrong instead of leaving Discord's own failure notice", async () => {
    const listener = setup(settingsWith({}), boom);
    const { interaction, sent } = click("tickets:close");
    await quietly(() => listener(interaction));
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.how, "reply");
    assert.equal(descOf(sent[0]?.payload), "That didn't work. The server log has the details.");
    assert.equal(sent[0]?.payload.flags, MessageFlags.Ephemeral);
  });

  test("does the same for a form that is submitted, in the owner's words", async () => {
    const listener = setup(settingsWith({ replies: { buttons: { componentFailed: body("Please try again in a minute.") } } }), boom);
    const { interaction, sent } = click("tickets:reason", "modal");
    await quietly(() => listener(interaction));
    assert.equal(sent[0]?.payload.content, "Please try again in a minute.");
  });

  test("follows up when the handler had already answered", async () => {
    const listener = setup(settingsWith({}), boom);
    const { interaction, sent } = click("tickets:close");
    interaction.replied = true;
    await quietly(() => listener(interaction));
    assert.equal(sent[0]?.how, "followUp");
  });

  test("never throws when even the failure notice cannot be sent", async () => {
    const listener = setup(settingsWith({}), boom);
    const { interaction } = click("tickets:close");
    interaction.reply = async () => {
      throw new Error("Unknown interaction");
    };
    await quietly(() => listener(interaction));
  });

  test("says nothing when the handler succeeds", async () => {
    const listener = setup(settingsWith({}), async () => undefined);
    const { interaction, sent } = click("tickets:close");
    await listener(interaction);
    assert.equal(sent.length, 0);
  });
});
