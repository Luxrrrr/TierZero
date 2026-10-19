import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { FieldDescriptor } from "@tier0/core";
import { ModuleRegistry, formLayoutProblems, layoutProblems, messageAttachProblems, type FieldTopic, type MessageAttach } from "@tier0/core";
import utility from "@tier0/module-utility";
import welcome from "@tier0/module-welcome";
import verification from "@tier0/module-verification";
import roles from "@tier0/module-roles";
import automod from "@tier0/module-automod";
import leveling from "@tier0/module-leveling";
import moderation from "@tier0/module-moderation";
import tickets from "@tier0/module-tickets";
import auditlog from "@tier0/module-auditlog";
import feeds from "@tier0/module-feeds";
import system from "@tier0/module-system";

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
  "message",
  "array",
  "object",
]);

const registry = new ModuleRegistry();
for (const module of [utility, welcome, verification, roles, automod, leveling, moderation, tickets, auditlog, feeds, system]) {
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
    const condition = child.when as { field?: unknown; includes?: unknown } | undefined;
    if (condition !== undefined) {
      const sibling = condition.field;
      if (typeof sibling !== "string" || !(sibling in fields)) {
        fail(`${childPath} depends on ${String(sibling)}, which is not a field beside it`);
      } else if (condition.includes !== undefined) {
        // The dashboard meets `includes` only against a list, and the sentence
        // that explains the dependency names the option by its label.
        const target = fields[sibling] as FieldDescriptor;
        const item = target.kind === "array" ? (target.of as FieldDescriptor) : undefined;
        const values = ((item?.options ?? []) as { value: string }[]).map((o) => o.value);
        if (item?.kind !== "choice" || !values.includes(String(condition.includes))) {
          fail(`${childPath} needs ${sibling} to include ${String(condition.includes)}, which it cannot`);
        }
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

/** Every message that declares what the feature adds under it, with the fields beside it. */
function attachedMessages(field: FieldDescriptor, path: string, visit: (attach: MessageAttach, parent: Record<string, FieldDescriptor>, at: string) => void) {
  if (field.kind === "array") {
    attachedMessages(field.of as FieldDescriptor, `${path}[]`, visit);
    return;
  }
  if (field.kind !== "object") return;
  const fields = field.fields as Record<string, FieldDescriptor>;
  for (const [key, child] of Object.entries(fields)) {
    const at = path ? `${path}.${key}` : key;
    if (child.kind === "message" && child.attach !== undefined) visit(child.attach as MessageAttach, fields, at);
    attachedMessages(child, at, visit);
  }
}

describe("every registered module", () => {
  const modules = registry.describe();

  test("registers at least the modules under test", () => {
    assert.equal(modules.length, 11);
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

    test(`${module.id} attaches buttons to a message only from settings that exist`, () => {
      const root = module.schema.fields as Record<string, FieldDescriptor>;
      attachedMessages(module.schema, "", (attach, parent, at) => {
        assert.deepEqual(messageAttachProblems(attach, parent, root), [], `${module.id}.${at}`);
      });
    });

    test(`${module.id} only makes a setting depend on one of its siblings`, () => {
      checkConditions(module.schema, "", (message) => assert.fail(`${module.id}: ${message}`));
    });

    test(`${module.id} lists of choices have options and a default drawn from them`, () => {
      walk(module.schema, "", (field, path) => {
        const item = field.kind === "array" ? (field.of as FieldDescriptor) : undefined;
        if (item?.kind !== "choice") return;

        const values = ((item.options ?? []) as { value: string }[]).map((o) => o.value);
        assert.ok(values.length > 0, `${module.id}.${path} offers no options to pick from`);
        assert.equal(new Set(values).size, values.length, `${module.id}.${path} repeats an option`);

        const fallback = field.default;
        if (!Array.isArray(fallback)) return;
        for (const entry of fallback) {
          assert.ok(values.includes(entry), `${module.id}.${path} defaults to ${String(entry)}, which is not an option`);
        }
        if (typeof field.min === "number") {
          assert.ok(fallback.length >= field.min, `${module.id}.${path} defaults to fewer than its minimum`);
        }
        if (typeof field.max === "number") {
          assert.ok(fallback.length <= field.max, `${module.id}.${path} defaults to more than its maximum`);
        }
      });
    });

    test(`${module.id} uses the layout metadata only where the dashboard reads it`, () => {
      const top = module.schema.fields as Record<string, FieldDescriptor>;
      walk(module.schema, "", (field, path) => {
        const where = `${module.id}.${path}`;
        if (field.collapsible !== undefined) {
          assert.ok(
            field.kind === "object" && top[path] === field,
            `${where} is collapsible but is not a top-level group, so the dashboard ignores it`,
          );
        }
        if (field.summary !== undefined) {
          assert.equal(field.collapsible, true, `${where} has a summary but is not collapsible`);
          const children = (field.fields ?? {}) as Record<string, FieldDescriptor>;
          for (const key of field.summary as string[]) {
            assert.ok(key in children, `${where} summarises ${key}, which is not one of its fields`);
          }
        }
        if (field.section !== undefined) {
          // Inside a sheet row a section names a tab; formLayoutProblems checks those.
          assert.ok(top[path] === field || path.includes("[]."), `${where} has a section but is not a top-level setting, so the dashboard ignores it`);
          assert.equal(typeof field.section, "string", `${where} names its section with something other than text`);
        }
        if (field.generated !== undefined) {
          assert.equal(field.kind, "string", `${where} is generated but is not a string`);
          assert.ok(path.includes("[]."), `${where} is generated but is not inside a list row, which is the only place one is filled in`);
        }
        if (field.compact !== undefined) {
          assert.equal(field.kind, "message", `${where} is compact but is not a message`);
        }
        if (field.layout !== undefined && field.kind !== "object") {
          const item = field.kind === "array" ? (field.of as FieldDescriptor) : undefined;
          if (field.layout === "sheet") {
            assert.equal(item?.kind, "object", `${where} is a sheet but is not a list of rows`);
          } else {
            assert.equal(item?.kind, "choice", `${where} sets a layout but is not a list of choices, a list of rows or a group`);
            assert.ok(["chips", "rows"].includes(String(field.layout)), `${where} has an unknown layout`);
          }
        }
      });
    });

    test(`${module.id} files settings only under headings its message and field lists declare`, () => {
      assert.deepEqual(layoutProblems(module.schema), []);
    });

    test(`${module.id} uses the sheet, step, tab, nudge and control metadata only where the dashboard reads it`, () => {
      assert.deepEqual(formLayoutProblems(module.schema), []);
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
        if (field.guided !== true && !field.essential) return;
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
        if (field.guided === true || Boolean(field.essential)) asked += 1;
      });
      assert.ok(asked > 0, `${id} tags no field guided or essential, so it offers no quick setup`);
    });
  }
});

describe("the sibling check", () => {
  test("an includes condition must name an option of a list of choices", () => {
    const schema = {
      kind: "object",
      fields: {
        actions: { kind: "array", of: { kind: "choice", options: [{ value: "timeout", label: "Time out" }] } },
        timeoutDuration: { kind: "duration", when: { field: "actions", includes: "timeout" } },
        banDuration: { kind: "duration", when: { field: "actions", includes: "ban" } },
      },
    } as unknown as FieldDescriptor;

    const failures: string[] = [];
    checkConditions(schema, "", (message) => failures.push(message));
    assert.equal(failures.length, 1);
    assert.match(failures[0] ?? "", /banDuration/);
  });

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

describe("the ticket settings", () => {
  const module = registry.describe().find((entry) => entry.id === "tickets");
  const top = (module?.schema.fields ?? {}) as Record<string, FieldDescriptor>;

  test("put every top-level setting in a section of the Settings tab", () => {
    const allowed = ["panels", "general", "transcripts", "ratings", "automation", "savedReplies", "messages"];
    for (const [key, field] of Object.entries(top)) {
      assert.ok(allowed.includes(String(field.section)), `tickets.${key} has section ${String(field.section)}`);
    }
  });

  test("show the buttons the bot adds under the panel, the first message and the notices", () => {
    const panel = (top.panels?.of as FieldDescriptor).fields as Record<string, FieldDescriptor>;
    const type = (panel.types?.of as FieldDescriptor).fields as Record<string, FieldDescriptor>;
    const messages = top.messages?.fields as Record<string, FieldDescriptor>;
    assert.equal((panel.message?.attach as MessageAttach | undefined)?.kind, "list");
    assert.equal((type.welcome?.attach as MessageAttach | undefined)?.kind, "buttons");
    assert.equal((messages.closed?.attach as MessageAttach | undefined)?.kind, "buttons");
    assert.equal((messages.closeRequest?.attach as MessageAttach | undefined)?.kind, "buttons");
  });

  test("list every message of the Messages section under a heading", () => {
    const messages = top.messages as FieldDescriptor;
    const labels = top.labels as FieldDescriptor;
    assert.equal(messages.layout, "messages");
    assert.equal(labels.layout, "fields");
    const declared = new Set(((messages.topics ?? []) as FieldTopic[]).map((topic) => topic.id));
    const unfiled: string[] = [];
    const visit = (field: FieldDescriptor, path: string, inherited: string | undefined) => {
      const topic = typeof field.topic === "string" ? field.topic : inherited;
      if (field.kind === "object") {
        for (const [key, child] of Object.entries((field.fields ?? {}) as Record<string, FieldDescriptor>)) visit(child, `${path}.${key}`, topic);
      } else if (field.kind === "message" && (topic === undefined || !declared.has(topic))) {
        unfiled.push(path);
      }
    };
    visit(messages, "messages", undefined);
    assert.deepEqual(unfiled, []);
    for (const field of Object.values((labels.fields ?? {}) as Record<string, FieldDescriptor>)) {
      assert.equal(typeof field.topic, "string", `${String(field.label)} is under no heading`);
    }
  });

  test("edit a panel in three steps and its ticket types in a sheet with five tabs", () => {
    const panel = top.panels?.of as FieldDescriptor;
    const fields = panel.fields as Record<string, FieldDescriptor>;
    const steps = (panel.steps as { id: string }[]).map((step) => step.id);
    assert.deepEqual(steps, ["where", "see", "types"]);
    for (const key of ["name", "channel", "style", "placeholder", "message", "types"]) {
      assert.ok(steps.includes(String(fields[key]?.step)), `tickets.panels.${key} is in no step`);
    }
    const types = fields.types as FieldDescriptor;
    assert.equal(types.layout, "sheet");
    const type = (types.of as FieldDescriptor).fields as Record<string, FieldDescriptor>;
    const tabs = new Set<string>();
    const gather = (fieldMap: Record<string, FieldDescriptor>, inherited: string | undefined) => {
      for (const [key, field] of Object.entries(fieldMap)) {
        if (field.generated === true) continue;
        const section = typeof field.section === "string" ? field.section : inherited;
        if (field.kind === "object") gather((field.fields ?? {}) as Record<string, FieldDescriptor>, section);
        else {
          assert.ok(section !== undefined, `tickets.panels.types.${key} is in no tab`);
          tabs.add(String(section));
        }
      }
    };
    gather(type, undefined);
    assert.deepEqual([...tabs].sort(), ["basics", "form", "messages", "people", "rules"]);
  });

  test("hide the menu placeholder and the category rather than grey them", () => {
    const panel = (top.panels?.of as FieldDescriptor).fields as Record<string, FieldDescriptor>;
    const type = (panel.types?.of as FieldDescriptor).fields as Record<string, FieldDescriptor>;
    const opening = (type.opening as FieldDescriptor).fields as Record<string, FieldDescriptor>;
    assert.equal((panel.placeholder?.when as { hide?: boolean }).hide, true);
    assert.equal((opening.category?.when as { hide?: boolean }).hide, true);
  });

  test("give panels and types an id the dashboard fills in", () => {
    const panel = (top.panels?.of as FieldDescriptor).fields as Record<string, FieldDescriptor>;
    const type = (panel.types?.of as FieldDescriptor).fields as Record<string, FieldDescriptor>;
    assert.equal(panel.id?.generated, true);
    assert.equal(type.id?.generated, true);
  });
});
