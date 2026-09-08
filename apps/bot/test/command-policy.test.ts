import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkCommandPolicy, parseIdList } from "../src/runtime/command-policy.ts";

const OPEN = { allowRoles: [] as string[], denyChannels: [] as string[] };

describe("checkCommandPolicy", () => {
  test("allows a command with no rules set", () => {
    assert.deepEqual(checkCommandPolicy(OPEN, "chan", []), { allowed: true });
  });

  test("refuses a denied channel", () => {
    const verdict = checkCommandPolicy({ ...OPEN, denyChannels: ["chan"] }, "chan", []);
    assert.deepEqual(verdict, { allowed: false, reason: "channel" });
  });

  test("allows a channel that is not on the deny list", () => {
    assert.equal(checkCommandPolicy({ ...OPEN, denyChannels: ["other"] }, "chan", []).allowed, true);
  });

  test("requires one of the allowed roles once any is set", () => {
    const policy = { ...OPEN, allowRoles: ["mods"] };
    assert.equal(checkCommandPolicy(policy, "chan", ["mods"]).allowed, true);
    assert.deepEqual(checkCommandPolicy(policy, "chan", ["members"]), {
      allowed: false,
      reason: "role",
    });
    assert.equal(checkCommandPolicy(policy, "chan", []).allowed, false);
  });

  test("accepts any one of several allowed roles", () => {
    const policy = { ...OPEN, allowRoles: ["mods", "admins"] };
    assert.equal(checkCommandPolicy(policy, "chan", ["admins"]).allowed, true);
  });

  test("checks the channel before the role, so the clearer reason wins", () => {
    const policy = { allowRoles: ["mods"], denyChannels: ["chan"] };
    assert.deepEqual(checkCommandPolicy(policy, "chan", ["members"]), {
      allowed: false,
      reason: "channel",
    });
  });

  test("skips the channel rule when there is no channel", () => {
    assert.equal(checkCommandPolicy({ ...OPEN, denyChannels: ["chan"] }, null, []).allowed, true);
  });
});

describe("parseIdList", () => {
  test("reads a stored list", () => {
    assert.deepEqual(parseIdList('["a","b"]'), ["a", "b"]);
  });

  test("returns empty for damaged text rather than widening access", () => {
    assert.deepEqual(parseIdList("nonsense"), []);
    assert.deepEqual(parseIdList('{"a":1}'), []);
    assert.deepEqual(parseIdList(""), []);
  });

  test("drops entries that are not ids", () => {
    assert.deepEqual(parseIdList('["a",5,null,"b"]'), ["a", "b"]);
  });
});
