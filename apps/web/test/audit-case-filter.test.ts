import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { auditApiParams, auditHref, hasAuditFilters, parseAuditQuery } from "../app/guilds/[id]/mod/audit/params.ts";

describe("the audit filter for one case", () => {
  test("a case number in the address is read, and nonsense is ignored", () => {
    assert.equal(parseAuditQuery({ infractionId: "42" }).infractionId, 42);
    assert.equal(parseAuditQuery({ infractionId: "abc" }).infractionId, 0);
    assert.equal(parseAuditQuery({}).infractionId, 0);
  });

  test("it counts as a filter, is sent to the bot and survives in links", () => {
    const query = parseAuditQuery({ infractionId: "42" });
    assert.equal(hasAuditFilters(query), true);
    assert.equal(auditApiParams(query).infractionId, 42);
    assert.equal(auditHref("1", query), "/guilds/1/mod/audit?infractionId=42");
    assert.equal(auditHref("1", { ...query, infractionId: 0 }), "/guilds/1/mod/audit");
  });
});
