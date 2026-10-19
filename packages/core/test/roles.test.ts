import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { s } from "../dist/schema.js";
import { assignedRoles } from "../dist/roles.js";

const A = "100000000000000001";
const B = "100000000000000002";
const C = "100000000000000003";
const D = "100000000000000004";

const schema = s.object({
  reward: s.role({ optional: true, assigns: true }),
  exempt: s.role({ optional: true }),
  joinRoles: s.array(s.role({ assigns: true })),
  notify: s.array(s.role()),
  tiers: s.array(s.object({ level: s.integer({ default: 1 }), role: s.role({ assigns: true }) })),
  asWhole: s.array(s.role(), { assigns: true }),
});

describe("assignedRoles", () => {
  test("finds every role the settings hand out, with the path of the setting", () => {
    const found = assignedRoles(schema.describe(), {
      reward: A,
      exempt: B,
      joinRoles: [C],
      notify: [B],
      tiers: [{ level: 3, role: D }],
      asWhole: [],
    });
    assert.deepEqual([...found].sort(), [[A, "reward"], [C, "joinRoles[0]"], [D, "tiers[0].role"]].sort());
  });

  test("a list marked as handing out roles covers the roles inside it", () => {
    const found = assignedRoles(schema.describe(), { asWhole: [A, B] });
    assert.deepEqual([...found.keys()].sort(), [A, B]);
  });

  test("ignores empty, missing and malformed values", () => {
    assert.equal(assignedRoles(schema.describe(), {}).size, 0);
    assert.equal(assignedRoles(schema.describe(), { reward: "", joinRoles: "x", tiers: [null, 5] }).size, 0);
    assert.equal(assignedRoles(schema.describe(), null).size, 0);
  });

  test("does not read inherited keys", () => {
    const polluted = Object.create({ reward: A });
    assert.equal(assignedRoles(schema.describe(), polluted).size, 0);
  });
});
