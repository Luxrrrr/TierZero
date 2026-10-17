import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { FieldDescriptor } from "@tier0/core";
import {
  sectionErrorCounts,
  sectionForErrors,
  sectionFromHash,
  sectionLabel,
  settingsSections,
  topKeyOf,
} from "../lib/settings-sections.ts";

const schema = (fields: Record<string, Partial<FieldDescriptor>>): FieldDescriptor =>
  ({ kind: "object", fields }) as unknown as FieldDescriptor;

describe("settingsSections", () => {
  test("a schema that names no section is not split", () => {
    assert.equal(settingsSections(schema({ a: { kind: "string" }, b: { kind: "object" } })), null);
  });

  test("one named section on its own is not a split either", () => {
    assert.equal(settingsSections(schema({ a: { kind: "string", section: "main" }, b: { kind: "object", section: "main" } })), null);
  });

  test("groups settings by section in the order each section first appears", () => {
    const parts = settingsSections(
      schema({
        panels: { kind: "array", section: "panels" },
        general: { kind: "object", section: "general" },
        messages: { kind: "object", section: "messages" },
        labels: { kind: "object", section: "messages" },
        ratings: { kind: "object", section: "ratings" },
      }),
    );
    assert.deepEqual(
      parts?.map((part) => [part.id, part.label, part.keys]),
      [
        ["panels", "Panels", ["panels"]],
        ["general", "General", ["general"]],
        ["messages", "Messages", ["messages", "labels"]],
        ["ratings", "Ratings", ["ratings"]],
      ],
    );
  });

  test("settings that name no section are kept in a last part rather than hidden", () => {
    const parts = settingsSections(
      schema({ a: { kind: "string", section: "one" }, loose: { kind: "boolean" }, b: { kind: "object", section: "two" } }),
    );
    assert.deepEqual(parts?.at(-1), { id: "more", label: "More settings", keys: ["loose"] });
  });

  test("the last part does not take an id a module already uses", () => {
    const parts = settingsSections(
      schema({ a: { kind: "string", section: "more" }, b: { kind: "string", section: "two" }, c: { kind: "boolean" } }),
    );
    assert.equal(parts?.at(-1)?.id, "more-settings");
  });

  test("labels read as words", () => {
    assert.equal(sectionLabel("autoClose"), "Auto close");
    assert.equal(sectionLabel("ticket_types"), "Ticket types");
  });
});

describe("errors and sections", () => {
  const parts = settingsSections(
    schema({ panels: { kind: "array", section: "panels" }, general: { kind: "object", section: "general" } }),
  )!;

  test("an error path belongs to its top-level setting", () => {
    assert.equal(topKeyOf("panels[0].types[2].name"), "panels");
    assert.equal(topKeyOf("general.ticketLimit"), "general");
    assert.equal(topKeyOf("enabled"), "enabled");
  });

  test("counts failing fields per section", () => {
    assert.deepEqual(sectionErrorCounts(parts, { "panels[0].name": "x", "panels[1].channel": "y", "general.ticketLimit": "z" }), {
      panels: 2,
      general: 1,
    });
  });

  test("stays on the current section when it holds a failure, otherwise moves to the first that does", () => {
    assert.equal(sectionForErrors(parts, { "general.a": "x", "panels[0].b": "y" }, "general"), "general");
    assert.equal(sectionForErrors(parts, { "general.a": "x" }, "panels"), "general");
    assert.equal(sectionForErrors(parts, {}, "panels"), "panels");
  });
});

describe("sectionFromHash", () => {
  const parts = settingsSections(
    schema({ panels: { kind: "array", section: "panels" }, general: { kind: "object", section: "general" } }),
  )!;

  test("names a section directly", () => {
    assert.equal(sectionFromHash("#section-general", parts), "general");
  });

  test("finds the section of a card", () => {
    assert.equal(sectionFromHash("#group-general", parts), "general");
  });

  test("accepts the page's own extra entries", () => {
    assert.equal(sectionFromHash("#section-commands", parts, ["commands"]), "commands");
  });

  test("ignores anything else", () => {
    assert.equal(sectionFromHash("#section-nope", parts), undefined);
    assert.equal(sectionFromHash("#top", parts), undefined);
    assert.equal(sectionFromHash("", parts), undefined);
  });
});
