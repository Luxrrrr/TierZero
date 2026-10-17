import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, type MessageBody } from "@tier0/core";
import { createTestDatabase } from "./db-helper.ts";

const GUILD = "100000000000000031";
const CHANNEL = "123456789012345679";
const ROLE = "223456789012345679";
const MESSAGE = "323456789012345679";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { default: roles } = await import("../dist/index.js");
const { computeChange, menuSnapshot } = await import("../dist/menus.js");
const { parseMapping, serializeMapping } = await import("../dist/mapping.js");
const { ALREADY_HAD_MESSAGE, DID_NOT_HAVE_MESSAGE, GAVE_MESSAGE } = await import("../dist/messages.js");

const registry = new ModuleRegistry();
registry.register(roles);

const rules = (current: string[], mode?: "toggle" | "give" | "take", exclusive = false) => ({
  current,
  menuRoles: ["r1", "r2"],
  exclusive,
  ...(mode ? { mode } : {}),
});

describe("what picking does in each mode", () => {
  test("a menu that only gives never takes the picked role back", () => {
    assert.deepEqual(computeChange(["r1"], rules(["r1"], "give")), { ok: true, toAdd: [], toRemove: [] });
    assert.deepEqual(computeChange(["r1"], rules([], "give")), { ok: true, toAdd: ["r1"], toRemove: [] });
  });

  test("an exclusive menu that only gives still swaps the others out", () => {
    assert.deepEqual(computeChange(["r1"], rules(["r2"], "give", true)), { ok: true, toAdd: ["r1"], toRemove: ["r2"] });
  });

  test("a menu that only takes away never gives", () => {
    assert.deepEqual(computeChange(["r1"], rules([], "take")), { ok: true, toAdd: [], toRemove: [] });
    assert.deepEqual(computeChange(["r1"], rules(["r1"], "take")), { ok: true, toAdd: [], toRemove: ["r1"] });
  });

  test("toggling is what a menu without a mode does", () => {
    assert.deepEqual(computeChange(["r1"], rules(["r1"])), computeChange(["r1"], rules(["r1"], "toggle")));
  });
});

describe("a menu posted before modes", () => {
  const menu = { name: "Platforms", channel: "1", options: [] };

  test("does not read as changed since posting", () => {
    assert.equal(menuSnapshot({ ...menu, mode: "toggle" }), menuSnapshot(menu));
    assert.notEqual(menuSnapshot({ ...menu, mode: "give" }), menuSnapshot(menu));
  });

  test("keeps toggling, and a posted mode survives a round trip", () => {
    assert.equal(parseMapping(serializeMapping({ name: "x", exclusive: false, options: [] })).mode, undefined);
    assert.equal(parseMapping(serializeMapping({ name: "x", exclusive: false, mode: "give", options: [] })).mode, "give");
    assert.equal(parseMapping(JSON.stringify({ name: "x", exclusive: false, mode: "drop", options: [] })).mode, undefined);
  });

  test("starts every menu toggling", () => {
    const result = registry.resolveSettings("roles", { menus: [{ ...menu, channel: CHANNEL, options: [{ label: "Gamer", role: ROLE }] }] });
    assert.ok(result.ok);
    assert.equal((result.value as { menus: { mode: string }[] }).menus[0]?.mode, "toggle");
  });
});

describe("pressing a button", () => {
  let told: { body: MessageBody; fallback?: MessageBody }[];
  const changed: string[] = [];

  function context(held: boolean) {
    const resolved = registry.resolveSettings("roles", {});
    assert.ok(resolved.ok);
    return {
      settings: resolved.value,
      guild: {
        id: GUILD,
        roles: { cache: { get: (id: string) => (id === ROLE ? { id, name: "Verified", position: 1 } : undefined) } },
        members: {
          me: { roles: { highest: { position: 5 } } },
          fetch: async () => ({
            roles: {
              cache: { has: () => held },
              add: async (id: string) => void changed.push(`+${id}`),
              remove: async (id: string) => void changed.push(`-${id}`),
            },
          }),
        },
      },
      reply: async (_i: unknown, body: MessageBody, _v: unknown, options?: { fallback?: MessageBody }) => {
        told.push({ body, fallback: options?.fallback });
        return true;
      },
    } as never;
  }

  const button = () => ({ isButton: () => true, message: { id: MESSAGE }, user: { id: "400000000000000031" } }) as never;

  async function post(mode: "give" | "take") {
    await prisma.reactionRoleMenu.create({
      data: {
        guildId: GUILD,
        channelId: CHANNEL,
        messageId: MESSAGE,
        mapping: serializeMapping({ name: "Rules", exclusive: false, mode, options: [{ role: ROLE, label: "I agree" }] }),
      },
    });
  }

  before(async () => {
    await prisma.guild.create({ data: { id: GUILD, name: "Role modes test guild" } });
  });

  after(async () => {
    await prisma.$disconnect();
    db.cleanup();
  });

  beforeEach(async () => {
    told = [];
    changed.length = 0;
    await prisma.reactionRoleMenu.deleteMany();
  });

  test("on a menu that only gives, says the member has it already instead of taking it", async () => {
    await post("give");
    await roles.components!.toggle!(button(), { rest: ROLE, ctx: context(true) });
    assert.deepEqual(changed, []);
    assert.deepEqual(told[0]?.fallback, ALREADY_HAD_MESSAGE);

    await roles.components!.toggle!(button(), { rest: ROLE, ctx: context(false) });
    assert.deepEqual(changed, [`+${ROLE}`]);
    assert.deepEqual(told[1]?.fallback, GAVE_MESSAGE);
  });

  test("on a menu that only takes away, says there was nothing to remove", async () => {
    await post("take");
    await roles.components!.toggle!(button(), { rest: ROLE, ctx: context(false) });
    assert.deepEqual(changed, []);
    assert.deepEqual(told[0]?.fallback, DID_NOT_HAVE_MESSAGE);
  });
});
