import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { messageLogWhere, parseLogState } from "../dist/control/mod/message-filters.js";

const GUILD = "100000000000000001";
const ID = "200000000000000002";

const clauses = (query: string, readable: string[] | null = null) =>
  (messageLogWhere(GUILD, new URLSearchParams(query), readable).AND ?? []) as Record<string, unknown>[];

describe("messageLogWhere", () => {
  test("always stays inside the server", () => {
    assert.equal(messageLogWhere(GUILD, new URLSearchParams(), null).guildId, GUILD);
  });

  test("a search looks at earlier versions too", () => {
    const [clause] = clauses("q=refund");
    assert.deepEqual(clause, { OR: [{ content: { contains: "refund" } }, { edits: { some: { content: { contains: "refund" } } } }] });
  });

  test("an id finds one member and a name finds by name", () => {
    assert.deepEqual(clauses(`author=${ID}`), [{ authorId: ID }]);
    assert.deepEqual(clauses("author=sam"), [{ authorName: { contains: "sam" } }]);
  });

  test("deleted and edited are told apart, and anything else means all", () => {
    assert.deepEqual(clauses("state=deleted"), [{ deletedAt: { not: null } }]);
    assert.deepEqual(clauses("state=edited"), [{ editedAt: { not: null } }]);
    assert.deepEqual(clauses("state=whatever"), []);
    assert.equal(parseLogState(null), "all");
  });

  test("a date range becomes bounds and a bad date is ignored", () => {
    const [range] = clauses("since=2026-10-01T00:00:00.000Z&until=2026-10-02T00:00:00.000Z");
    assert.ok((range!.createdAt as { gte: Date }).gte instanceof Date);
    assert.deepEqual(clauses("since=not-a-date"), []);
  });

  test("a viewer only gets the channels they can read", () => {
    assert.deepEqual(clauses("", [ID]), [{ channelId: { in: [ID] } }]);
    assert.deepEqual(clauses("", []), [{ channelId: { in: [] } }]);
    assert.deepEqual(clauses("", null), []);
  });
});
