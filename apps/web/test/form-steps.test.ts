import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { FieldDescriptor } from "@tier0/core";
import { declaredSteps, stepGroups } from "../lib/form-steps.ts";

const steps = [
  { id: "where", title: "Where it goes", help: "Pick a channel." },
  { id: "see", title: "What members see" },
  { id: "types", title: "Ticket types" },
];

const fields: Record<string, FieldDescriptor> = {
  name: { kind: "string", step: "where" },
  channel: { kind: "channel", step: "where" },
  style: { kind: "choice", step: "where" },
  message: { kind: "message", step: "see" },
  types: { kind: "array", step: "types" },
  id: { kind: "string", generated: true },
};

describe("stepGroups", () => {
  test("sorts the settings into their steps in schema order, leaving out generated ids", () => {
    const groups = stepGroups(fields, steps);
    assert.deepEqual(
      groups.map((group) => [group.step.id, group.keys]),
      [
        ["where", ["name", "channel", "style"]],
        ["see", ["message"]],
        ["types", ["types"]],
      ],
    );
  });

  test("puts a setting that names no step, or an unknown one, in the first", () => {
    const loose = { a: { kind: "string" }, b: { kind: "string", step: "nowhere" }, c: { kind: "string", step: "see" } } as Record<string, FieldDescriptor>;
    const groups = stepGroups(loose, steps);
    assert.deepEqual(
      groups.map((group) => [group.step.id, group.keys]),
      [
        ["where", ["a", "b"]],
        ["see", ["c"]],
      ],
    );
  });

  test("leaves out a step with nothing in it", () => {
    assert.deepEqual(
      stepGroups({ a: { kind: "string", step: "types" } }, steps).map((group) => group.step.id),
      ["types"],
    );
  });

  test("is empty without steps", () => {
    assert.deepEqual(stepGroups(fields, []), []);
  });
});

describe("declaredSteps", () => {
  test("reads the steps a group declares and ignores anything malformed", () => {
    assert.equal(declaredSteps({ kind: "object", steps } as unknown as FieldDescriptor).length, 3);
    assert.deepEqual(declaredSteps({ kind: "object" }), []);
    assert.deepEqual(declaredSteps({ kind: "object", steps: [{ id: 1 }, null, "x"] } as unknown as FieldDescriptor), []);
  });
});
