import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { FieldDescriptor } from "@tier0/core";
import { ModuleRegistry } from "@tier0/core";
import utility from "@tier0/module-utility";
import welcome from "@tier0/module-welcome";
import roles from "@tier0/module-roles";
import automod from "@tier0/module-automod";
import leveling from "@tier0/module-leveling";
import moderation from "@tier0/module-moderation";
import tickets from "@tier0/module-tickets";
import auditlog from "@tier0/module-auditlog";
import feeds from "@tier0/module-feeds";

/**
 * The dashboard renders any module's settings from its schema alone, which
 * only holds while every field a module declares is a kind the renderer knows
 * how to draw. A module reaching for something new is meant to add a field
 * kind, not a settings page, and this is what catches the alternative.
 */

const RENDERABLE = new Set([
  "string",
  "integer",
  "boolean",
  "duration",
  "channel",
  "role",
  "choice",
  "emoji",
  "template",
  "array",
  "object",
]);

const registry = new ModuleRegistry();
for (const module of [utility, welcome, roles, automod, leveling, moderation, tickets, auditlog, feeds]) {
  registry.register(module);
}

/**
 * `when` names a sibling, and the dashboard builds the "only used when ..."
 * sentence from that sibling's label. A typo would leave the field permanently
 * disabled with no explanation, which is only visible by loading the page.
 */
function checkConditions(field: FieldDescriptor, path: string, fail: (message: string) => void) {
  if (field.kind === "array") {
    checkConditions(field.of as FieldDescriptor, `${path}[]`, fail);
    return;
  }
  if (field.kind !== "object") return;

  const fields = field.fields as Record<string, FieldDescriptor>;
  for (const [key, child] of Object.entries(fields)) {
    const childPath = path ? `${path}.${key}` : key;
    const condition = child.when as { field?: unknown } | undefined;
    if (condition !== undefined) {
      const sibling = condition.field;
      if (typeof sibling !== "string" || !(sibling in fields)) {
        fail(`${childPath} depends on ${String(sibling)}, which is not a field beside it`);
      }
    }
    checkConditions(child, childPath, fail);
  }
}

function walk(field: FieldDescriptor, path: string, visit: (f: FieldDescriptor, p: string) => void) {
  visit(field, path);
  if (field.kind === "object") {
    for (const [key, child] of Object.entries(field.fields as Record<string, FieldDescriptor>)) {
      walk(child, path ? `${path}.${key}` : key, visit);
    }
  }
  if (field.kind === "array") {
    walk(field.of as FieldDescriptor, `${path}[]`, visit);
  }
}

describe("every registered module", () => {
  const modules = registry.describe();

  test("registers at least the modules under test", () => {
    assert.equal(modules.length, 9);
  });

  for (const module of modules) {
    test(`${module.id} declares only field kinds the dashboard can draw`, () => {
      walk(module.schema, "", (field, path) => {
        assert.ok(
          RENDERABLE.has(field.kind),
          `${module.id}.${path} uses ${field.kind}, which the settings form has no control for`,
        );
      });
    });

    test(`${module.id} only makes a setting depend on one of its siblings`, () => {
      checkConditions(module.schema, "", (message) => assert.fail(`${module.id}: ${message}`));
    });

    test(`${module.id} settings resolve from an empty stored value`, () => {
      const resolved = registry.resolveSettings(module.id, {});
      assert.ok(
        resolved.ok,
        `${module.id} cannot start unconfigured: ` +
          (resolved.ok ? "" : resolved.errors.map((e) => `${e.path} ${e.message}`).join("; ")),
      );
    });

    test(`${module.id} labels every top level setting`, () => {
      const fields = module.schema.fields as Record<string, FieldDescriptor>;
      for (const [key, field] of Object.entries(fields)) {
        assert.ok(field.label, `${module.id}.${key} has no label, so the form shows a guess`);
      }
    });

    test(`${module.id} belongs to a dashboard section`, () => {
      assert.ok(
        ["moderation", "members", "engagement", "support", "logging", "utility", "more"].includes(
          module.category,
        ),
        `${module.id} has category ${module.category}, which no dashboard section renders`,
      );
    });

    test(`${module.id} describes itself for the module list`, () => {
      assert.ok(module.name.length > 0);
      assert.ok(module.summary.length > 0, `${module.id} needs a summary for its dashboard card`);
    });

    test(`${module.id} labels every setting the quick setup asks about`, () => {
      walk(module.schema, "", (field, path) => {
        if (field.guided !== true && field.essential !== true) return;
        assert.ok(
          field.label,
          `${module.id}.${path} is asked about by the quick setup but has no label, ` +
            "so the wizard shows a guess made from the key",
        );
      });
    });
  }
});

/**
 * The dashboard's quick setup bundles these together, and it builds each run
 * out of the fields a schema tagged `guided` or `essential`. A module that
 * tags neither has nothing for the wizard to ask, which the hub handles by not
 * offering it, quietly, which is worth catching here instead.
 *
 * The bundles themselves live in apps/web/lib/guided.ts.
 */
describe("the modules the quick setup relies on", () => {
  for (const id of ["moderation", "automod", "tickets"]) {
    test(`${id} has something for the wizard to ask about`, () => {
      const module = registry.describe().find((entry) => entry.id === id);
      assert.ok(module, `${id} is not registered`);

      let asked = 0;
      walk(module.schema, "", (field) => {
        if (field.guided === true || field.essential === true) asked += 1;
      });
      assert.ok(asked > 0, `${id} tags no field guided or essential, so it offers no quick setup`);
    });
  }
});

describe("the sibling check", () => {
  test("catches a condition that names a field which is not there", () => {
    const schema = {
      kind: "object",
      fields: {
        action: { kind: "choice" },
        timeoutDuration: { kind: "duration", when: { field: "actoin", equals: "timeout" } },
      },
    } as unknown as FieldDescriptor;

    const failures: string[] = [];
    checkConditions(schema, "", (message) => failures.push(message));
    assert.equal(failures.length, 1);
  });

  test("looks inside the item shape of an array", () => {
    const schema = {
      kind: "object",
      fields: {
        menus: {
          kind: "array",
          of: {
            kind: "object",
            fields: {
              label: { kind: "string" },
              role: { kind: "role", when: { field: "name" } },
            },
          },
        },
      },
    } as unknown as FieldDescriptor;

    const failures: string[] = [];
    checkConditions(schema, "", (message) => failures.push(message));
    assert.equal(failures.length, 1);
  });
});
