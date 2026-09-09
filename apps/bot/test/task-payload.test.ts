import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  matchesPayload,
  namespaceKind,
  parsePayload,
  splitKind,
} from "../src/runtime/task-payload.ts";

describe("parsePayload", () => {
  test("reads an object back", () => {
    assert.deepEqual(parsePayload('{"userId":"1"}'), { userId: "1" });
  });

  test("falls back to empty on damaged text without throwing", () => {
    assert.deepEqual(parsePayload("not json"), {});
    assert.deepEqual(parsePayload(""), {});
  });

  test("refuses a payload that is not an object", () => {
    assert.deepEqual(parsePayload("[1,2]"), {});
    assert.deepEqual(parsePayload("null"), {});
    assert.deepEqual(parsePayload("42"), {});
  });
});

describe("matchesPayload", () => {
  const payload = { userId: "1", reason: "spam", caseId: 7 };

  test("matches everything when no filter is given", () => {
    assert.equal(matchesPayload(payload, undefined), true);
    assert.equal(matchesPayload(payload, {}), true);
  });

  test("matches on a subset of keys", () => {
    assert.equal(matchesPayload(payload, { userId: "1" }), true);
    assert.equal(matchesPayload(payload, { userId: "1", caseId: 7 }), true);
  });

  test("rejects a differing value", () => {
    assert.equal(matchesPayload(payload, { userId: "2" }), false);
    assert.equal(matchesPayload(payload, { userId: "1", caseId: 8 }), false);
  });

  test("rejects a key the payload does not carry", () => {
    assert.equal(matchesPayload(payload, { missing: "x" }), false);
  });

  test("compares by identity, so a string does not match a number", () => {
    assert.equal(matchesPayload({ caseId: 7 }, { caseId: "7" }), false);
  });

  test("rejects a payload that is not an object", () => {
    assert.equal(matchesPayload(null, { a: 1 }), false);
    assert.equal(matchesPayload([1], { a: 1 }), false);
  });
});

describe("kind namespacing", () => {
  test("round trips a module and kind", () => {
    const split = splitKind(namespaceKind("moderation", "unban"));
    assert.deepEqual(split, { moduleId: "moderation", kind: "unban" });
  });

  test("keeps a colon that appears inside the kind", () => {
    assert.deepEqual(splitKind("tickets:close:idle"), {
      moduleId: "tickets",
      kind: "close:idle",
    });
  });

  test("refuses a kind that is not namespaced", () => {
    assert.equal(splitKind("unban"), null);
    assert.equal(splitKind(":unban"), null);
    assert.equal(splitKind("moderation:"), null);
  });
});
