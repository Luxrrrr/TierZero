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

function member(options: { bot?: boolean; holds?: string[]; ageDays?: number; id?: string; name?: string; avatar?: string | null; ageHours?: number } = {}) {
  const held = new Set(options.holds ?? []);
  return {
    id: options.id ?? USER,
    kickable: true,
    user: {
      id: options.id ?? USER,
      username: options.name ?? "pixelpilot",
      bot: options.bot ?? false,
      avatar: options.avatar === undefined ? "hash" : options.avatar,
      createdTimestamp: Date.now() - (options.ageHours !== undefined ? options.ageHours * 3_600_000 : (options.ageDays ?? 400) * DAY),
    },
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

describe("raid-looking members", () => {
  const stored = (suspicious: string, method = "captcha", difficulty = "auto") => ({
    roles: { verified: ROLE, unverified: UNVERIFIED },
    check: { method, difficulty, suspicious },
  });
  const raider = (n: number) => member({ id: String(623456789012345600n + BigInt(n)), name: `grabber${n}zz`, avatar: null, ageHours: 3 });

  test("are removed once they join in a batch of new accounts, where that is the choice", async () => {
    for (let n = 1; n <= 8; n++) await events.memberJoin!(raider(n) as never, context(stored("remove"), raider(n)));
    assert.ok(kicked.length >= 5, `${kicked.length} removed`);
    assert.ok(kicked.every((reason) => reason === "Looked like part of a raid"));
  });

  test("are only given the hardest captcha when that is the choice", async () => {
    for (let n = 11; n <= 18; n++) await events.memberJoin!(raider(n) as never, context(stored("challenge"), raider(n)));
    assert.deepEqual(kicked, []);
    assert.equal(given.length, 8);
  });

  test("are left alone when the captcha is chosen by hand, whatever they look like", async () => {
    for (let n = 21; n <= 28; n++) await events.memberJoin!(raider(n) as never, context(stored("remove", "captcha", "manual"), raider(n)));
    assert.deepEqual(kicked, []);
  });

  test("are left alone when the check is not a captcha", async () => {
    for (let n = 31; n <= 38; n++) await events.memberJoin!(raider(n) as never, context(stored("remove", "button"), raider(n)));
    assert.deepEqual(kicked, []);
  });

  test("an ordinary member among them is not removed", async () => {
    for (let n = 41; n <= 48; n++) await events.memberJoin!(raider(n) as never, context(stored("remove"), raider(n)));
    kicked.length = 0;
    await events.memberJoin!(member({ id: "723456789012345678", name: "Ada", ageDays: 900 }) as never, context(stored("remove")));
    assert.deepEqual(kicked, []);
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

describe("the captcha settings", () => {
  const check = (stored: unknown) =>
    (settingsFor(stored) as unknown as { check: { difficulty: string; rounds: number; suspicious: string } }).check;

  test("start as automatic, with two rounds, and a hard captcha for a member who looks like a raid", () => {
    assert.deepEqual(
      (({ difficulty, rounds, suspicious }) => ({ difficulty, rounds, suspicious }))(check({})),
      { difficulty: "auto", rounds: 2, suspicious: "challenge" },
    );
  });

  test("take removal and a hand-picked captcha", () => {
    assert.equal(check({ check: { suspicious: "remove" } }).suspicious, "remove");
    assert.equal(check({ check: { difficulty: "manual" } }).difficulty, "manual");
    assert.equal(registry.resolveSettings("verification", { check: { difficulty: "hard" } }).ok, false);
  });
});

describe("the captcha", () => {
  const check = (stored: unknown) =>
    (settingsFor(stored) as unknown as { check: { method: string; rounds: number; roundTypes: string[] } }).check;

  test("starts with the kinds of round that need no animation", () => {
    const { roundTypes } = check({ check: { method: "captcha" } });
    assert.deepEqual([...roundTypes].sort(), ["block", "colour", "text", "tiles"]);
  });

  test("takes a smaller pool, but not an empty one", () => {
    assert.deepEqual(check({ check: { roundTypes: ["block"] } }).roundTypes, ["block"]);
    assert.equal(registry.resolveSettings("verification", { check: { roundTypes: [] } }).ok, false);
  });

  test("replaces the code that settings saved earlier may still name", () => {
    assert.equal(check({ check: { method: "code" } }).method, "captcha");
  });

  test("drops the kinds of round that have gone, and falls back when none is left", () => {
    assert.deepEqual(check({ check: { roundTypes: ["pictures", "count", "block"] } }).roundTypes, ["block"]);
    assert.deepEqual(check({ check: { roundTypes: ["pictures", "typed"] } }).roundTypes, ["text", "colour", "tiles", "block"]);
  });
});

describe("pressing the verify button for a captcha", () => {
  const components = verification.components!;
  const GUILD = "523456789012345678";

  function press(stored: unknown, target = member()) {
    const replies: { body: unknown; options: { files?: unknown[] } }[] = [];
    const edits: { components?: { toJSON(): { components: { custom_id: string }[] } }[] }[] = [];
    const modals: unknown[] = [];
    const base = context(stored, target) as unknown as Record<string, unknown>;
    const ctx = {
      ...base,
      reply: async (_interaction: unknown, body: unknown, _values: unknown, options: { files?: unknown[] }) => {
        replies.push({ body, options });
        return true;
      },
    } as never;
    const interaction = {
      user: { id: target.id },
      isButton: () => true,
      deferReply: async () => {},
      deferUpdate: async () => {},
      editReply: async (payload: (typeof edits)[number]) => {
        edits.push(payload);
      },
      showModal: async (modal: unknown) => {
        modals.push(modal);
      },
    } as never;
    return { ctx, interaction, replies, edits, modals };
  }

  const captcha = (types: string[]) => ({
    roles: { verified: ROLE },
    check: { method: "captcha", difficulty: "manual", roundTypes: types, rounds: 1 },
  });

  test("sends the picture with the round, and a button that names the round", async () => {
    const { ctx, interaction, replies, edits } = press(captcha(["text"]));
    await components.start!(interaction, { ctx, rest: "" } as never);
    assert.equal(replies.length, 1);
    assert.equal(replies[0]!.options.files?.length, 1);
    const button = edits[0]!.components![0]!.toJSON().components[0]!;
    assert.match(button.custom_id, new RegExp(`^verification:enter:${GUILD}:[0-9a-f]{12}$`));
  });

  test("sends a moving picture for a moving round", async () => {
    const { ctx, interaction, replies } = press(captcha(["motion"]));
    await components.start!(interaction, { ctx, rest: "" } as never);
    const [file] = replies[0]!.options.files as { name: string }[];
    assert.equal(file?.name, "captcha.gif");
  });

  test("sends no picture for the code in squares, but still an empty list so an old picture comes off", async () => {
    const { ctx, interaction, replies } = press(captcha(["block"]));
    await components.start!(interaction, { ctx, rest: "" } as never);
    assert.deepEqual(replies[0]!.options.files, []);
  });

  type Row = { toJSON(): { components: { custom_id: string; label: string; style: number }[] } };
  const buttonsOf = (edit: { components?: Row[] } | undefined) => (edit?.components ?? []).map((row) => row.toJSON().components);

  test("sends nine numbered buttons and Done for a round of squares, with the picture", async () => {
    const { ctx, interaction, replies, edits } = press(captcha(["tiles"]));
    await components.start!(interaction, { ctx, rest: "" } as never);
    const [file] = replies[0]!.options.files as { name: string }[];
    assert.equal(file?.name, "captcha.png");
    const rows = buttonsOf(edits[0]);
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.slice(0, 3).flat().map((button) => button.label), ["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    assert.equal(rows[3]!.length, 1);
    assert.equal(rows[3]![0]!.label, "Done");
    assert.match(rows[3]![0]!.custom_id, new RegExp(`^verification:done:${GUILD}:[0-9a-f]{12}$`));
    assert.match(rows[0]![0]!.custom_id, new RegExp(`^verification:pick:${GUILD}:[0-9a-f]{12}:1$`));
  });

  test("shows a pressed square as pressed, and takes it back when pressed again", async () => {
    const { ctx, interaction, edits } = press(captcha(["tiles"]));
    await components.start!(interaction, { ctx, rest: "" } as never);
    const first = buttonsOf(edits[0])[0]![1]!;
    const rest = first.custom_id.split(":").slice(2).join(":");
    await components.pick!(interaction, { ctx, rest } as never);
    const pressed = buttonsOf(edits.at(-1))[0]![1]!;
    assert.notEqual(pressed.style, first.style);
    await components.pick!(interaction, { ctx, rest } as never);
    assert.equal(buttonsOf(edits.at(-1))[0]![1]!.style, first.style);
  });

  test("ignores a press from an old message", async () => {
    const { ctx, interaction, edits, replies } = press(captcha(["tiles"]));
    await components.start!(interaction, { ctx, rest: "" } as never);
    const before = edits.length;
    await components.pick!(interaction, { ctx, rest: `${GUILD}:stale:2` } as never);
    assert.equal(edits.length, before);
    assert.equal(replies.at(-1)!.body, (ctx as unknown as { settings: { replies: Record<string, unknown> } }).settings.replies.codeExpired);
  });

  test("counts Done pressed at once as a miss, whatever was pressed", async () => {
    const { ctx, interaction, edits, replies } = press(captcha(["tiles"]));
    await components.start!(interaction, { ctx, rest: "" } as never);
    const done = buttonsOf(edits[0])[3]![0]!;
    await components.done!(interaction, { ctx, rest: done.custom_id.split(":").slice(2).join(":") } as never);
    assert.equal(replies.at(-1)!.body, (ctx as unknown as { settings: { replies: Record<string, unknown> } }).settings.replies.wrongAnswer);
  });

  test("opens the box to answer in from the button on the round, but not from a button for another round", async () => {
    const { ctx, interaction, edits } = press(captcha(["text"]));
    await components.start!(interaction, { ctx, rest: "" } as never);
    const id = edits[0]!.components![0]!.toJSON().components[0]!.custom_id;
    const nonce = id.split(":")[3];

    const modals: unknown[] = [];
    const live = { ...(interaction as object), showModal: async (modal: unknown) => void modals.push(modal) } as never;
    await components.enter!(live, { ctx, rest: `${GUILD}:${nonce}` } as never);
    assert.equal(modals.length, 1);
    await components.enter!(live, { ctx, rest: `${GUILD}:stale` } as never);
    assert.equal(modals.length, 1);
  });
});
