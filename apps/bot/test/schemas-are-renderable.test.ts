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
for (const module of [utility, welcome, roles, automod, leveling, moderation, tickets, auditlog]) {
  registry.register(module);
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
    assert.equal(modules.length, 8);
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
        ["moderation", "members", "engagement", "support", "logging", "utility"].includes(
          module.category,
        ),
        `${module.id} has category ${module.category}, which no dashboard section renders`,
      );
    });

    test(`${module.id} describes itself for the module list`, () => {
      assert.ok(module.name.length > 0);
      assert.ok(module.summary.length > 0, `${module.id} needs a summary for its dashboard card`);
    });
  }
});
