import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { FieldDescriptor } from "@tier0/core";
import { missingEssentials, moduleStatus } from "../lib/module-status.ts";
import { settings } from "../../../packages/modules/automod/dist/settings.js";

const schema = settings.describe() as unknown as FieldDescriptor;
const stored = (on: string[] = []) => {
  const parsed = settings.parse(Object.fromEntries(on.map((rule) => [rule, { enabled: true }])));
  assert.ok(parsed.ok);
  return parsed.value;
};

describe("automod with every rule off", () => {
  test("needs setup and names the rules", () => {
    const missing = missingEssentials(schema, stored());
    assert.equal(missing.length, 1);
    assert.deepEqual(missing[0]!.anyOf, ["Invite links", "Links", "Excessive capitals", "Repeated text", "Mass mentions", "Banned words", "Rate limit"]);
    assert.equal(moduleStatus(true, missing), "attention");
  });

  test("is set up once any one rule is on", () => {
    assert.deepEqual(missingEssentials(schema, stored(["bannedWords"])), []);
  });
});
