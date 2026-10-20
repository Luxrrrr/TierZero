import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, type FieldDescriptor, type MessageBody, type RowRef } from "@tier0/core";
import { createTestDatabase } from "./db-helper.ts";

const GUILD = "100000000000000031";
const CHANNEL = "123456789012345671";
const OTHER_CHANNEL = "123456789012345672";
const PC = "223456789012345671";
const CONSOLE = "223456789012345672";
const MOBILE = "223456789012345673";
const VERIFIED = "223456789012345674";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { default: roles } = await import("../dist/index.js");
const { legacyMenuId } = await import("../dist/menus.js");
const { PROBLEMS, UPDATED_MESSAGE } = await import("../dist/messages.js");

const registry = new ModuleRegistry();
registry.register(roles);

type Menu = Record<string, unknown> & { id: string; name: string };
type Settings = { menus: Menu[]; replies: Record<string, MessageBody>; labels: { noRoles: string } };

function resolve(stored: unknown): Settings {
  const result = registry.resolveSettings("roles", stored);
  assert.ok(result.ok, result.ok ? "" : result.errors.map((e) => `${e.path} ${e.message}`).join("; "));
  return result.value as Settings;
}

const ROLE_NAMES: Record<string, string> = { [PC]: "PC", [CONSOLE]: "Console", [MOBILE]: "Mobile", [VERIFIED]: "Verified" };

let live: Map<string, { id: string; channel: string }>;
let sent: { channel: string; rows: unknown[] }[];
let edited: string[];
let deleted: string[];
let told: { body: MessageBody; values: Record<string, unknown> }[];
let counter = 0;

function channel(id: string, name: string) {
  return {
    id,
    name,
    isTextBased: () => true,
    messages: {
      fetch: async (messageId: string) => live.get(messageId) ?? null,
      delete: async (messageId: string) => {
        live.delete(messageId);
        deleted.push(messageId);
      },
    },
  };
}

const CHANNELS = new Map([
  [CHANNEL, channel(CHANNEL, "roles")],
  [OTHER_CHANNEL, channel(OTHER_CHANNEL, "pick-roles")],
]);

interface MemberOptions {
  holds?: string[];
  refuse?: boolean;
}

function member(options: MemberOptions) {
  const held = new Set(options.holds ?? []);
  return {
    roles: {
      cache: { has: (id: string) => held.has(id) },
      add: async (id: string) => {
        if (options.refuse) throw new Error("Missing Permissions");
        held.add(id);
      },
      remove: async (id: string) => {
        held.delete(id);
      },
    },
    held,
  };
}

function context(settings: Settings, memberOptions: MemberOptions = {}) {
  const who = member(memberOptions);
  return {
    who,
    ctx: {
      settings,
      guild: {
        id: GUILD,
        channels: { cache: { get: (id: string) => CHANNELS.get(id) } },
        roles: { cache: { get: (id: string) => (ROLE_NAMES[id] ? { id, name: ROLE_NAMES[id], position: 1 } : undefined), has: (id: string) => id in ROLE_NAMES } },
        members: { me: { roles: { highest: { position: 5 } } }, fetch: async () => who },
      },
      send: async (target: { id: string }, _body: MessageBody, _values: unknown, options: { rows: unknown[] }) => {
        counter += 1;
        const posted = { id: `9000000000000${String(counter).padStart(5, "0")}`, channel: target.id };
        live.set(posted.id, posted);
        sent.push({ channel: target.id, rows: options.rows });
        return posted;
      },
      edit: async (message: { id: string }) => {
        edited.push(message.id);
        return message;
      },
      reply: async (_interaction: unknown, body: MessageBody, values: Record<string, unknown> = {}) => {
        told.push({ body, values });
        return true;
      },
    } as never,
  };
}

const hooks = roles.rows!.menus!;
const ref = (settings: Settings, index = 0): RowRef => ({ path: `menus[${index}]`, row: settings.menus[index]!, parent: settings as never });
const post = (ctx: never, settings: Settings, index = 0) => hooks.actions!.post!.run({ ctx, row: ref(settings, index), input: {} });
const status = async (ctx: never, settings: Settings) => hooks.status!({ ctx, path: "menus", rows: settings.menus.map((_, i) => ref(settings, i)) });

const option = (role: string, label: string) => ({ role, label });
const platforms = (extra: Record<string, unknown> = {}) => ({
  id: "plat0001",
  name: "Platforms",
  channel: CHANNEL,
  options: [option(PC, "PC"), option(CONSOLE, "Console"), option(MOBILE, "Mobile")],
  ...extra,
});

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Roles publish guild" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

beforeEach(async () => {
  live = new Map();
  sent = [];
  edited = [];
  deleted = [];
  told = [];
  await prisma.reactionRoleMenu.deleteMany();
});

describe("posting a menu from the dashboard", () => {
  test("posts it once, and the row then says where and that it is up to date", async () => {
    const settings = resolve({ menus: [platforms()] });
    const { ctx } = context(settings);
    assert.deepEqual(await status(ctx, settings), [{ tone: "idle", text: "Not posted yet" }]);

    const result = await post(ctx, settings);
    assert.deepEqual(result, { ok: true, message: "Posted the menu in #roles." });
    assert.equal(sent.length, 1);
    const rows = await prisma.reactionRoleMenu.findMany();
    assert.equal(rows.length, 1);
    assert.equal(JSON.parse(rows[0]!.mapping).id, "plat0001");
    assert.deepEqual(await status(ctx, settings), [{ tone: "ok", text: "Posted in #roles, up to date" }]);
  });

  test("a renamed menu is edited in place on the next post, never posted twice", async () => {
    const first = resolve({ menus: [platforms()] });
    await post(context(first).ctx, first);

    const renamed = resolve({ menus: [platforms({ name: "Your platform" })] });
    const { ctx } = context(renamed);
    const [changed] = await status(ctx, renamed);
    assert.equal(changed?.tone, "idle");
    assert.match(changed?.text ?? "", /Changed since/);

    assert.deepEqual(await post(ctx, renamed), { ok: true, message: "Updated the menu in #roles." });
    assert.equal(sent.length, 1);
    assert.equal(edited.length, 1);
    assert.equal(await prisma.reactionRoleMenu.count(), 1);
    assert.equal((await status(ctx, renamed))[0]?.tone, "ok");
  });

  test("two menus that share a name are two posts", async () => {
    const settings = resolve({ menus: [platforms(), platforms({ id: "plat0002" })] });
    const { ctx } = context(settings);
    await post(ctx, settings, 0);
    await post(ctx, settings, 1);
    assert.equal(sent.length, 2);
    assert.equal(await prisma.reactionRoleMenu.count(), 2);
  });

  test("a menu moved to another channel replaces its old post", async () => {
    const first = resolve({ menus: [platforms()] });
    await post(context(first).ctx, first);
    const [old] = [...live.keys()];

    const moved = resolve({ menus: [platforms({ channel: OTHER_CHANNEL })] });
    assert.deepEqual(await post(context(moved).ctx, moved), { ok: true, message: "Posted the menu in #pick-roles." });
    assert.deepEqual(deleted, [old]);
    const rows = await prisma.reactionRoleMenu.findMany();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.channelId, OTHER_CHANNEL);
  });

  test("a menu posted before menus had ids keeps its live message", async () => {
    live.set("800000000000000001", { id: "800000000000000001", channel: CHANNEL });
    await prisma.reactionRoleMenu.create({
      data: {
        guildId: GUILD,
        channelId: CHANNEL,
        messageId: "800000000000000001",
        mapping: JSON.stringify({ name: "Platforms", exclusive: false, options: [option(PC, "PC")] }),
      },
    });

    const settings = resolve({ menus: [{ name: "Platforms", channel: CHANNEL, options: [option(PC, "PC")] }] });
    assert.equal(settings.menus[0]?.id, legacyMenuId("Platforms"));
    const { ctx } = context(settings);
    assert.equal((await status(ctx, settings))[0]?.tone, "idle");

    assert.deepEqual(await post(ctx, settings), { ok: true, message: "Updated the menu in #roles." });
    assert.equal(sent.length, 0);
    assert.deepEqual(edited, ["800000000000000001"]);
    const rows = await prisma.reactionRoleMenu.findMany();
    assert.equal(JSON.parse(rows[0]!.mapping).id, legacyMenuId("Platforms"));
  });

  test("says what to fix when the channel is gone", async () => {
    const settings = resolve({ menus: [platforms({ channel: "123456789012345679" })] });
    const result = await post(context(settings).ctx, settings);
    assert.equal(result.ok, false);
    assert.match(result.message, /no longer exists/);
  });

  test("a dropdown menu is posted as one menu holding every role", async () => {
    const settings = resolve({ menus: [platforms({ kind: "select", maxPicks: 2 })] });
    await post(context(settings).ctx, settings);
    const [row] = sent[0]!.rows as { components: { data: { custom_id: string; max_values: number }; options: unknown[] }[] }[];
    const [select] = row!.components;
    assert.equal(select?.data.custom_id, "roles:pick:plat0001");
    assert.equal(select?.data.max_values, 2);
    assert.equal(select?.options.length, 3);
  });

  test("removing a menu deletes its post", async () => {
    const previous = resolve({ menus: [platforms(), platforms({ id: "rank0001", name: "Ranks" })] });
    const { ctx } = context(previous);
    await post(ctx, previous, 0);
    await post(ctx, previous, 1);

    const next = resolve({ menus: [platforms({ id: "rank0001", name: "Ranks" })] });
    await roles.onSettingsChange!(context(next).ctx, previous as never);
    const rows = await prisma.reactionRoleMenu.findMany();
    assert.equal(rows.length, 1);
    assert.equal(JSON.parse(rows[0]!.mapping).id, "rank0001");
    assert.equal(deleted.length, 1);
  });
});

describe("pressing and picking", () => {
  async function posted(extra: Record<string, unknown>) {
    const settings = resolve({ menus: [platforms(extra)] });
    await post(context(settings).ctx, settings);
    const [messageId] = [...live.keys()];
    return { settings, messageId: messageId! };
  }

  const press = (messageId: string) =>
    ({ isButton: () => true, message: { id: messageId }, user: { id: "400000000000000031" } }) as never;
  const pick = (messageId: string, values: string[]) =>
    ({
      isStringSelectMenu: () => true,
      values,
      message: { id: messageId, components: [] },
      user: { id: "400000000000000031" },
      update: async () => undefined,
    }) as never;

  test("a role Discord refuses to give is reported, not announced as given", async () => {
    const { settings, messageId } = await posted({});
    await roles.components!.toggle!(press(messageId), { rest: PC, ctx: context(settings, { refuse: true }).ctx });
    assert.deepEqual(told[0]?.body, settings.menus[0]!.replies.roleChangeFailed);
    assert.deepEqual(told[0]?.values, { role: "PC", menu: "Platforms" });
    assert.deepEqual(settings.menus[0]!.replies.roleChangeFailed, PROBLEMS.roleChangeFailed.starting);
  });

  test("a menu that needs a role turns away a member without it", async () => {
    const { settings, messageId } = await posted({ requiredRole: VERIFIED });
    const { ctx, who } = context(settings);
    await roles.components!.toggle!(press(messageId), { rest: PC, ctx });
    assert.deepEqual(told[0]?.values, { required: "Verified", menu: "Platforms" });
    assert.equal(who.held.has(PC), false);
  });

  test("a menu with a limit refuses a pick past it", async () => {
    const { settings, messageId } = await posted({ kind: "select", maxPicks: 1 });
    const { ctx, who } = context(settings, { holds: [PC] });
    await roles.components!.pick!(pick(messageId, [CONSOLE]), { rest: "plat0001", ctx });
    assert.deepEqual(told[0]?.values, { max: 1, menu: "Platforms" });
    assert.equal(who.held.has(CONSOLE), false);
  });

  test("a pick from a dropdown says which of the menu's roles the member has now", async () => {
    const { settings, messageId } = await posted({ kind: "select" });
    const { ctx, who } = context(settings, { holds: [PC] });
    await roles.components!.pick!(pick(messageId, [CONSOLE, PC]), { rest: "plat0001", ctx });
    assert.deepEqual([...who.held], [CONSOLE]);
    assert.deepEqual(told[0]?.body, UPDATED_MESSAGE);
    assert.deepEqual(told[0]?.values, { roles: "Console", menu: "Platforms" });
  });
});

describe("the settings", () => {
  const summary = registry.describe().find((entry) => entry.id === "roles");
  const menus = (summary?.schema.fields as Record<string, FieldDescriptor>).menus as FieldDescriptor;
  const row = (menus.of as FieldDescriptor).fields as Record<string, FieldDescriptor>;
  const optionFields = ((row.options as FieldDescriptor).of as FieldDescriptor).fields as Record<string, FieldDescriptor>;

  test("say the feature does nothing until a menu is added", () => {
    assert.equal(menus.essential, true);
  });

  test("give each menu an id the dashboard fills in", () => {
    assert.equal(row.id?.generated, true);
  });

  test("mark the role a menu gives as one the bot hands out, and the required role as not", () => {
    assert.equal(optionFields.role?.assigns, true);
    assert.equal(row.requiredRole?.assigns, undefined);
  });

  test("show the role buttons, or the dropdown, under the menu message", () => {
    const attach = row.message?.attach as { kind: string; list: string; mode: { field: string; menu: string } };
    assert.equal(attach.kind, "list");
    assert.equal(attach.list, "options");
    assert.deepEqual(attach.mode, { field: "kind", menu: "select" });
  });
});
