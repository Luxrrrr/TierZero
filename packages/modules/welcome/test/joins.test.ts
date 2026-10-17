import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, type FieldDescriptor } from "@tier0/core";
import welcome from "../dist/index.js";
import { rolesTiming } from "../dist/messages.js";

const CHANNEL = "123456789012345678";
const ROLE = "223456789012345678";
const USER = "323456789012345678";

const registry = new ModuleRegistry();
registry.register(welcome);

function settingsFor(stored: unknown) {
  const result = registry.resolveSettings("welcome", stored);
  assert.ok(result.ok, result.ok ? "" : result.errors.map((e) => `${e.path} ${e.message}`).join("; "));
  return result.value;
}

let given: string[];
let posted: string[];
let scheduled: { kind: string; runAt: Date; payload: unknown }[];
let cancelled: unknown[];

function member(options: { bot?: boolean; pending?: boolean; holds?: string[] } = {}) {
  const held = new Set(options.holds ?? []);
  return {
    id: USER,
    pending: options.pending ?? false,
    partial: false,
    joinedTimestamp: Date.now(),
    user: { username: "pixelpilot", bot: options.bot ?? false },
    guild: { name: "Northwind", memberCount: 12 },
    roles: {
      cache: { has: (id: string) => held.has(id) },
      add: async (role: { id: string }) => {
        held.add(role.id);
        given.push(role.id);
      },
    },
  };
}

function context(stored: unknown, target = member()) {
  return {
    settings: settingsFor(stored),
    guild: {
      name: "Northwind",
      channels: { cache: { get: () => ({ isTextBased: () => true }) } },
      roles: { cache: { get: (id: string) => (id === ROLE ? { id, name: "Recruit", position: 1 } : undefined) } },
      members: { me: { roles: { highest: { position: 5 } } }, fetch: async () => target },
    },
    tasks: {
      schedule: async (kind: string, runAt: Date, payload: unknown) => {
        scheduled.push({ kind, runAt, payload });
      },
      cancel: async (_kind: string, match: unknown) => {
        cancelled.push(match);
        return 0;
      },
    },
    send: async (target: { id?: string }) => {
      posted.push(target.id ?? "dm");
      return {};
    },
  } as never;
}

const events = welcome.events!;

beforeEach(() => {
  given = [];
  posted = [];
  scheduled = [];
  cancelled = [];
});

describe("bots", () => {
  test("are left out when the switch is on: no greeting, no roles", async () => {
    await events.memberJoin!(member({ bot: true }) as never, context({ ignoreBots: true, join: { channel: CHANNEL, roles: [ROLE] } }));
    assert.deepEqual(given, []);
    assert.deepEqual(posted, []);
  });

  test("are still welcomed on a server that saved its settings before the switch existed", async () => {
    await events.memberJoin!(member({ bot: true }) as never, context({ join: { channel: CHANNEL, roles: [ROLE] } }));
    assert.deepEqual(given, [ROLE]);
    assert.equal(posted.length, 1);
  });

  test("are greeted like anyone else when the switch is off", async () => {
    await events.memberJoin!(member({ bot: true }) as never, context({ ignoreBots: false, join: { channel: CHANNEL, roles: [ROLE] } }));
    assert.deepEqual(given, [ROLE]);
    assert.equal(posted.length, 1);
  });
});

describe("join roles", () => {
  test("are given on join by default", async () => {
    await events.memberJoin!(member() as never, context({ join: { roles: [ROLE] } }));
    assert.deepEqual(given, [ROLE]);
  });

  test("after a wait are scheduled, and given when the wait is over", async () => {
    const target = member();
    const ctx = context({ join: { roles: [ROLE], rolesWhen: "delay", rolesDelay: "30m" } }, target);
    const before = Date.now();
    await events.memberJoin!(target as never, ctx);
    assert.deepEqual(given, []);
    assert.equal(scheduled[0]?.kind, "giveRoles");
    assert.deepEqual(scheduled[0]?.payload, { userId: USER });
    assert.ok((scheduled[0]?.runAt.getTime() ?? 0) >= before + 30 * 60_000);

    await welcome.tasks!.giveRoles!({ userId: USER }, ctx);
    assert.deepEqual(given, [ROLE]);
  });

  test("waiting for a member who leaves first are not given", async () => {
    await events.memberLeave!(member() as never, context({ join: { roles: [ROLE], rolesWhen: "delay" } }));
    assert.deepEqual(cancelled, [{ userId: USER }]);
  });

  test("after screening wait until the member accepts the rules", async () => {
    const ctx = context({ join: { roles: [ROLE], rolesWhen: "screening" } });
    await events.memberJoin!(member({ pending: true }) as never, ctx);
    assert.deepEqual(given, []);
    await events.memberUpdate!(member({ pending: true }) as never, member({ pending: false }) as never, ctx);
    assert.deepEqual(given, [ROLE]);
  });

  test("after screening are given on join in a server without screening", async () => {
    await events.memberJoin!(member({ pending: false }) as never, context({ join: { roles: [ROLE], rolesWhen: "screening" } }));
    assert.deepEqual(given, [ROLE]);
  });

  test("timing reads the setting and whether the member is still screening", () => {
    assert.equal(rolesTiming("join", true), "now");
    assert.equal(rolesTiming("delay", false), "later");
    assert.equal(rolesTiming("screening", true), "screening");
    assert.equal(rolesTiming("screening", false), "now");
    assert.equal(rolesTiming("screening", null), "now");
  });
});

describe("what the dashboard is told", () => {
  const summary = registry.describe().find((entry) => entry.id === "welcome");
  const fields = summary?.schema.fields as Record<string, FieldDescriptor>;
  const join = fields.join?.fields as Record<string, FieldDescriptor>;
  const leave = fields.leave?.fields as Record<string, FieldDescriptor>;

  test("the feature needs a greeting, a farewell, a direct message or a role before it does anything", () => {
    const set = [join.channel, join.roles, join.sendDm, leave.channel, leave.sendDm].map((field) => field?.essential);
    assert.deepEqual(set, ["action", "action", "action", "action", "action"]);
  });

  test("the join roles are roles the bot hands out", () => {
    assert.equal((join.roles?.of as FieldDescriptor).assigns, true);
  });
});
