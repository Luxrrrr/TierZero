import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, type MessageBody } from "@tier0/core";
import customcommands from "../dist/index.js";
import { commandsOf, isCommand, runnableOf } from "../dist/commands.js";

const GUILD = "700000000000000001";
const CHANNEL = "710000000000000001";
const OTHER_CHANNEL = "710000000000000002";
const ROLE = "720000000000000001";
const HIGH_ROLE = "720000000000000002";
const MEMBER = "730000000000000001";

const registry = new ModuleRegistry();
registry.register(customcommands);

type Raw = Record<string, unknown>;

let counter = 0;
const text = (content: string): MessageBody => ({ content, embeds: [], buttons: [], selects: [], reactions: [] });
const command = (extra: Raw = {}): Raw => ({ id: `c${++counter}`, command: "hello", message: text("Hi {userName}"), ...extra });

function settingsFrom(commands: Raw[]) {
  const result = registry.resolveSettings("customcommands", { commands });
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors));
  return result.value as import("../dist/settings.js").CustomCommandSettings;
}

interface Log {
  replies: { body: MessageBody; vars: Record<string, string>; ephemeral?: boolean }[];
  sent: { content: string }[];
  roles: string[];
  scheduled: { kind: string; payload: Record<string, unknown> }[];
}

let log: Log;

function member(roleIds: string[] = []) {
  return {
    id: MEMBER,
    displayName: "Ada",
    user: { id: MEMBER, username: "ada", bot: false },
    roles: {
      cache: new Map(roleIds.map((id) => [id, { id }])),
      add: async (role: { id: string }) => void log.roles.push(`add ${role.id}`),
      remove: async (role: { id: string }) => void log.roles.push(`remove ${role.id}`),
    },
  };
}

function world(raw: Raw[]) {
  const channel = { id: CHANNEL, name: "general", parent: null, isTextBased: () => true };
  const ctx = {
    guild: {
      id: GUILD,
      channels: { cache: new Map<string, unknown>([[CHANNEL, channel]]) },
      roles: { cache: new Map([[ROLE, { id: ROLE, name: "Gamers", position: 3 }], [HIGH_ROLE, { id: HIGH_ROLE, name: "Boss", position: 20 }]]) },
      members: { me: { permissions: { has: () => true }, roles: { highest: { position: 10 } } }, cache: new Map([[MEMBER, member()]]), fetch: async () => member() },
    },
    settings: settingsFrom(raw),
    reply: async (_i: unknown, body: MessageBody, vars: Record<string, string>, opts?: { ephemeral?: boolean }) => {
      log.replies.push({ body, vars, ephemeral: opts?.ephemeral });
      return true;
    },
    send: async (_target: unknown, body: MessageBody) => {
      log.sent.push({ content: body.content });
      return { id: "1" };
    },
    tasks: { schedule: async (kind: string, _at: Date, payload: Record<string, unknown>) => void log.scheduled.push({ kind, payload }), cancel: async () => 0, reschedule: async () => undefined },
  };
  return ctx as never;
}

function interaction(options: Raw = {}) {
  const calls: string[] = [];
  return {
    calls,
    value: {
      user: { id: MEMBER, username: "ada" },
      member: member(),
      channel: { id: CHANNEL, name: "general", parent: null },
      replied: false,
      options: { getString: (name: string) => options[name] ?? null, getNumber: () => null, getUser: () => null, getChannel: () => null, getRole: () => null, getBoolean: () => null },
      deferReply: async (arg: unknown) => void calls.push(`defer ${JSON.stringify(arg)}`),
      deleteReply: async () => void calls.push("delete"),
    } as never,
  };
}

beforeEach(() => {
  log = { replies: [], sent: [], roles: [], scheduled: [] };
});

describe("the settings", () => {
  test("a command starts with its own defaults", () => {
    const [made] = settingsFrom([{ id: "a1", command: "rules", message: text("x") }]).commands;
    assert.equal(made!.enabled, true);
    assert.equal(made!.reply, "private");
    assert.equal(made!.cooldown, 0);
    assert.deepEqual(made!.steps, []);
  });

  test("a command name has to be lowercase letters, numbers, - and _", () => {
    assert.ok(!registry.resolveSettings("customcommands", { commands: [command({ command: "Not Allowed" })] }).ok);
    assert.ok(registry.resolveSettings("customcommands", { commands: [command({ command: "ok-name_1" })] }).ok);
  });

  test("an option name has to work as a {variable}", () => {
    assert.ok(!registry.resolveSettings("customcommands", { commands: [command({ options: [{ name: "target-user", description: "Who" }] })] }).ok);
  });

  test("only a few kinds of step are offered after the reply", () => {
    const summary = registry.describe().find((entry) => entry.id === "customcommands");
    const row = ((summary?.schema.fields as Record<string, { of?: { fields?: Record<string, { of?: { fields?: Record<string, { options?: { value: string }[] }> } }> } }>).commands?.of?.fields ?? {}).steps?.of?.fields?.type;
    assert.deepEqual(row?.options?.map((option) => option.value), ["message", "role", "nickname", "wait"]);
  });

  test("at most five steps after the reply", () => {
    const steps = Array.from({ length: 6 }, () => ({ type: "wait", pause: "1s" }));
    assert.ok(!registry.resolveSettings("customcommands", { commands: [command({ steps })] }).ok);
  });
});

describe("the commands a server makes", () => {
  test("are the switched on, properly named ones, one for each name", () => {
    const settings = settingsFrom([command({ command: "rules" }), command({ command: "rules" }), command({ command: "off", enabled: false }), command({ command: "help" })]);
    assert.deepEqual(commandsOf(settings).map((made) => made.name), ["rules", "help"]);
    assert.equal(isCommand(settings.commands[2]!), false);
  });

  test("are built with their options, the required ones first", () => {
    const settings = settingsFrom([
      command({
        command: "gift",
        options: [
          { name: "note", description: "Say why", kind: "text", required: false },
          { name: "who", description: "To whom", kind: "member", required: true },
          { name: "count", description: "How many", kind: "number", required: true },
          { name: "where", description: "Where", kind: "channel", required: false },
          { name: "sure", description: "Sure?", kind: "yesno", required: false },
        ],
      }),
    ]);
    const built = commandsOf(settings)[0]!.build().toJSON();
    assert.equal(built.name, "gift");
    assert.deepEqual(
      built.options!.map((option) => [option.name, option.type, option.required ?? false]),
      [["who", 6, true], ["count", 10, true], ["note", 3, false], ["where", 7, false], ["sure", 5, false]],
    );
  });

  test("run the reply first and then the steps the owner added", () => {
    const settings = settingsFrom([command({ steps: [{ type: "role", change: "give", role: ROLE }] })]);
    const runnable = runnableOf(settings.commands[0]!);
    assert.deepEqual(runnable.steps.map((step) => step.type), ["message", "role"]);
  });
});

describe("using a command", () => {
  test("answers the member privately by default, and fills in what they typed", async () => {
    const raw = [command({ command: "say", options: [{ name: "what", description: "What", kind: "text", required: true }], message: text("{what}") })];
    const ctx = world(raw);
    const { value, calls } = interaction({ what: "hi @everyone" });
    await commandsOf(settingsFrom(raw))[0]!.run(value, ctx);
    assert.match(calls[0]!, /^defer \{"flags":64\}$/);
    assert.equal(log.replies.length, 1);
    assert.equal(log.replies[0]!.ephemeral, true);
    assert.ok(!/@everyone/.test(log.replies[0]!.vars.what!));
  });

  test("a public command answers in front of the channel", async () => {
    const raw = [command({ command: "wave", reply: "public" })];
    const ctx = world(raw);
    const { value, calls } = interaction();
    await commandsOf(settingsFrom(raw))[0]!.run(value, ctx);
    assert.equal(calls[0], "defer {}");
    assert.equal(log.replies[0]!.ephemeral, false);
  });

  test("then does what the owner added, for the member who used it", async () => {
    const raw = [command({ command: "join", steps: [{ type: "role", change: "give", role: ROLE }] })];
    const ctx = world(raw);
    await commandsOf(settingsFrom(raw))[0]!.run(interaction().value, ctx);
    assert.deepEqual(log.roles, [`add ${ROLE}`]);
  });

  test("a command used where it is not allowed is refused before anything is shown", async () => {
    const raw = [command({ command: "locked", onlyChannels: [OTHER_CHANNEL] })];
    const ctx = world(raw);
    const { value, calls } = interaction();
    await commandsOf(settingsFrom(raw))[0]!.run(value, ctx);
    assert.deepEqual(calls, []);
    assert.equal(log.replies.length, 1);
    assert.equal(log.replies[0]!.body.embeds[0]?.description, "You can't use that here.");
  });

  test("a command used again too soon says how long to wait", async () => {
    const raw = [command({ command: "slow", cooldown: "1m" })];
    const ctx = world(raw);
    const made = commandsOf(settingsFrom(raw))[0]!;
    await made.run(interaction().value, ctx);
    log.replies.length = 0;
    await made.run(interaction().value, ctx);
    assert.equal(log.replies.length, 1);
    assert.match(log.replies[0]!.vars.remaining!, /^in \d+ seconds?$/);
  });

  test("a step that did not work tells the member in place of staying silent", async () => {
    const raw = [command({ command: "grant", steps: [{ type: "role", change: "give", role: HIGH_ROLE }] })];
    const ctx = world(raw);
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      await commandsOf(settingsFrom(raw))[0]!.run(interaction().value, ctx);
    } finally {
      console.warn = warn;
    }
    assert.match(String(log.replies.at(-1)!.body.embeds[0]?.description), /did not work/);
  });

  test("a command removed since it was registered says so", async () => {
    const raw = [command({ command: "gone" })];
    const made = commandsOf(settingsFrom(raw))[0]!;
    await made.run(interaction().value, world([]));
    assert.equal(log.replies[0]!.body.embeds[0]?.description, "That command has been removed.");
  });

  test("a wait after the reply is picked up again, and one for a removed command stops", async () => {
    const raw = [command({ command: "later", steps: [{ type: "wait", pause: "30s" }, { type: "message", where: "channel", channel: CHANNEL, message: text("later") }] })];
    const ctx = world(raw);
    await commandsOf(settingsFrom(raw))[0]!.run(interaction().value, ctx);
    assert.equal(log.scheduled.length, 1);
    assert.equal(log.scheduled[0]!.kind, "resume");
    await customcommands.tasks!.resume!(log.scheduled[0]!.payload, ctx);
    assert.deepEqual(log.sent, [{ content: "later" }]);
    await customcommands.tasks!.resume!({ ...log.scheduled[0]!.payload, workflowId: "gone" }, ctx);
    assert.equal(log.sent.length, 1);
  });
});
