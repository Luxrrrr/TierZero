import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, REPLY_COLOR, type FieldDescriptor, type MessageBody } from "@tier0/core";
import { createTestDatabase } from "./db-helper.ts";

const GUILD = "100000000000000030";
const CHANNEL = "123456789012345678";
const ROLE = "223456789012345678";
const MESSAGE = "323456789012345678";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { default: roles } = await import("../dist/index.js");
const { PROBLEMS } = await import("../dist/messages.js");

const registry = new ModuleRegistry();
registry.register(roles);

const TODAY = {
  noMenu: 'No role menu named "{name}" is configured. Add one on the dashboard first.',
  channelGone: "The channel configured for this menu no longer exists.",
  editFailed: "I couldn't update the menu message. Check that I can still edit it.",
  postFailed: "I couldn't post the menu there. Check that I can send messages and embed links in that channel.",
  inactive: "This menu is no longer active. Ask a moderator to republish it.",
  optionGone: "That option is no longer part of this menu.",
  cannotAssign: "I can't give you **{role}** because that role sits above my own highest role. Ask an admin to move my role above it.",
  roleChangeFailed: "I couldn't change **{role}**. Ask an admin to check that I have Manage Roles.",
  needsRole: "You need the **{required}** role to use {menu}.",
  tooMany: "You can have at most {max} roles from {menu}. Remove one first.",
} as const;

const SHARED = ["noMenu", "channelGone", "editFailed", "postFailed", "inactive"] as const;
const PER_MENU = ["optionGone", "cannotAssign", "roleChangeFailed", "needsRole", "tooMany"] as const;

type Replies = Record<(typeof SHARED)[number], MessageBody>;
type MenuReplies = Record<(typeof PER_MENU)[number], MessageBody>;

function resolve(stored: unknown = {}) {
  const result = registry.resolveSettings("roles", stored);
  assert.ok(result.ok, result.ok ? "" : result.errors[0]?.message);
  return result.value as { menus: { replies: MenuReplies }[]; replies: Replies };
}

interface Told {
  body: MessageBody;
  values: Record<string, string | number>;
  fallback?: MessageBody;
}

let told: Told[];
let posted: boolean;

function context(stored: unknown = {}, options: { roleAbove?: boolean; channel?: boolean } = {}) {
  const channel = { id: CHANNEL, isTextBased: () => true, messages: { fetch: async () => null, delete: async () => undefined } };
  return {
    settings: resolve(stored),
    guild: {
      id: GUILD,
      channels: { cache: { get: () => (options.channel === false ? undefined : channel) } },
      roles: { cache: { get: (id: string) => (id === ROLE ? { id, name: "Gamers", position: options.roleAbove ? 9 : 1 } : undefined) } },
      members: {
        me: { roles: { highest: { position: 5 } } },
        fetch: async () => ({ roles: { cache: { has: () => false }, add: async () => undefined, remove: async () => undefined } }),
      },
    },
    reply: async (_interaction: unknown, body: MessageBody, values: Record<string, string | number> = {}, replyOptions?: { fallback?: MessageBody }) => {
      told.push({ body, values, fallback: replyOptions?.fallback });
      return true;
    },
    send: async () => (posted ? { id: MESSAGE } : null),
    edit: async () => null,
  } as never;
}

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Roles test guild" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

beforeEach(async () => {
  told = [];
  posted = true;
  await prisma.reactionRoleMenu.deleteMany();
});

const menu = { name: "Platforms", channel: CHANNEL, options: [{ label: "Gamer", role: ROLE }] };
const run = roles.commands![0]!.run;
const toggle = roles.components!.toggle!;

const slash = (name: string) => ({ options: { getString: () => name } }) as never;
const button = () => ({ isButton: () => true, message: { id: MESSAGE }, user: { id: "400000000000000030" } }) as never;

describe("the replies", () => {
  test("say what they always have until the owner writes another", () => {
    const { replies, menus } = resolve({ menus: [menu] });
    const own = menus[0]!.replies;
    for (const key of SHARED) {
      assert.equal(replies[key].embeds[0]?.description, TODAY[key], key);
      assert.equal(replies[key].embeds[0]?.color, REPLY_COLOR.error, key);
      assert.equal(replies[key].content, "", key);
      assert.deepEqual(replies[key], PROBLEMS[key].starting, key);
    }
    for (const key of PER_MENU) {
      assert.equal(own[key].embeds[0]?.description, TODAY[key], key);
      assert.deepEqual(own[key], PROBLEMS[key].starting, key);
    }
  });

  test("use the owner's wording, and keep the ones they did not touch", () => {
    const { replies } = resolve({ replies: { noMenu: "Nothing called {name}." } });
    assert.equal(replies.noMenu.content, "Nothing called {name}.");
    assert.equal(replies.channelGone.embeds[0]?.description, TODAY.channelGone);
  });

  test("the shared replies are one collapsible group of compact messages", () => {
    const summary = registry.describe().find((entry) => entry.id === "roles");
    const group = (summary?.schema.fields as Record<string, FieldDescriptor>).replies;
    assert.equal(group?.collapsible, true);
    assert.equal(group?.label, "Replies and errors");
    const fields = Object.values(group?.fields as Record<string, FieldDescriptor>);
    assert.equal(fields.length, 6);
    assert.ok(fields.every((field) => field.kind === "message" && field.compact === true));
  });

  test("each menu has its own collapsible group of replies", () => {
    const summary = registry.describe().find((entry) => entry.id === "roles");
    const row = ((summary?.schema.fields as Record<string, FieldDescriptor>).menus?.of ?? {}) as FieldDescriptor;
    const group = (row.fields as Record<string, FieldDescriptor>).replies;
    assert.equal(group?.collapsible, true);
    const fields = Object.entries(group?.fields as Record<string, FieldDescriptor>);
    assert.equal(fields.filter(([, field]) => field.kind === "message").length, 10);
    assert.ok(fields.some(([key]) => key === "noRoles"));
  });
});

describe("a refusal", () => {
  test("a menu that is not configured is named in the reply", async () => {
    await run(slash("Missing"), context({ replies: { noMenu: "Nothing called {name}." }, menus: [menu] }));
    assert.equal(told[0]?.body.content, "Nothing called {name}.");
    assert.deepEqual(told[0]?.values, { name: "Missing" });
    assert.deepEqual(told[0]?.fallback, PROBLEMS.noMenu.starting);
  });

  test("a menu whose channel is gone says so", async () => {
    await run(slash("Platforms"), context({ menus: [menu] }, { channel: false }));
    assert.equal(told[0]?.body.embeds[0]?.description, TODAY.channelGone);
  });

  test("a menu that cannot be posted says so", async () => {
    posted = false;
    await run(slash("Platforms"), context({ menus: [menu], replies: { postFailed: "No luck." } }));
    assert.equal(told[0]?.body.content, "No luck.");
  });

  test("a button on a menu that was removed says so", async () => {
    await toggle(button(), { rest: ROLE, ctx: context({ menus: [menu] }) });
    assert.equal(told[0]?.body.embeds[0]?.description, TODAY.inactive);
  });

  test("a button whose role was taken off the menu says so", async () => {
    await prisma.reactionRoleMenu.create({
      data: { guildId: GUILD, channelId: CHANNEL, messageId: MESSAGE, mapping: JSON.stringify({ name: "Platforms", exclusive: false, options: [] }) },
    });
    await toggle(button(), { rest: ROLE, ctx: context() });
    assert.equal(told[0]?.body.embeds[0]?.description, TODAY.optionGone);
  });

  test("a role above the bot is named, along with the menu", async () => {
    await prisma.reactionRoleMenu.create({
      data: { guildId: GUILD, channelId: CHANNEL, messageId: MESSAGE, mapping: JSON.stringify({ name: "Platforms", exclusive: false, options: [{ role: ROLE, label: "Gamer" }] }) },
    });
    await toggle(button(), { rest: ROLE, ctx: context({}, { roleAbove: true }) });
    assert.equal(told[0]?.body.embeds[0]?.description, TODAY.cannotAssign);
    assert.deepEqual(told[0]?.values, { role: "Gamers", menu: "Platforms" });
  });
});
