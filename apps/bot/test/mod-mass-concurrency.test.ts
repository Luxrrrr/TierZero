import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "../../../packages/modules/moderation/test/db-helper.ts";

const GUILD = "100000000000000120";
const OWNER = "100000000000000121";
const BOT = "100000000000000122";
const TARGETS = ["100000000000000131", "100000000000000132", "100000000000000133"];
const OTHER = "100000000000000134";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { massPreview, massRun, massToken } = await import("../dist/control/mod/raid.js");

function member(id: string) {
  return {
    id,
    displayName: id,
    displayAvatarURL: () => "",
    joinedAt: new Date("2026-10-10T00:00:00Z"),
    user: { createdAt: new Date("2026-10-09T00:00:00Z") },
    roles: { highest: { position: 1 } },
    bannable: true,
    kickable: true,
  };
}

let bulkCalls = 0;
let fetchDelay = 0;

const known = new Map([...TARGETS, OTHER, OWNER].map((id) => [id, member(id)]));

const ctx = {
  client: { user: { id: BOT }, users: { cache: new Map(), fetch: async () => null } },
  guild: {
    id: GUILD,
    ownerId: "999999999999999999",
    members: {
      cache: known,
      fetch: async (query: string | { user: string[] }) => {
        if (fetchDelay) await new Promise((resolve) => setTimeout(resolve, fetchDelay));
        if (typeof query === "string") return known.get(query) ?? null;
        return new Map(query.user.flatMap((id) => (known.has(id) ? [[id, known.get(id)]] : [])));
      },
    },
    bans: {
      bulkCreate: async (ids: string[]) => {
        bulkCalls += 1;
        return { bannedUsers: ids, failedUsers: [] };
      },
    },
  },
} as never;

const state = {
  isEnabled: async () => true,
  context: async () => ({ tasks: { cancel: async () => 0 }, settings: {} }),
} as never;

const actor = { userId: OWNER, name: "Owner", role: "owner" as const };
const body = (ids: string[]) => ({ action: "ban", ids, reason: "raid", deleteDays: 0 });

describe("mass action confirmation and concurrency", () => {
  before(async () => {
    await prisma.guild.create({ data: { id: GUILD, name: "Mass action test guild" } });
  });
  after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await prisma.$disconnect();
    db.cleanup();
  });

  test("two confirmations arriving together start one job", async () => {
    fetchDelay = 20;
    const preview = await massPreview(ctx, state, actor, body(TARGETS));
    assert.equal(preview.status, 200);
    const shown = preview.body as { count: number; token: string };
    const payload = { ...body(TARGETS), confirm: shown.count, token: shown.token };
    const [first, second] = await Promise.all([massRun(ctx, state, actor, payload), massRun(ctx, state, actor, payload)]);
    assert.deepEqual([first.status, second.status].sort(), [200, 409]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(bulkCalls, 1);
  });

  test("a different set of the same size is refused and releases the slot", async () => {
    fetchDelay = 0;
    const preview = await massPreview(ctx, state, actor, body(TARGETS));
    const shown = preview.body as { count: number; token: string };
    const swapped = [TARGETS[0], TARGETS[1], OTHER];
    const refused = await massRun(ctx, state, actor, { ...body(swapped), confirm: shown.count, token: shown.token });
    assert.equal(refused.status, 409);
    const missing = await massRun(ctx, state, actor, { ...body(TARGETS), confirm: shown.count });
    assert.equal(missing.status, 409);
    const accepted = await massRun(ctx, state, actor, { ...body(TARGETS), confirm: shown.count, token: shown.token });
    assert.equal(accepted.status, 200);
  });
});

describe("massToken", () => {
  test("ignores order and changes with the set, the action or the window", () => {
    const base = massToken("ban", ["1", "2", "3"], null, null);
    assert.equal(massToken("ban", ["3", "1", "2"], null, null), base);
    assert.notEqual(massToken("ban", ["1", "2", "4"], null, null), base);
    assert.notEqual(massToken("kick", ["1", "2", "3"], null, null), base);
    assert.notEqual(massToken("ban", ["1", "2", "3"], "2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z"), base);
  });
});
