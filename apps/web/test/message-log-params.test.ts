import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { hasMessageLogFilters, messageLogApiParams, messageLogHref, parseMessageLogQuery } from "../app/guilds/[id]/mod/server-logs/message-params.ts";

describe("parseMessageLogQuery", () => {
  test("nothing asked means no filters", () => {
    const query = parseMessageLogQuery({});
    assert.equal(hasMessageLogFilters(query), false);
    assert.equal(query.page, 1);
    assert.equal(query.state, "all");
  });

  test("anything unrecognised falls back instead of failing", () => {
    const query = parseMessageLogQuery({ state: "nope", channel: "abc", since: "2026-13-45", page: "-3" });
    assert.equal(query.state, "all");
    assert.equal(query.channel, "");
    assert.equal(query.since, "");
    assert.equal(query.page, 1);
  });

  test("a range typed backwards is turned round", () => {
    const query = parseMessageLogQuery({ since: "2026-10-09", until: "2026-10-01" });
    assert.deepEqual([query.since, query.until], ["2026-10-01", "2026-10-09"]);
  });
});

describe("messageLogApiParams", () => {
  test("a single day covers the whole day", () => {
    const params = messageLogApiParams(parseMessageLogQuery({ since: "2026-10-01", until: "2026-10-01" }));
    assert.equal(params.since, "2026-10-01T00:00:00.000Z");
    assert.equal(params.until, "2026-10-01T23:59:59.999Z");
  });
});

describe("messageLogHref", () => {
  test("only what was set is in the address", () => {
    assert.equal(messageLogHref("1", {}), "/guilds/1/mod/server-logs?view=messages");
    assert.equal(messageLogHref("1", { q: "hi", state: "deleted", page: 2 }), "/guilds/1/mod/server-logs?view=messages&q=hi&state=deleted&page=2");
  });
});
