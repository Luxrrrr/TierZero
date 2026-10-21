import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import type { MessageBody } from "@tier0/core";
import { createTestDatabase } from "./db-helper.ts";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { runSteps, freeze, thaw, countersOf } = await import("../dist/run.js");
const counters = await import("../dist/values.js");

const GUILD = "600000000000000001";
const CHANNEL = "610000000000000001";
const VOICE = "610000000000000002";
const ROLE = "620000000000000001";
const HIGH_ROLE = "620000000000000002";
const MEMBER = "630000000000000001";
const AUTHOR = "630000000000000002";
const MESSAGE = "640000000000000001";

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Workflow test" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

type Raw = Record<string, unknown>;
type Step = import("../dist/steps.js").Step;
type Scope = import("../dist/run.js").Scope;
type Runnable = import("../dist/run.js").Runnable;

interface Log {
  sent: { target: unknown; body: MessageBody; vars: Record<string, string>; options: { mentions?: { users?: string[]; roles?: string[] } } }[];
  replies: { vars: Record<string, string>; ephemeral?: boolean }[];
  scheduled: { kind: string; at: Date; payload: Record<string, unknown> }[];
  did: string[];
}

let log: Log;
let counter = 0;

const text = (content: string): MessageBody => ({ content, embeds: [], buttons: [], selects: [], reactions: [] });
const step = (type: string, extra: Raw = {}): Step => ({ type, ...extra }) as Step;
const flow = (steps: Step[], extra: Raw = {}): Runnable => ({ id: `w${++counter}`, name: `Flow ${counter}`, steps, ...extra }) as Runnable;

function person(id: string, name: string, roleIds: string[] = [], extra: Raw = {}) {
  return {
    id,
    displayName: name,
    user: { id, username: name.toLowerCase(), bot: false },
    roles: {
      cache: new Map(roleIds.map((role) => [role, { id: role }])),
      add: async (role: { id: string }) => void log.did.push(`${name} +${role.id}`),
      remove: async (role: { id: string }) => void log.did.push(`${name} -${role.id}`),
    },
    voice: { channelId: VOICE, setChannel: async (channel: { id: string }) => void log.did.push(`${name} moved ${channel.id}`) },
    moderatable: true,
    manageable: true,
    timeout: async (ms: number) => void log.did.push(`${name} timeout ${ms}`),
    setNickname: async (nick: string | null) => void log.did.push(`${name} nick ${nick}`),
    ...extra,
  };
}

function world(options: { member?: ReturnType<typeof person> } = {}) {
  const message = {
    id: MESSAGE,
    hasThread: false,
    react: async (emoji: string) => void log.did.push(`react ${emoji}`),
    delete: async () => void log.did.push("delete"),
    pin: async () => void log.did.push("pin"),
    startThread: async (input: { name: string }) => void log.did.push(`thread ${input.name}`),
  };
  const textChannel = { id: CHANNEL, name: "general", parent: { id: "650000000000000001", parent: null }, isTextBased: () => true, isVoiceBased: () => false, messages: { fetch: async () => message } };
  const voiceChannel = { id: VOICE, name: "Lounge", parent: null, isTextBased: () => false, isVoiceBased: () => true };
  const people = new Map<string, unknown>([
    [MEMBER, options.member ?? person(MEMBER, "Ada")],
    [AUTHOR, person(AUTHOR, "Grace")],
  ]);
  const ctx = {
    guild: {
      id: GUILD,
      channels: { cache: new Map<string, unknown>([[CHANNEL, textChannel], [VOICE, voiceChannel]]) },
      roles: { cache: new Map([[ROLE, { id: ROLE, name: "Gamers", position: 3 }], [HIGH_ROLE, { id: HIGH_ROLE, name: "Boss", position: 20 }]]) },
      members: {
        me: { permissions: { has: (flag: bigint) => flag === PermissionFlagsBits.ManageRoles || true }, roles: { highest: { position: 10 } } },
        cache: people,
        fetch: async (id: string) => (people.get(id) as never) ?? null,
      },
    },
    send: async (target: unknown, body: MessageBody, vars: Record<string, string>, opts: { mentions?: { users?: string[]; roles?: string[] } }) => {
      log.sent.push({ target, body, vars, options: opts });
      return { id: "900000000000000001" };
    },
    reply: async (_i: unknown, _body: MessageBody, vars: Record<string, string>, opts?: { ephemeral?: boolean }) => {
      log.replies.push({ vars, ephemeral: opts?.ephemeral });
      return true;
    },
    tasks: { schedule: async (kind: string, at: Date, payload: Record<string, unknown>) => void log.scheduled.push({ kind, at, payload }), cancel: async () => 0, reschedule: async () => undefined },
  };
  return { ctx: ctx as never, people };
}

const scopeOf = (workflow: { id: string }, extra: Partial<Scope> = {}): Scope => ({
  workflowId: workflow.id,
  vars: { user: `<@${MEMBER}>`, userName: "Ada", message: "hello world" },
  memberId: MEMBER,
  authorId: AUTHOR,
  channelId: CHANNEL,
  messageId: MESSAGE,
  replied: false,
  problems: [],
  ...extra,
});

const run = async (steps: Step[], extra: Raw = {}, scope: Partial<Scope> = {}, options: Parameters<typeof world>[0] = {}, others: Runnable[] = []) => {
  const w = world(options);
  const runnable = flow(steps, extra);
  const s = scopeOf(runnable, scope);
  await runSteps({ ctx: w.ctx, find: (name) => [runnable, ...others].find((entry) => entry.name === name) }, runnable, s);
  return { s, runnable, w };
};

const said = () => log.sent.map((entry) => entry.body.content);

beforeEach(() => {
  log = { sent: [], replies: [], scheduled: [], did: [] };
});

describe("if and else", () => {
  const yes = step("message", { where: "channel", channel: CHANNEL, message: text("yes") });
  const no = step("message", { where: "channel", channel: CHANNEL, message: text("no") });
  const after = step("message", { where: "channel", channel: CHANNEL, message: text("after") });

  test("the steps after a true if run, and the else is skipped", async () => {
    await run([step("ifChance", { ifChance: 100 }), yes, step("else"), no, step("endif"), after]);
    assert.deepEqual(said(), ["yes", "after"]);
  });

  test("a false if skips to its else", async () => {
    await run([step("ifRole", { ifRole: ROLE, ifHas: "has" }), yes, step("else"), no, step("endif"), after]);
    assert.deepEqual(said(), ["no", "after"]);
  });

  test("a false if with no else skips to the end", async () => {
    await run([step("ifRole", { ifRole: ROLE }), yes, step("endif"), after]);
    assert.deepEqual(said(), ["after"]);
  });

  test("ifs inside ifs", async () => {
    await run(
      [step("ifChance", { ifChance: 100 }), step("ifRole", { ifRole: ROLE }), step("message", { where: "channel", channel: CHANNEL, message: text("inner") }), step("else"), no, step("endif"), step("else"), yes, step("endif"), after],
    );
    assert.deepEqual(said(), ["no", "after"]);
  });

  test("an if that is never closed runs to the end of the list", async () => {
    await run([step("ifRole", { ifRole: ROLE }), yes, after]);
    assert.deepEqual(said(), []);
  });

  test("a stray else or end if does nothing", async () => {
    await run([step("endif"), yes, step("else"), after]);
    assert.deepEqual(said(), ["yes", "after"]);
  });

  test("a role the member has, or does not have", async () => {
    const holder = person(MEMBER, "Ada", [ROLE]);
    await run([step("ifRole", { ifRole: ROLE, ifHas: "has" }), yes, step("endif"), step("ifRole", { ifRole: ROLE, ifHas: "hasNot" }), no, step("endif")], {}, {}, { member: holder });
    assert.deepEqual(said(), ["yes"]);
  });

  test("a channel, which also covers the category above it", async () => {
    await run([step("ifChannel", { ifChannel: CHANNEL, ifIn: "in" }), yes, step("endif")]);
    await run([step("ifChannel", { ifChannel: "650000000000000001", ifIn: "in" }), no, step("endif")]);
    await run([step("ifChannel", { ifChannel: CHANNEL, ifIn: "notIn" }), after, step("endif")]);
    assert.deepEqual(said(), ["yes", "no"]);
  });

  test("words in the message", async () => {
    await run([step("ifWords", { ifWords: ["world"], ifWordMode: "word" }), yes, step("else"), no, step("endif")]);
    await run([step("ifWords", { ifWords: ["planet"], ifWordMode: "contains" }), yes, step("else"), no, step("endif")]);
    assert.deepEqual(said(), ["yes", "no"]);
  });

  test("an if with nothing to check is false", async () => {
    await run([step("ifRole", {}), yes, step("else"), no, step("endif")]);
    assert.deepEqual(said(), ["no"]);
  });
});

describe("counters", () => {
  const tell = step("message", { where: "channel", channel: CHANNEL, message: text("{wins} of {total}") });

  test("add, take away and set, kept for each member", async () => {
    await run([step("variable", { setName: "wins", setScope: "member", setHow: "add", setAmount: 3 }), step("variable", { setName: "wins", setScope: "member", setHow: "subtract", setAmount: 1 }), tell]);
    assert.equal(log.sent[0]!.vars.wins, "2");
    await run([step("variable", { setName: "wins", setScope: "member", setHow: "set", setAmount: 10 }), tell]);
    assert.equal(log.sent[1]!.vars.wins, "10");
  });

  test("one for the whole server is shared by every member", async () => {
    const bump = step("variable", { setName: "total", setScope: "server", setHow: "add", setAmount: 1 });
    const show = step("message", { where: "channel", channel: CHANNEL, message: text("{total}") });
    await run([bump, bump, show]);
    await run([bump, show], {}, { memberId: AUTHOR });
    assert.deepEqual(log.sent.map((entry) => entry.vars.total), ["2", "3"]);
  });

  test("an if can test one", async () => {
    await run([step("variable", { setName: "streak", setScope: "member", setHow: "set", setAmount: 5 })]);
    const test = (how: string, amount: number) => [step("ifVariable", { testName: "streak", testScope: "member", testHow: how, testAmount: amount }), step("message", { where: "channel", channel: CHANNEL, message: text(`${how} ${amount}`) }), step("endif")];
    await run([...test("atLeast", 5), ...test("greater", 5), ...test("less", 6), ...test("notEquals", 5)]);
    assert.deepEqual(said(), ["atLeast 5", "less 6"]);
  });

  test("a counter nobody set reads as zero, and members do not share one", async () => {
    await run([step("variable", { setName: "fresh", setScope: "member", setAmount: 4 }), step("message", { where: "channel", channel: CHANNEL, message: text("{fresh}") })], {}, { memberId: "630000000000000009" });
    await run([step("variable", { setName: "fresh", setScope: "member", setHow: "add", setAmount: 0 }), step("message", { where: "channel", channel: CHANNEL, message: text("{fresh}") })]);
    assert.deepEqual(log.sent.map((entry) => entry.vars.fresh), ["4", "0"]);
  });

  test("a counter kept for each member with no member says so", async () => {
    const { s } = await run([step("variable", { setName: "wins", setScope: "member", setHow: "add", setAmount: 1 })], {}, { memberId: null });
    assert.equal(s.problems.length, 1);
  });

  test("two runs at once both count", async () => {
    const adding = step("variable", { setName: "busy", setScope: "server", setHow: "add", setAmount: 1 });
    await Promise.all(Array.from({ length: 12 }, () => run([adding])));
    assert.equal((await counters.read(GUILD, "server", null, ["busy"])).busy, 12);
  });

  test("stay inside what the database holds", async () => {
    await counters.change(GUILD, "server", null, "big", "set", 2_000_000_000);
    await counters.change(GUILD, "server", null, "big", "add", 1_000_000);
    assert.equal((await counters.read(GUILD, "server", null, ["big"])).big, 2_000_000_000);
  });

  test("the names a list of steps uses, and which kind each is", () => {
    const found = countersOf([step("variable", { setName: "a", setScope: "server" }), step("ifVariable", { testName: "a", testScope: "member" }), step("ifVariable", { testName: "b", testScope: "server" })]);
    assert.deepEqual([...found.entries()], [["a", "member"], ["b", "server"]]);
  });
});

describe("who a step acts on", () => {
  test("the member who set it off, or the author of the message", async () => {
    await run([step("role", { change: "give", role: ROLE, roleTarget: "member" }), step("role", { change: "give", role: ROLE, roleTarget: "author" })]);
    assert.deepEqual(log.did, [`Ada +${ROLE}`, `Grace +${ROLE}`]);
  });

  test("the author is the member when nobody else wrote the message", async () => {
    await run([step("nickname", { nickname: "X", nickTarget: "author" })], {}, { authorId: null });
    assert.deepEqual(log.did, ["Ada nick X"]);
  });

  test("a direct message goes to the one chosen", async () => {
    const { w } = await run([step("message", { where: "dm", dmTarget: "author", message: text("hi") })]);
    assert.equal(log.sent[0]!.target, w.people.get(AUTHOR));
  });
});

describe("the steps", () => {
  test("pin the message and start a thread on it, named from the values", async () => {
    await run([step("pin"), step("thread", { threadName: "Talk about {userName}" })]);
    assert.deepEqual(log.did, ["pin", "thread Talk about Ada"]);
  });

  test("a thread is not started on a message that has one", async () => {
    const { s } = await run([step("thread", { threadName: "x" })]);
    log.did.length = 0;
    const w = world();
    const channel = w.ctx.guild.channels.cache.get(CHANNEL);
    (channel.messages as { fetch: () => Promise<unknown> }).fetch = async () => ({ hasThread: true });
    const runnable = flow([step("thread", { threadName: "x" })]);
    const again = scopeOf(runnable);
    await runSteps({ ctx: w.ctx, find: () => undefined }, runnable, again);
    assert.equal(again.problems.length, 1);
    assert.equal(s.problems.length, 0);
  });

  test("move a member who is in voice, and say when they are not", async () => {
    await run([step("voice", { voiceTo: VOICE, voiceTarget: "member" })]);
    assert.deepEqual(log.did, [`Ada moved ${VOICE}`]);
    const away = person(MEMBER, "Ada", [], { voice: { channelId: null, setChannel: async () => undefined } });
    const { s } = await run([step("voice", { voiceTo: VOICE })], {}, {}, { member: away });
    assert.equal(s.problems.length, 1);
  });

  test("never hand out a role above the bot's own", async () => {
    const { s } = await run([step("role", { change: "give", role: HIGH_ROLE })]);
    assert.deepEqual(log.did, []);
    assert.equal(s.problems.length, 1);
  });

  test("a step that Discord refuses does not stop the ones after it", async () => {
    const refusing = person(MEMBER, "Ada", [], { timeout: async () => Promise.reject(new Error("Missing Permissions")) });
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      const { s } = await run([step("timeout", { length: 60_000 }), step("react", { emoji: "🎉" })], {}, {}, { member: refusing });
      assert.equal(s.problems.length >= 1, true);
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(log.did, ["react 🎉"]);
  });

  test("another workflow runs by its name, and one that runs itself stops", async () => {
    const other = flow([step("message", { where: "channel", channel: CHANNEL, message: text("from other") })], { name: "Other" });
    await run([step("run", { workflowName: "Other" })], {}, {}, {}, [other]);
    assert.deepEqual(said(), ["from other"]);

    log.sent.length = 0;
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      const looping = flow([step("message", { where: "channel", channel: CHANNEL, message: text("again") }), step("run", { workflowName: "Loop" })], { name: "Loop" });
      const w = world();
      const s = scopeOf(looping);
      await runSteps({ ctx: w.ctx, find: (name) => (name === "Loop" ? looping : undefined) }, looping, s);
      assert.equal(said().length, 4);
      assert.equal(s.problems.length >= 1, true);
    } finally {
      console.warn = warn;
    }
  });

  test("a workflow that does not exist is a problem, not a crash", async () => {
    const { s } = await run([step("run", { workflowName: "Nothing" })]);
    assert.equal(s.problems.length, 1);
  });
});

describe("waiting inside a branch", () => {
  const out = (word: string) => step("message", { where: "channel", channel: CHANNEL, message: text(word) });

  test("stores the rest and carries on from there, still inside the branch", async () => {
    const steps = [step("ifChance", { ifChance: 100 }), out("a"), step("wait", { pause: 30_000 }), out("b"), step("else"), out("c"), step("endif"), out("d")];
    const { s, runnable, w } = await run(steps);
    assert.deepEqual(said(), ["a"]);
    assert.equal(log.scheduled.length, 1);
    assert.equal(log.scheduled[0]!.payload.from, 3);

    const frozen = thaw(JSON.parse(JSON.stringify(log.scheduled[0]!.payload)));
    assert.ok(frozen);
    await runSteps({ ctx: w.ctx, find: () => undefined }, runnable, frozen!.scope, frozen!.from);
    // After the wait it runs b, reaches the else, and skips to the end, so c is never said.
    assert.deepEqual(said(), ["a", "b", "d"]);
    assert.equal(s.problems.length, 0);
  });

  test("a wait with nothing after it stores nothing", async () => {
    await run([step("wait", { pause: 30_000 })]);
    assert.equal(log.scheduled.length, 0);
  });

  test("a stored run keeps its values short", () => {
    const stored = freeze(scopeOf({ id: "x" }, { vars: { big: "x".repeat(900) } }), 1);
    assert.equal((stored.vars as Record<string, string>).big!.length, 500);
  });
});
