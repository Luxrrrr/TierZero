import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, assignedRoles, type MessageBody } from "@tier0/core";
import automations from "../dist/index.js";

const GUILD = "500000000000000001";
const CHANNEL = "510000000000000001";
const VOICE = "510000000000000002";
const ROLE = "520000000000000001";
const OTHER_ROLE = "520000000000000002";
const MEMBER = "530000000000000001";
const AUTHOR = "530000000000000002";

const registry = new ModuleRegistry();
registry.register(automations);

type Raw = Record<string, unknown>;

let counter = 0;
const text = (content: string): MessageBody => ({ content, embeds: [], buttons: [], selects: [], reactions: [] });
const say = (word: string): Raw => ({ type: "message", where: "channel", channel: CHANNEL, message: text(word) });
const flow = (extra: Raw = {}): Raw => ({ id: `w${++counter}`, name: `Flow ${counter}`, trigger: "memberJoin", steps: [say("hi {userName}")], ...extra });

function settingsFrom(workflows: Raw[], more: Raw = {}) {
  const result = registry.resolveSettings("automations", { workflows, ...more });
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors));
  return result.value as import("../dist/settings.js").AutomationSettings;
}

interface Log {
  sent: { target: unknown; vars: Record<string, string>; content: string }[];
  scheduled: { kind: string; at: Date; payload: Record<string, unknown> }[];
  cancelled: string[];
}

let log: Log;

function person(id: string, name: string, roleIds: string[] = [], extra: Raw = {}) {
  return { id, displayName: name, user: { id, username: name.toLowerCase(), bot: false }, roles: { cache: new Map(roleIds.map((role) => [role, { id: role }])) }, ...extra };
}

function world(workflows: Raw[], more: Raw = {}) {
  const textChannel = { id: CHANNEL, name: "general", parent: null, isTextBased: () => true, isVoiceBased: () => false };
  const people = new Map<string, unknown>([[MEMBER, person(MEMBER, "Ada")], [AUTHOR, person(AUTHOR, "Grace")]]);
  const ctx = {
    guild: {
      id: GUILD,
      channels: { cache: new Map<string, unknown>([[CHANNEL, textChannel]]) },
      roles: { cache: new Map([[ROLE, { id: ROLE, name: "Gamers", position: 3 }]]) },
      members: { me: undefined, cache: people, fetch: async (id: string) => (people.get(id) as never) ?? null },
    },
    settings: settingsFrom(workflows, more),
    send: async (target: unknown, body: MessageBody, vars: Record<string, string>) => {
      log.sent.push({ target, vars, content: body.content });
      return { id: "900000000000000001" };
    },
    reply: async () => true,
    tasks: {
      schedule: async (kind: string, at: Date, payload: Record<string, unknown>) => void log.scheduled.push({ kind, at, payload }),
      cancel: async (kind: string) => void log.cancelled.push(kind),
      reschedule: async () => undefined,
    },
  };
  return { ctx: ctx as never, people };
}

beforeEach(() => {
  log = { sent: [], scheduled: [], cancelled: [] };
});

const events = automations.events!;

describe("the settings", () => {
  test("a workflow starts with its own defaults", () => {
    const [workflow] = settingsFrom([{ id: "a1", steps: [{}] }]).workflows;
    assert.equal(workflow!.enabled, true);
    assert.equal(workflow!.trigger, "memberJoin");
    assert.equal(workflow!.chance, 100);
    assert.equal(workflow!.cooldown, 0);
    assert.equal(workflow!.steps[0]!.type, "message");
  });

  test("a workflow needs a step", () => {
    assert.ok(!registry.resolveSettings("automations", { workflows: [flow({ steps: [] })] }).ok);
  });

  test("a counter's name has to work as a {variable}", () => {
    const bad = flow({ steps: [{ type: "variable", setName: "user", setAmount: 1 }] });
    assert.ok(!registry.resolveSettings("automations", { workflows: [bad] }).ok);
    const good = flow({ steps: [{ type: "variable", setName: "wins", setAmount: 1 }] });
    assert.ok(registry.resolveSettings("automations", { workflows: [good] }).ok);
  });

  test("a time on a schedule is hours and minutes", () => {
    assert.ok(!registry.resolveSettings("automations", { workflows: [flow({ trigger: "schedule", time: "8pm" })] }).ok);
    assert.ok(registry.resolveSettings("automations", { workflows: [flow({ trigger: "schedule", time: "20:00" })] }).ok);
  });

  test("the roles a workflow hands out are found inside its steps, so saving them is held to the rules for a role menu", () => {
    const summary = registry.describe().find((entry) => entry.id === "automations");
    const stored = { workflows: [flow({ steps: [{ type: "role", change: "give", role: ROLE }] })] };
    assert.deepEqual([...assignedRoles(summary!.schema as never, stored).keys()], [ROLE]);
  });
});

describe("members", () => {
  test("a member joining sets off the join workflows, and a bot does not", async () => {
    const { ctx } = world([flow({ trigger: "memberJoin" }), flow({ trigger: "memberLeave" })]);
    await events.memberJoin!({ ...person(MEMBER, "Ada"), user: { id: MEMBER, username: "ada", bot: true } } as never, ctx);
    assert.equal(log.sent.length, 0);
    await events.memberJoin!(person(MEMBER, "Ada") as never, ctx);
    assert.equal(log.sent.length, 1);
    assert.equal(log.sent[0]!.vars.userName, "Ada");
  });

  test("a member leaving sets off the leave workflows", async () => {
    const { ctx } = world([flow({ trigger: "memberLeave" })]);
    await events.memberLeave!(person(MEMBER, "Ada") as never, ctx);
    assert.equal(log.sent.length, 1);
  });

  test("a role gained or lost is told apart, and only the watched role counts", async () => {
    const { ctx } = world([flow({ trigger: "role", roleChange: "gained", watchedRole: ROLE }), flow({ trigger: "role", roleChange: "lost", watchedRole: ROLE })]);
    await events.memberUpdate!(person(MEMBER, "Ada", []) as never, person(MEMBER, "Ada", [ROLE]) as never, ctx);
    assert.equal(log.sent.length, 1);
    assert.equal(log.sent[0]!.vars.role, "Gamers");
    await events.memberUpdate!(person(MEMBER, "Ada", [ROLE]) as never, person(MEMBER, "Ada", []) as never, ctx);
    assert.equal(log.sent.length, 2);
    await events.memberUpdate!(person(MEMBER, "Ada", [OTHER_ROLE]) as never, person(MEMBER, "Ada", [OTHER_ROLE]) as never, ctx);
    assert.equal(log.sent.length, 2);
  });

  test("a member who starts boosting sets off the boost workflows, once", async () => {
    const { ctx } = world([flow({ trigger: "boost" })]);
    await events.memberUpdate!(person(MEMBER, "Ada", [], { premiumSinceTimestamp: null }) as never, person(MEMBER, "Ada", [], { premiumSinceTimestamp: 1_000 }) as never, ctx);
    await events.memberUpdate!(person(MEMBER, "Ada", [], { premiumSinceTimestamp: 1_000 }) as never, person(MEMBER, "Ada", [], { premiumSinceTimestamp: 1_000 }) as never, ctx);
    assert.equal(log.sent.length, 1);
  });

  test("a ban sets off the ban workflows for someone who is no longer in the server", async () => {
    const { ctx } = world([flow({ trigger: "ban" })]);
    await events.banAdd!({ user: { id: MEMBER, username: "ada", bot: false } } as never, ctx);
    assert.equal(log.sent.length, 1);
  });
});

describe("messages and reactions", () => {
  const sentBy = (author: Raw, content = "well hello there") => ({
    guild: {},
    author,
    content,
    member: person(MEMBER, "Ada"),
    channel: { id: CHANNEL, name: "general", parent: null, isDMBased: () => false },
    id: "800000000000000001",
    url: "",
  });

  test("a message that says the phrase sets a workflow off, and a bot's does not", async () => {
    const { ctx } = world([flow({ trigger: "message", phrases: ["hello"], matchMode: "word" })]);
    await events.messageCreate!(sentBy({ id: MEMBER, username: "ada", bot: true }) as never, ctx);
    assert.equal(log.sent.length, 0);
    await events.messageCreate!(sentBy({ id: MEMBER, username: "ada", bot: false }) as never, ctx);
    assert.equal(log.sent.length, 1);
    assert.equal(log.sent[0]!.vars.message, "well hello there");
  });

  test("a message that does not say it sets nothing off", async () => {
    const { ctx } = world([flow({ trigger: "message", phrases: ["bye"] })]);
    await events.messageCreate!(sentBy({ id: MEMBER, username: "ada", bot: false }) as never, ctx);
    assert.equal(log.sent.length, 0);
  });

  const reaction = (name: string) => ({
    partial: false,
    emoji: { id: null, name, animated: false },
    message: {
      partial: false,
      guild: {},
      id: "800000000000000001",
      content: "x",
      url: "",
      author: { id: AUTHOR, username: "grace" },
      member: person(AUTHOR, "Grace"),
      channel: { id: CHANNEL, name: "general", parent: null, isDMBased: () => false },
    },
  });
  const user = { id: MEMBER, username: "ada", partial: false };

  test("a reaction counts when it is the emoji, or any when none was set, and knows who wrote the message", async () => {
    const { ctx } = world([flow({ trigger: "reaction", reactionEmoji: "🎉" })]);
    await events.reactionAdd!(reaction("🔥") as never, user as never, ctx);
    assert.equal(log.sent.length, 0);
    await events.reactionAdd!(reaction("🎉") as never, user as never, ctx);
    assert.equal(log.sent.length, 1);
    assert.equal(log.sent[0]!.vars.emoji, "🎉");
    assert.equal(log.sent[0]!.vars.authorName, "Grace");
  });
});

describe("voice and threads", () => {
  const change = (before: string | null, after: string | null) => [
    { channelId: before, member: person(MEMBER, "Ada"), channel: before ? { id: before, name: "Lounge", parent: null } : null },
    { channelId: after, member: person(MEMBER, "Ada"), channel: after ? { id: after, name: "Lounge", parent: null } : null },
  ];

  test("joining voice and leaving it are told apart, and moving counts as joining", async () => {
    const { ctx } = world([flow({ trigger: "voice", voiceChange: "joined" }), flow({ trigger: "voice", voiceChange: "left" })]);
    const [a, b] = change(null, VOICE);
    await events.voiceStateUpdate!(a as never, b as never, ctx);
    assert.equal(log.sent.length, 1);
    const [c, d] = change(VOICE, null);
    await events.voiceStateUpdate!(c as never, d as never, ctx);
    assert.equal(log.sent.length, 2);
    const [e, f] = change(VOICE, "510000000000000009");
    await events.voiceStateUpdate!(e as never, f as never, ctx);
    assert.equal(log.sent.length, 3);
    const [g, h] = change(VOICE, VOICE);
    await events.voiceStateUpdate!(g as never, h as never, ctx);
    assert.equal(log.sent.length, 3);
  });

  test("a thread started by a member sets off the thread workflows, and one started by a bot does not", async () => {
    const { ctx, people } = world([flow({ trigger: "thread" })]);
    const thread = { id: "540000000000000001", name: "Chat", ownerId: MEMBER, parent: { id: CHANNEL, name: "general", parent: null } };
    await events.threadCreate!(thread as never, ctx);
    assert.equal(log.sent.length, 1);
    people.set(MEMBER, { ...person(MEMBER, "Ada"), user: { id: MEMBER, username: "ada", bot: true } });
    await events.threadCreate!(thread as never, ctx);
    assert.equal(log.sent.length, 1);
  });
});

describe("workflows that are off, and the checks", () => {
  test("a workflow that is off is left alone", async () => {
    const { ctx } = world([flow({ enabled: false })]);
    await events.memberJoin!(person(MEMBER, "Ada") as never, ctx);
    assert.equal(log.sent.length, 0);
  });

  test("a member waits between runs", async () => {
    const { ctx } = world([flow({ cooldown: "1m" })]);
    await events.memberJoin!(person(MEMBER, "Ada") as never, ctx);
    await events.memberJoin!(person(MEMBER, "Ada") as never, ctx);
    assert.equal(log.sent.length, 1);
  });

  test("a member with an excluded role is left out", async () => {
    const { ctx } = world([flow({ exceptRoles: [ROLE] })]);
    await events.memberJoin!(person(MEMBER, "Ada", [ROLE]) as never, ctx);
    assert.equal(log.sent.length, 0);
  });
});

describe("schedules", () => {
  test("every schedule that is on is queued when the settings change, after the old ones are cleared", async () => {
    const { ctx } = world([flow({ trigger: "schedule", every: "day", time: "20:00" }), flow({ trigger: "schedule", enabled: false }), flow({ trigger: "memberJoin" })], { timeZone: "Asia/Tokyo" });
    await automations.onSettingsChange!(ctx, {} as never);
    assert.deepEqual(log.cancelled, ["scheduled"]);
    assert.equal(log.scheduled.length, 1);
    assert.equal(log.scheduled[0]!.kind, "scheduled");
    const next = log.scheduled[0]!.at;
    assert.ok(next.getTime() > Date.now());
    // 20:00 in Tokyo is 11:00 UTC.
    assert.equal(next.getUTCHours(), 11);
    assert.equal(next.getUTCMinutes(), 0);
  });

  test("turning the feature off clears them", async () => {
    const { ctx } = world([flow({ trigger: "schedule" })]);
    await automations.onDisable!(ctx);
    assert.deepEqual(log.cancelled, ["scheduled"]);
  });

  test("a schedule that comes due runs its steps with nobody to act on, and queues the next time", async () => {
    const raw = flow({ trigger: "schedule", every: "hour", time: "00:30" });
    const { ctx } = world([raw]);
    await automations.tasks!.scheduled!({ workflowId: raw.id }, ctx);
    assert.equal(log.scheduled.length, 1);
    assert.equal(log.sent.length, 1);
    assert.equal(log.sent[0]!.vars.user, "");
    assert.equal(log.sent[0]!.vars.userName, "");
  });

  test("a schedule that was switched off or removed does nothing when it comes due", async () => {
    const raw = flow({ trigger: "schedule", enabled: false });
    const { ctx } = world([raw]);
    await automations.tasks!.scheduled!({ workflowId: raw.id }, ctx);
    await automations.tasks!.scheduled!({ workflowId: "gone" }, ctx);
    assert.equal(log.sent.length, 0);
    assert.equal(log.scheduled.length, 0);
  });

  test("a wait is picked up again, and one for a workflow that was removed stops", async () => {
    const raw = flow({ steps: [{ type: "wait", pause: "30s" }, say("later")] });
    const { ctx } = world([raw]);
    const payload = { workflowId: raw.id, from: 1, memberId: MEMBER, authorId: null, channelId: CHANNEL, messageId: null, vars: { userName: "Ada" } };
    await automations.tasks!.resume!(payload, ctx);
    assert.equal(log.sent.length, 1);
    await automations.tasks!.resume!({ ...payload, workflowId: "gone" }, ctx);
    assert.equal(log.sent.length, 1);
  });
});
