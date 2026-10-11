import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  FLOWS,
  availableFlows,
  fieldAt,
  flowById,
  guidedPaths,
  guidedProjection,
  hasGuidedSetup,
} from "../lib/guided.ts";

/**
 * The schema arrives from the bot as plain JSON, so the fixtures here are
 * written as plain JSON too rather than built with the schema builders.
 */
const schema = {
  kind: "object",
  fields: {
    category: { kind: "channel", label: "Ticket category", essential: true },
    supportRoles: { kind: "array", label: "Support roles", guided: true, of: { kind: "role" } },
    ticketLimit: { kind: "integer", label: "Max open tickets" },
    panel: {
      kind: "object",
      label: "The panel members press",
      fields: {
        channel: { kind: "channel", label: "Panel channel", essential: true },
        title: { kind: "string", label: "Panel title" },
      },
    },
    transcript: {
      kind: "object",
      label: "Transcripts",
      fields: {
        enabled: { kind: "boolean", label: "Save a transcript" },
        channel: {
          kind: "channel",
          label: "Transcript channel",
          guided: true,
          when: { field: "enabled", equals: true },
        },
      },
    },
    autoClose: {
      kind: "object",
      label: "Inactivity",
      fields: {
        enabled: { kind: "boolean", label: "Auto-close" },
        after: { kind: "duration", label: "Close after" },
      },
    },
  },
} as never;

const untagged = {
  kind: "object",
  fields: {
    limit: { kind: "integer", label: "Limit" },
    nested: { kind: "object", fields: { colour: { kind: "string" } } },
  },
} as never;

describe("guidedPaths", () => {
  test("takes fields tagged guided and fields marked essential alike", () => {
    const paths = guidedPaths(schema);
    assert.ok(paths.includes("category"), "essential");
    assert.ok(paths.includes("panel.channel"), "essential, nested");
    assert.ok(paths.includes("supportRoles"), "guided");
    assert.ok(paths.includes("transcript.channel"), "guided, nested");
  });

  test("leaves out everything neither tagged nor essential", () => {
    const paths = guidedPaths(schema);
    assert.ok(!paths.includes("ticketLimit"));
    assert.ok(!paths.includes("panel.title"));
    assert.ok(!paths.includes("autoClose.after"));
  });

  test("pulls in the sibling a selected field's condition names", () => {
    // Without transcript.enabled the wizard would draw a channel picker greyed
    // out with no way on screen to enable it.
    assert.ok(guidedPaths(schema).includes("transcript.enabled"));
  });

  test("orders paths the way the schema declares them", () => {
    assert.deepEqual(guidedPaths(schema), [
      "category",
      "supportRoles",
      "panel.channel",
      "transcript.enabled",
      "transcript.channel",
    ]);
  });

  test("returns nothing for a schema that tagged nothing", () => {
    assert.deepEqual(guidedPaths(untagged), []);
  });
});

describe("guidedProjection", () => {
  test("keeps only the selected fields", () => {
    const projected = guidedProjection(schema);
    assert.deepEqual(Object.keys(projected?.fields as object), [
      "category",
      "supportRoles",
      "panel",
      "transcript",
    ]);
  });

  test("keeps the nesting and the group's own label", () => {
    const projected = guidedProjection(schema);
    const panel = (projected?.fields as Record<string, { label: string; fields: object }>).panel;
    assert.equal(panel.label, "The panel members press");
    assert.deepEqual(Object.keys(panel.fields), ["channel"]);
  });

  test("drops a group with nothing selected under it", () => {
    const projected = guidedProjection(schema);
    assert.ok(!("autoClose" in (projected?.fields as object)));
  });

  test("carries the essential flag through, so the finish step can read it", () => {
    const projected = guidedProjection(schema);
    const category = (projected?.fields as Record<string, { essential?: boolean }>).category;
    assert.equal(category.essential, true);
  });

  test("is null when a module tagged nothing", () => {
    assert.equal(guidedProjection(untagged), null);
    assert.equal(hasGuidedSetup(untagged), false);
    assert.equal(hasGuidedSetup(schema), true);
  });
});

describe("fieldAt", () => {
  test("walks a dotted path", () => {
    assert.equal(fieldAt(schema, "panel.channel")?.label, "Panel channel");
  });

  test("returns undefined rather than throwing on a path that is not there", () => {
    assert.equal(fieldAt(schema, "panel.nope.deeper"), undefined);
  });
});

describe("availableFlows", () => {
  test("drops modules this install does not have", () => {
    const flows = availableFlows(["moderation", "tickets"]);
    const moderation = flows.find((flow) => flow.id === "moderation");
    assert.deepEqual(moderation?.modules, ["moderation"]);
  });

  test("does not offer a flow whose modules are all missing", () => {
    assert.deepEqual(availableFlows(["utility"]), []);
  });

  test("keeps every flow when every module is present", () => {
    const ids = FLOWS.flatMap((flow) => flow.modules);
    assert.equal(availableFlows(ids).length, FLOWS.length);
  });

  test("leaves the exported flows alone", () => {
    availableFlows(["tickets"]);
    assert.deepEqual(flowById("moderation")?.modules, ["moderation", "automod"]);
  });
});
