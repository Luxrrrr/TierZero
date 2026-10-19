import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { findMembers, parseQuery, rankName, resetMemberFetches, squash } from "../dist/control/mod/member-find.js";

interface Fake {
  id: string;
  username: string;
  globalName?: string | null;
  nickname?: string | null;
  bot?: boolean;
}

const member = (f: Fake) => ({
  id: f.id,
  nickname: f.nickname ?? null,
  displayName: f.nickname ?? f.globalName ?? f.username,
  displayAvatarURL: () => `https://cdn.example/${f.id}.png`,
  user: { username: f.username, globalName: f.globalName ?? null, bot: f.bot ?? false },
});

let nextId = 100000000000000000n;
const person = (username: string, rest: Partial<Fake> = {}): Fake => ({ id: String(nextId++), username, ...rest });

function world(people: Fake[], options: { memberCount?: number; discord?: Fake[]; fullList?: Fake[]; searchNever?: boolean } = {}) {
  const cache = new Map(people.map((p) => [p.id, member(p)]));
  const calls = { search: 0, fetchAll: 0 };
  const guild = {
    id: "900000000000000001",
    memberCount: options.memberCount ?? people.length,
    members: {
      cache,
      search: ({ query }: { query: string }) => {
        calls.search++;
        if (options.searchNever) return new Promise(() => undefined);
        const q = query.toLowerCase();
        const found = (options.discord ?? []).filter((p) => p.username.toLowerCase().startsWith(q)).map(member);
        return Promise.resolve(new Map(found.map((m) => [m.id, m])));
      },
      fetch: (arg?: unknown) => {
        if (typeof arg === "string") return Promise.resolve(cache.get(arg) ?? null);
        calls.fetchAll++;
        for (const p of options.fullList ?? []) cache.set(p.id, member(p));
        return Promise.resolve(cache);
      },
    },
  };
  return { guild: guild as never, calls, cache };
}

const names = (result: { hits: { user: { name: string | null } }[] }) => result.hits.map((hit) => hit.user.name);

beforeEach(() => resetMemberFetches());

describe("name matching", () => {
  test("folds case, accents, spaces and underscores", () => {
    assert.equal(squash("Zoë_Smith Jr"), "zoesmithjr");
  });

  test("ranks exact, then starts with, then a word starts with, then contains", () => {
    assert.equal(rankName("Lux", "lux"), 0);
    assert.equal(rankName("LuxTester", "lux"), 1);
    assert.equal(rankName("the_lux_boss", "lux"), 2);
    assert.equal(rankName("LuxTester", "test"), 3);
    assert.equal(rankName("LuxTester", "zzz"), null);
    assert.equal(rankName("Lux", ""), null);
  });

  test("reads an id, a mention, @name and name#tag", () => {
    assert.deepEqual(parseQuery("<@123456789012345678>"), { needle: "", id: "123456789012345678" });
    assert.deepEqual(parseQuery("<@!123456789012345678>"), { needle: "", id: "123456789012345678" });
    assert.deepEqual(parseQuery("123456789012345678"), { needle: "123456789012345678", id: "123456789012345678" });
    assert.deepEqual(parseQuery("@Lux Tester#1234"), { needle: "luxtester", id: null });
  });
});

describe("findMembers", () => {
  test("finds a name in the middle, which Discord's own search would miss", async () => {
    const { guild } = world([person("LuxTester"), person("Grace")]);
    assert.deepEqual(names(await findMembers(guild, "tester")), ["LuxTester"]);
    assert.deepEqual(names(await findMembers(guild, "test")), ["LuxTester"]);
    assert.deepEqual(names(await findMembers(guild, "lux")), ["LuxTester"]);
  });

  test("matches the display name and the nickname as well as the username", async () => {
    const { guild } = world([
      person("ada", { globalName: "Countess Lovelace" }),
      person("linus", { nickname: "Penguin Boss" }),
      person("noone"),
    ]);
    assert.deepEqual(names(await findMembers(guild, "lovelace")), ["Countess Lovelace"]);
    assert.deepEqual(names(await findMembers(guild, "penguin")), ["Penguin Boss"]);
    assert.deepEqual(names(await findMembers(guild, "linus")), ["Penguin Boss"]);
  });

  test("ignores spaces, underscores, accents and case in the search", async () => {
    const { guild } = world([person("zoe_smith", { globalName: "Zoë Smith" })]);
    assert.equal((await findMembers(guild, "ZOE SMITH")).hits.length, 1);
    assert.equal((await findMembers(guild, "zoesm")).hits.length, 1);
    assert.equal((await findMembers(guild, "e_s")).hits.length, 1);
  });

  test("puts the best match first", async () => {
    const { guild } = world([person("xxluxxx"), person("the_lux"), person("luxury"), person("lux")]);
    assert.deepEqual(names(await findMembers(guild, "lux")), ["lux", "luxury", "the_lux", "xxluxxx"]);
  });

  test("finds a member by pasted id, mention and username#tag", async () => {
    const target = person("Mallory");
    const { guild } = world([target, person("Other")]);
    assert.deepEqual(names(await findMembers(guild, target.id)), ["Mallory"]);
    assert.deepEqual(names(await findMembers(guild, `<@${target.id}>`)), ["Mallory"]);
    assert.deepEqual(names(await findMembers(guild, "Mallory#0042")), ["Mallory"]);
    assert.deepEqual(names(await findMembers(guild, "@mallory")), ["Mallory"]);
  });

  test("leaves bots out unless the caller allows them", async () => {
    const { guild } = world([person("helperbot", { bot: true }), person("helper")]);
    assert.deepEqual(names(await findMembers(guild, "helper")), ["helper"]);
    assert.equal((await findMembers(guild, "helper", { allowBots: true })).hits.length, 2);
  });

  test("returns at most 25 and says how many more there are", async () => {
    const { guild } = world(Array.from({ length: 40 }, (_, i) => person(`player${String(i).padStart(2, "0")}`)));
    const result = await findMembers(guild, "player");
    assert.equal(result.hits.length, 25);
    assert.equal(result.more, 15);
  });

  test("an empty or whitespace search finds nothing", async () => {
    const { guild } = world([person("a")]);
    assert.deepEqual(await findMembers(guild, "  "), { hits: [], more: 0 });
  });

  test("hits carry the display name and the username", async () => {
    const { guild } = world([person("luxtester", { globalName: "Lux" })]);
    const [hit] = (await findMembers(guild, "lux")).hits;
    assert.equal(hit?.user.name, "Lux");
    assert.equal(hit?.username, "luxtester");
    assert.equal(hit?.user.inServer, true);
  });

  test("is quick from a complete cache and does not ask Discord", async () => {
    const { guild, calls } = world(Array.from({ length: 5000 }, (_, i) => person(`member${i}`)));
    const started = performance.now();
    const result = await findMembers(guild, "ber49");
    const took = performance.now() - started;
    assert.ok(result.hits.length > 0);
    assert.ok(took < 150, `took ${took}ms`);
    assert.deepEqual(calls, { search: 0, fetchAll: 0 });
  });
});

describe("a cache that holds part of the server", () => {
  test("merges Discord's prefix search with the cache", async () => {
    const cached = person("cachedtester");
    const remote = person("testerfar");
    const { guild, calls } = world([cached], { memberCount: 1000, discord: [remote] });
    const result = await findMembers(guild, "tester");
    assert.deepEqual(names(result).sort(), ["cachedtester", "testerfar"]);
    assert.equal(calls.search, 1);
  });

  test("fetches the whole member list once, then searches it", async () => {
    const full = [person("alpha"), person("betatester"), person("gamma")];
    const { guild, calls } = world([person("alpha")], { memberCount: 3, fullList: full });
    assert.deepEqual(names(await findMembers(guild, "tester")), ["betatester"]);
    assert.equal(calls.fetchAll, 1);
  });

  test("does not fetch the list again within ten minutes, but may after", async () => {
    const { guild, calls } = world([person("alpha")], { memberCount: 1000 });
    const start = 1_000_000;
    await findMembers(guild, "al", { now: start });
    await findMembers(guild, "al", { now: start + 9 * 60_000 });
    assert.equal(calls.fetchAll, 1);
    await findMembers(guild, "al", { now: start + 10 * 60_000 + 1 });
    assert.equal(calls.fetchAll, 2);
  });

  test("answers from the cache when Discord does not reply in time", async () => {
    const { guild } = world([person("cachedtester")], { memberCount: 1000, searchNever: true });
    const result = await findMembers(guild, "tester");
    assert.deepEqual(names(result), ["cachedtester"]);
  });
});
