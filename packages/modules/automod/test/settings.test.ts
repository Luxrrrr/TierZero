import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { RECOMMENDED_ACTIONS, settings, upgradeRule } from "../dist/settings.js";

const RULES = ["invites", "links", "capitals", "repeatedText", "mentions", "bannedWords", "rateLimit"] as const;

type Rule = Record<string, unknown>;

function parsed(stored: unknown): Record<string, Rule> {
  const result = settings.parse(stored);
  assert.ok(result.ok, "settings should parse");
  return result.value as unknown as Record<string, Rule>;
}

describe("the actions setting", () => {
  test("every rule starts with its recommended set, switched off", () => {
    const value = parsed({});
    for (const rule of RULES) {
      assert.deepEqual(value[rule]?.actions, [...RECOMMENDED_ACTIONS[rule]], rule);
      assert.equal(value[rule]?.enabled, false, rule);
    }
  });

  test("the recommended sets are the ones decided on", () => {
    assert.deepEqual(RECOMMENDED_ACTIONS, {
      invites: ["delete", "warn"],
      links: ["delete"],
      capitals: ["delete"],
      repeatedText: ["delete", "warn"],
      mentions: ["delete", "timeout"],
      bannedWords: ["delete", "warn"],
      rateLimit: ["delete", "timeout"],
    });
  });

  test("keeps each rule's timeout length", () => {
    const value = parsed({});
    for (const rule of RULES) {
      assert.equal(value[rule]?.timeoutDuration, rule === "rateLimit" ? 300_000 : 600_000, rule);
    }
  });

  test("takes any combination, in any order", () => {
    const value = parsed({ links: { actions: ["timeout", "warn"] } });
    assert.deepEqual(value.links?.actions, ["timeout", "warn"]);
  });

  test("refuses an empty list, a repeat and an unknown action", () => {
    for (const actions of [[], ["delete", "delete"], ["ban"]]) {
      assert.equal(settings.parse({ links: { actions } }).ok, false, JSON.stringify(actions));
    }
  });

  test("describes itself as a multi-select with the recommended options marked", () => {
    const described = JSON.parse(JSON.stringify(settings.describe())) as { fields: Record<string, { fields: Record<string, Record<string, unknown>> }> };
    for (const rule of RULES) {
      const field = described.fields[rule]?.fields.actions;
      assert.equal(field?.kind, "array");
      assert.equal(field?.unique, true);
      assert.equal(field?.min, 1);
      assert.deepEqual(field?.default, [...RECOMMENDED_ACTIONS[rule]]);
      const of = field?.of as { kind: string; options: Array<{ value: string; recommended?: boolean; description?: string }> };
      assert.equal(of.kind, "choice");
      assert.deepEqual(of.options.map((o) => o.value), ["delete", "warn", "timeout"]);
      assert.deepEqual(of.options.filter((o) => o.recommended).map((o) => o.value), [...RECOMMENDED_ACTIONS[rule]]);
      assert.ok(of.options.every((o) => (o.description ?? "").length > 0));
      assert.deepEqual(described.fields[rule]?.fields.timeoutDuration?.when, { field: "actions", includes: "timeout" });
    }
  });

  test("the full descriptor of an actions field", () => {
    const described = JSON.parse(JSON.stringify(settings.describe())) as { fields: Record<string, { fields: Record<string, unknown> }> };
    assert.deepEqual(described.fields.links?.fields.actions, {
      kind: "array",
      label: "What to do when it trips",
      help: "Pick any combination. The suggested ones are marked.",
      min: 1,
      unique: true,
      default: ["delete"],
      of: {
        kind: "choice",
        options: [
          { value: "delete", label: "Delete", description: "Removes the message.", recommended: true },
          { value: "warn", label: "Warn", description: "Adds a warning to their record.", recommended: false },
          { value: "timeout", label: "Time out", description: "Mutes them for the timeout length.", recommended: false },
        ],
      },
    });
  });
});

describe("settings saved with a single action", () => {
  test("delete becomes delete", () => {
    assert.deepEqual(parsed({ links: { enabled: true, action: "delete" } }).links?.actions, ["delete"]);
  });

  test("warn becomes warn alone, which never deleted the message", () => {
    assert.deepEqual(parsed({ links: { enabled: true, action: "warn" } }).links?.actions, ["warn"]);
  });

  test("timeout becomes delete and timeout, since that preset deleted the message too", () => {
    assert.deepEqual(parsed({ links: { enabled: true, action: "timeout" } }).links?.actions, ["delete", "timeout"]);
  });

  test("works for every rule, keeping the rest of what was saved", () => {
    for (const rule of RULES) {
      const value = parsed({ [rule]: { enabled: true, action: "timeout", timeoutDuration: "2h" } });
      assert.deepEqual(value[rule]?.actions, ["delete", "timeout"], rule);
      assert.equal(value[rule]?.timeoutDuration, 7_200_000, rule);
      assert.equal(value[rule]?.enabled, true, rule);
    }
  });

  test("a rule switched on without a saved action behaves as the old default did", () => {
    const old = { invites: "delete", links: "delete", capitals: "warn", repeatedText: "delete", mentions: "timeout", bannedWords: "delete", rateLimit: "timeout" } as const;
    const expected = { delete: ["delete"], warn: ["warn"], timeout: ["delete", "timeout"] };
    for (const rule of RULES) {
      assert.deepEqual(parsed({ [rule]: { enabled: true } })[rule]?.actions, expected[old[rule]], rule);
    }
  });

  test("a rule that is off and untouched gets the new recommended set", () => {
    assert.deepEqual(parsed({ capitals: { enabled: false } }).capitals?.actions, ["delete"]);
  });

  test("an unknown old action falls back to the recommended set", () => {
    assert.deepEqual(parsed({ links: { enabled: true, action: "ban" } }).links?.actions, ["delete"]);
  });

  test("a value that already has actions is left alone, and the old key never wins", () => {
    assert.deepEqual(parsed({ links: { enabled: true, actions: ["warn", "timeout"], action: "delete" } }).links?.actions, ["warn", "timeout"]);
  });
});

describe("upgradeRule", () => {
  const upgrade = upgradeRule("capitals");

  test("maps each old action and drops the stale key", () => {
    assert.deepEqual(upgrade({ enabled: true, action: "delete" }), { enabled: true, actions: ["delete"] });
    assert.deepEqual(upgrade({ enabled: true, action: "warn" }), { enabled: true, actions: ["warn"] });
    assert.deepEqual(upgrade({ enabled: true, action: "timeout" }), { enabled: true, actions: ["delete", "timeout"] });
  });

  test("is idempotent", () => {
    for (const action of ["delete", "warn", "timeout"]) {
      const once = upgrade({ enabled: true, action });
      assert.deepEqual(upgrade(once), once);
    }
    const bare = upgrade({ enabled: true });
    assert.deepEqual(upgrade(bare), bare);
  });

  test("leaves an already-current value alone and drops a stale key beside it", () => {
    const current = { enabled: true, actions: ["warn"] };
    assert.deepEqual(upgrade(current), current);
    assert.deepEqual(upgrade({ ...current, action: "timeout" }), current);
  });

  test("does not invent actions for a rule that is off", () => {
    assert.deepEqual(upgrade({}), {});
    assert.deepEqual(upgrade({ enabled: false }), { enabled: false });
  });

  test("does not touch the object it was given", () => {
    const stored = { enabled: true, action: "warn" };
    upgrade(stored);
    assert.deepEqual(stored, { enabled: true, action: "warn" });
  });
});

describe("how the rules are laid out on the dashboard", () => {
  const fields = settings.describe().fields as Record<string, Record<string, unknown>>;
  const ruleFields = (rule: string) => Object.keys(fields[rule]?.fields as Record<string, unknown>);

  test("every rule is a collapsible section summarised by its actions", () => {
    for (const rule of RULES) {
      assert.equal(fields[rule]?.collapsible, true, rule);
      assert.deepEqual(fields[rule]?.summary, ["actions", "timeoutDuration"], rule);
    }
  });

  test("the common fields come first and the exemptions last", () => {
    for (const rule of RULES) {
      const keys = ruleFields(rule);
      assert.deepEqual(keys.slice(0, 3), ["enabled", "actions", "timeoutDuration"], rule);
      assert.deepEqual(keys.slice(-2), ["exemptRoles", "exemptChannels"], rule);
    }
  });

  test("the timeout length still waits for the timeout action", () => {
    for (const rule of RULES) {
      const length = (fields[rule]?.fields as Record<string, Record<string, unknown>>).timeoutDuration;
      assert.deepEqual(length?.when, { field: "actions", includes: "timeout" }, rule);
    }
  });

  test("the three log posts are compact rows", () => {
    const messages = (fields.logMessages?.fields ?? {}) as Record<string, Record<string, unknown>>;
    assert.deepEqual(Object.keys(messages), ["delete", "warn", "timeout"]);
    for (const message of Object.values(messages)) assert.equal(message.compact, true);
  });
});
