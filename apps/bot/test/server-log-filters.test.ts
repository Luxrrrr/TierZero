import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { serverLogWhere } from "../dist/control/mod/server-log-filters.js";

const GUILD = "100000000000000001";
const ID = "200000000000000002";

const clauses = (query: string, readable: string[] | null = null, withCategory = true) =>
  (serverLogWhere(GUILD, new URLSearchParams(query), readable, withCategory).AND ?? []) as Record<string, unknown>[];

describe("serverLogWhere", () => {
  test("always stays inside the server", () => {
    assert.equal(serverLogWhere(GUILD, new URLSearchParams(), null).guildId, GUILD);
  });

  test("a search looks at names, channels, summaries and what was said", () => {
    const [clause] = clauses("q=refund");
    const or = (clause as { OR: unknown[] }).OR;
    assert.equal(or.length, 5);
    assert.deepEqual(or[4], { details: { contains: "refund" } });
  });

  test("categories and types are lists, and unknown ones are dropped", () => {
    assert.deepEqual(clauses("category=members,voice,nonsense"), [{ category: { in: ["members", "voice"] } }]);
    assert.deepEqual(clauses("type=member.join,nope"), [{ type: { in: ["member.join"] } }]);
    assert.deepEqual(clauses("category=nonsense"), []);
  });

  test("the category filter can be left out, to count each category under the rest", () => {
    assert.deepEqual(clauses("category=members", null, false), []);
  });

  test("a member id matches who did it or who it happened to, and a name matches either name", () => {
    assert.deepEqual(clauses(`member=${ID}`), [{ OR: [{ actorId: ID }, { targetId: ID }] }]);
    assert.deepEqual(clauses("member=sam"), [{ OR: [{ actorName: { contains: "sam" } }, { targetName: { contains: "sam" } }] }]);
  });

  test("a viewer gets entries with no channel, and only the channels they can read", () => {
    assert.deepEqual(clauses("", [ID]), [{ OR: [{ channelId: null }, { channelId: { in: [ID] } }] }]);
    assert.deepEqual(clauses("", null), []);
  });

  test("a date range becomes bounds and a bad date is ignored", () => {
    const [range] = clauses("since=2026-10-01T00:00:00.000Z&until=2026-10-02T00:00:00.000Z");
    assert.ok((range!.at as { gte: Date }).gte instanceof Date);
    assert.deepEqual(clauses("since=nope"), []);
  });
});
