import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { activeFilters, activeRange, dayAgo, hasServerLogFilters, parseServerLogQuery, parseView, serverLogApiParams, serverLogHref } from "../app/guilds/[id]/mod/server-logs/params.ts";

describe("parseServerLogQuery", () => {
  test("nothing asked means no filters", () => {
    const query = parseServerLogQuery({});
    assert.equal(hasServerLogFilters(query), false);
    assert.equal(query.page, 1);
  });

  test("unknown categories and types are dropped, not errors", () => {
    const query = parseServerLogQuery({ category: "members,bogus,voice", type: "member.join,bogus" });
    assert.deepEqual(query.category, ["members", "voice"]);
    assert.deepEqual(query.type, ["member.join"]);
  });

  test("a range typed backwards is turned round", () => {
    const query = parseServerLogQuery({ since: "2026-10-09", until: "2026-10-01" });
    assert.deepEqual([query.since, query.until], ["2026-10-01", "2026-10-09"]);
  });

  test("the view is events unless messages is asked for", () => {
    assert.equal(parseView({}), "events");
    assert.equal(parseView({ view: "messages" }), "messages");
    assert.equal(parseView({ view: "nonsense" }), "events");
  });
});

describe("serverLogApiParams and serverLogHref", () => {
  test("lists are sent comma separated, and one day covers the whole day", () => {
    const params = serverLogApiParams(parseServerLogQuery({ category: "members,roles", since: "2026-10-01", until: "2026-10-01" }));
    assert.equal(params.category, "members,roles");
    assert.equal(params.since, "2026-10-01T00:00:00.000Z");
    assert.equal(params.until, "2026-10-01T23:59:59.999Z");
  });

  test("only what is set is in the address", () => {
    assert.equal(serverLogHref("1", {}), "/guilds/1/mod/server-logs");
    assert.equal(serverLogHref("1", { q: "hi", category: ["voice"], page: 2 }), "/guilds/1/mod/server-logs?q=hi&category=voice&page=2");
  });
});

describe("quick ranges and active filters", () => {
  const now = new Date("2026-10-15T12:00:00Z");

  test("a quick range is recognised from its start day", () => {
    assert.equal(dayAgo(6, now), "2026-10-09");
    assert.equal(activeRange({ since: "2026-10-09", until: "" }, now), "7d");
    assert.equal(activeRange({ since: "2026-10-09", until: "2026-10-12" }, now), null);
  });

  test("every filter that is on gets a chip that says how to take it off", () => {
    const query = parseServerLogQuery({ q: "sam", category: "members", channel: "123456789012345678", since: "2026-10-01" });
    const filters = activeFilters(query, () => "general");
    assert.deepEqual(filters.map((f) => f.label), ['"sam"', "Members", "#general", "From 2026-10-01"]);
    assert.deepEqual(filters[1]!.clear, { category: [] });
  });
});
