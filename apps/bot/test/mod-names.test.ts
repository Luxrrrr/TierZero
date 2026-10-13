import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { refOf, resolveUsers, withinBudget } from "../dist/control/mod/names.js";

const never = () => new Promise<never>(() => undefined);

function stubs(fetchMember: (id: string) => Promise<unknown>) {
  const calls: string[] = [];
  const guild = {
    id: "900000000000000000",
    members: {
      cache: new Map(),
      fetch: (id: string) => {
        calls.push(id);
        return fetchMember(id);
      },
    },
  };
  const client = { users: { cache: new Map(), fetch: never } };
  return { guild: guild as any, client: client as any, calls };
}

const member = (id: string) => ({ displayName: `n${id}`, displayAvatarURL: () => "x" });

describe("resolveUsers", () => {
  test("answers within the batch budget even when Discord never replies", async () => {
    const { guild, client } = stubs(never);
    const started = Date.now();
    const refs = await resolveUsers(client, guild, ["100000000000000001", "100000000000000002"]);
    const took = Date.now() - started;
    assert.ok(took < 2200, `took ${took}ms`);
    assert.equal(refs.size, 0);
    assert.equal(refOf(refs, "100000000000000001").name, null);
  });

  test("resolves known ids immediately and ignores ones that are not snowflakes", async () => {
    const { guild, client, calls } = stubs(async (id) => member(id));
    const refs = await resolveUsers(client, guild, ["110000000000000001", "not-an-id"]);
    assert.equal(refs.get("110000000000000001")?.name, "n110000000000000001");
    assert.equal(refs.size, 1);
    assert.deepEqual(calls, ["110000000000000001"]);
  });

  test("maxFetches caps how many new lookups a call starts", async () => {
    const { guild, client, calls } = stubs(async (id) => member(id));
    const ids = ["120000000000000001", "120000000000000002", "120000000000000003", "120000000000000004"];
    const refs = await resolveUsers(client, guild, ids, { maxFetches: 2 });
    assert.equal(calls.length, 2);
    assert.equal(refs.size, 2);

    // The ones already answered are remembered, so they do not count against a later allowance.
    const again = await resolveUsers(client, guild, ids, { maxFetches: 2 });
    assert.equal(again.size, 4);
    assert.equal(calls.length, 4);
  });
});

describe("the bot's own account", () => {
  const BOT = "130000000000000001";
  const withBot = () => {
    const { guild, client, calls } = stubs(async (id) => member(id));
    client.user = { id: BOT };
    return { guild, client, calls };
  };

  test("is Automod, with no avatar, and costs no lookup", async () => {
    const { guild, client, calls } = withBot();
    const refs = await resolveUsers(client, guild, [BOT, "130000000000000002"]);
    assert.deepEqual(refs.get(BOT), { userId: BOT, name: "Automod", avatarUrl: null, inServer: true, automod: true });
    assert.deepEqual(calls, ["130000000000000002"]);
    assert.equal(refs.get("130000000000000002")?.automod, undefined);
  });

  test("stays itself when the question is who wrote a message", async () => {
    const { guild, client } = withBot();
    const refs = await resolveUsers(client, guild, [BOT], { keepBotAccount: true });
    assert.equal(refs.get(BOT)?.name, `n${BOT}`);
    assert.equal(refs.get(BOT)?.automod, undefined);
  });
});

describe("withinBudget", () => {
  test("returns the work when it is quick", async () => {
    assert.equal(await withinBudget(Promise.resolve(5), 0), 5);
  });

  test("returns the fallback when the work is slow or fails", async () => {
    const started = Date.now();
    assert.equal(await withinBudget(never() as Promise<number>, -1), -1);
    assert.ok(Date.now() - started < 2200);
    assert.equal(await withinBudget(Promise.reject(new Error("no")), -2), -2);
  });
});

describe("resolveUsers lookup allowance", () => {
  test("starts no more fresh lookups than maxFetches in one call", async () => {
    const { guild, client, calls } = stubs(never);
    const ids = Array.from({ length: 300 }, (_, i) => `3000000000000${String(10000 + i)}`);
    await resolveUsers(client, guild, ids, { maxFetches: 100 });
    assert.equal(calls.length, 100);
  });

  test("ids the library already caches do not use up the allowance", async () => {
    const { guild, client, calls } = stubs(never);
    const cached = Array.from({ length: 5 }, (_, i) => `4000000000000${String(10000 + i)}`);
    for (const id of cached) guild.members.cache.set(id, member(id));
    const fresh = Array.from({ length: 3 }, (_, i) => `4100000000000${String(10000 + i)}`);
    await resolveUsers(client, guild, [...cached, ...fresh], { maxFetches: 3 });
    assert.equal(calls.length, 3);
  });
});
