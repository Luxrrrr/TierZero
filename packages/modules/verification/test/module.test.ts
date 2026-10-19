import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, type MessageBody } from "@tier0/core";
import verification from "../dist/index.js";
import { REPLIES } from "../dist/messages.js";

const ROLE = "223456789012345678";
const UNVERIFIED = "423456789012345678";
const USER = "323456789012345678";
const DAY = 86_400_000;

const registry = new ModuleRegistry();
registry.register(verification);

interface Resolved {
  ignoreBots: boolean;
  roles: { verified?: string; unverified?: string };
  check: { method: string; answers: string[]; maxAttempts: number; afterTries: string; lockoutLength: number };
  newMembers: { minAccountAge?: number; youngAction: string; timeoutAction: string; timeout: number };
  log: { channel?: string };
  replies: Record<string, MessageBody>;
}

function settingsFor(stored: unknown): Resolved {
  const result = registry.resolveSettings("verification", stored);
  assert.ok(result.ok, result.ok ? "" : result.errors.map((e) => `${e.path} ${e.message}`).join("; "));
  return result.value as Resolved;
}

describe("the settings", () => {
  test("parse with nothing stored, and wait for a role to be picked", () => {
    const settings = settingsFor({});
    assert.equal(settings.roles.verified, undefined);
    assert.equal(settings.ignoreBots, true);
    assert.equal(settings.check.method, "button");
    assert.deepEqual(settings.check.answers, []);
    assert.equal(settings.check.maxAttempts, 3);
    assert.equal(settings.check.afterTries, "lockout");
    assert.equal(settings.check.lockoutLength, 10 * 60_000);
    assert.equal(settings.newMembers.minAccountAge, undefined);
    assert.equal(settings.newMembers.timeoutAction, "nothing");
    assert.equal(settings.newMembers.timeout, DAY);
    assert.equal(settings.log.channel, undefined);
  });

  test("start every reply as the default wording", () => {
    const settings = settingsFor({});
    for (const [key, definition] of Object.entries(REPLIES)) {
      const message = settings.replies[key];
      assert.ok(message, key);
      assert.equal(message.content, definition.starting.content, key);
      assert.equal(message.embeds[0]?.description, definition.starting.embeds[0]?.description, key);
    }
  });

  test("refuse a label longer than Discord allows", () => {
    assert.equal(registry.resolveSettings("verification", { labels: { modalTitle: "x".repeat(46) } }).ok, false);
    assert.equal(registry.resolveSettings("verification", { labels: { verifyButton: "x".repeat(81) } }).ok, false);
    assert.equal(registry.resolveSettings("verification", { labels: { reasonTimeout: "x".repeat(513) } }).ok, false);
    assert.ok(registry.resolveSettings("verification", { labels: { modalTitle: "x".repeat(45) } }).ok);
  });

  test("take a minimum account age", () => {
    const settings = settingsFor({ newMembers: { minAccountAge: "7d", youngAction: "kick" } });
    assert.equal(settings.newMembers.minAccountAge, 7 * DAY);
    assert.equal(settings.newMembers.youngAction, "kick");
  });
});

let given: string[];
let removed: string[];
let kicked: string[];
let scheduled: { kind: string; runAt: Date; payload: unknown }[];
let cancelled: { kind: string; match: unknown }[];
let sent: string[];

function member(options: { bot?: boolean; holds?: string[]; ageDays?: number } = {}) {
  const held = new Set(options.holds ?? []);
  return {
    id: USER,
    kickable: true,
    user: { id: USER, username: "pixelpilot", bot: options.bot ?? false, createdTimestamp: Date.now() - (options.ageDays ?? 400) * DAY },
    roles: {
      cache: { has: (id: string) => held.has(id) },
      add: async (role: { id: string }) => {
        held.add(role.id);
        given.push(role.id);
      },
      remove: async (id: string) => {
        held.delete(id);
        removed.push(id);
      },
    },
    kick: async (reason: string) => {
      kicked.push(reason);
    },
  };
}

function context(stored: unknown, target = member(), rolePosition = 1) {
  const roles = new Map([
    [ROLE, { id: ROLE, name: "Verified", position: rolePosition }],
    [UNVERIFIED, { id: UNVERIFIED, name: "Unverified", position: rolePosition }],
  ]);
  return {
    settings: settingsFor(stored),
    guild: {
      id: "523456789012345678",
      name: "Northwind",
      channels: { cache: { get: () => ({ isTextBased: () => true, id: "9" }) } },
      roles: { cache: { get: (id: string) => roles.get(id) } },
      members: { me: { roles: { highest: { position: 5 } } }, fetch: async () => target },
    },
    tasks: {
      schedule: async () => {},
      reschedule: async (kind: string, runAt: Date, payload: unknown) => {
        scheduled.push({ kind, runAt, payload });
      },
      cancel: async (kind: string, match: unknown) => {
        cancelled.push({ kind, match });
        return 0;
      },
    },
    send: async (_target: unknown, _body: unknown, values: Record<string, unknown>) => {
      sent.push(String(values.reason ?? "post"));
      return {};
    },
  } as never;
}

const events = verification.events!;

beforeEach(() => {
  given = [];
  removed = [];
  kicked = [];
  scheduled = [];
  cancelled = [];
  sent = [];
});

describe("a member joining", () => {
  const stored = { roles: { verified: ROLE, unverified: UNVERIFIED } };

  test("changes nothing until a verified role is picked", async () => {
    await events.memberJoin!(member() as never, context({}));
    assert.deepEqual(given, []);
    assert.deepEqual(scheduled, []);
  });

  test("gets the unverified role, and no timer when the wait is switched off", async () => {
    await events.memberJoin!(member() as never, context(stored));
    assert.deepEqual(given, [UNVERIFIED]);
    assert.deepEqual(scheduled, []);
  });

  test("gets a timer when unverified members are to be removed", async () => {
    const before = Date.now();
    await events.memberJoin!(member() as never, context({ ...stored, newMembers: { timeoutAction: "kick", timeout: "2h" } }));
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0]?.kind, "kickUnverified");
    assert.deepEqual(scheduled[0]?.payload, { userId: USER });
    assert.ok((scheduled[0]?.runAt.getTime() ?? 0) >= before + 2 * 3_600_000);
  });

  test("is left alone when already verified", async () => {
    await events.memberJoin!(member({ holds: [ROLE] }) as never, context(stored));
    assert.deepEqual(given, []);
  });

  test("is left alone when a bot, unless bots are included", async () => {
    await events.memberJoin!(member({ bot: true }) as never, context(stored));
    assert.deepEqual(given, []);
    await events.memberJoin!(member({ bot: true }) as never, context({ ...stored, ignoreBots: false }));
    assert.deepEqual(given, [UNVERIFIED]);
  });

  test("is removed at once when the account is too new and that is the choice", async () => {
    const ctx = context({ ...stored, newMembers: { minAccountAge: "7d", youngAction: "kick" } });
    await events.memberJoin!(member({ ageDays: 2 }) as never, ctx);
    assert.deepEqual(kicked, ["Account is too new"]);
    assert.deepEqual(given, []);
  });

  test("is held, not removed, when the account is too new and that is the choice", async () => {
    await events.memberJoin!(member({ ageDays: 2 }) as never, context({ ...stored, newMembers: { minAccountAge: "7d", youngAction: "hold" } }));
    assert.deepEqual(kicked, []);
    assert.deepEqual(given, [UNVERIFIED]);
  });

  test("is not given a role above the bot's own", async () => {
    await events.memberJoin!(member() as never, context(stored, member(), 9));
    assert.deepEqual(given, []);
  });
});

describe("a member leaving", () => {
  test("cancels the timer", async () => {
    await events.memberLeave!(member() as never, context({ roles: { verified: ROLE } }));
    assert.deepEqual(cancelled, [{ kind: "kickUnverified", match: { userId: USER } }]);
  });
});

describe("the timeout", () => {
  const tasks = verification.tasks!;
  const stored = { roles: { verified: ROLE }, newMembers: { timeoutAction: "kick", timeout: "1h" } };

  test("removes a member who is still unverified", async () => {
    await tasks.kickUnverified!({ userId: USER }, context(stored));
    assert.deepEqual(kicked, ["Did not verify in time"]);
  });

  test("spares one who verified in the meantime", async () => {
    await tasks.kickUnverified!({ userId: USER }, context(stored, member({ holds: [ROLE] })));
    assert.deepEqual(kicked, []);
  });

  test("does nothing once the wait has been switched off", async () => {
    await tasks.kickUnverified!({ userId: USER }, context({ roles: { verified: ROLE } }));
    assert.deepEqual(kicked, []);
  });

  test("tells the member why first, when asked to", async () => {
    await tasks.kickUnverified!({ userId: USER }, context({ ...stored, newMembers: { ...stored.newMembers, sendDm: true } }));
    assert.deepEqual(sent, ["Did not verify in time"]);
    assert.equal(kicked.length, 1);
  });
});

describe("a moderator giving the verified role by hand", () => {
  test("takes the unverified role off and stops the timer", async () => {
    const holder = member({ holds: [ROLE, UNVERIFIED] });
    await events.memberUpdate!(member() as never, holder as never, context({ roles: { verified: ROLE, unverified: UNVERIFIED } }));
    assert.deepEqual(removed, [UNVERIFIED]);
    assert.equal(cancelled[0]?.kind, "kickUnverified");
  });
});

describe("where members verify", () => {
  const where = (stored: unknown): string[] => (settingsFor(stored) as unknown as { post: { where: string[] } }).post.where;

  test("is a direct message unless chosen otherwise", () => {
    assert.deepEqual(where({}), ["dm"]);
    assert.deepEqual(where({ post: {} }), ["dm"]);
  });

  test("can be a direct message, or both", () => {
    assert.deepEqual(where({ post: { where: ["dm"] } }), ["dm"]);
    assert.deepEqual(where({ post: { where: ["channel", "dm"] } }), ["channel", "dm"]);
  });

  test("cannot be empty", () => {
    assert.equal(registry.resolveSettings("verification", { post: { where: [] } }).ok, false);
  });
});

describe("the captcha", () => {
  const check = (stored: unknown) =>
    (settingsFor(stored) as unknown as { check: { method: string; rounds: number; roundTypes: string[] } }).check;

  test("starts as three rounds from every kind", () => {
    const { rounds, roundTypes } = check({ check: { method: "captcha" } });
    assert.equal(rounds, 3);
    assert.deepEqual([...roundTypes].sort(), ["belong", "block", "count", "odd", "order", "pictures", "typed"]);
  });

  test("takes a smaller pool, but not an empty one", () => {
    assert.deepEqual(check({ check: { roundTypes: ["count"] } }).roundTypes, ["count"]);
    assert.equal(registry.resolveSettings("verification", { check: { roundTypes: [] } }).ok, false);
  });

  test("replaces the code that settings saved earlier may still name", () => {
    assert.equal(check({ check: { method: "code" } }).method, "captcha");
  });
});
