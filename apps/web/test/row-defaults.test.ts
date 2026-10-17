import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { FieldDescriptor } from "@tier0/core";
import { defaultsFor, editableEntries, isGenerated, makeRowId } from "../lib/row-defaults.ts";
import { summarizeRow, type RowLabels } from "../lib/row-summary.ts";

type Fields = Record<string, FieldDescriptor>;
const f = (fields: Record<string, Partial<FieldDescriptor>>) => fields as unknown as Fields;

const type = f({
  name: { kind: "string", default: "Support" },
  handlers: { kind: "array", of: { kind: "role" } as FieldDescriptor },
  form: { kind: "array", label: "Questions", of: { kind: "object", fields: { label: { kind: "string" } } } as unknown as FieldDescriptor },
  id: { kind: "string", generated: true },
});

const panel = f({
  name: { kind: "string", default: "Support" },
  types: { kind: "array", min: 1, of: { kind: "object", fields: type } as unknown as FieldDescriptor },
  id: { kind: "string", generated: true },
});

describe("generated ids", () => {
  test("only a string marked generated counts", () => {
    assert.equal(isGenerated({ kind: "string", generated: true } as FieldDescriptor), true);
    assert.equal(isGenerated({ kind: "string" } as FieldDescriptor), false);
    assert.equal(isGenerated({ kind: "integer", generated: true } as FieldDescriptor), false);
  });

  test("are left out of the fields a person edits", () => {
    assert.deepEqual(
      editableEntries(type).map(([key]) => key),
      ["name", "handlers", "form"],
    );
  });

  test("a new row gets a fresh id, and a list that needs a row starts with one", () => {
    let n = 0;
    const row = defaultsFor(panel, () => `id${(n += 1)}`);
    assert.equal(row.name, "Support");
    assert.equal(row.id, "id2");
    const types = row.types as Record<string, unknown>[];
    assert.equal(types.length, 1);
    assert.equal(types[0]?.id, "id1");
    assert.deepEqual(types[0]?.handlers, []);
    assert.deepEqual(types[0]?.form, []);
  });

  test("ids are eight hex characters, which the schema accepts", () => {
    const id = makeRowId();
    assert.match(id, /^[0-9a-f]{8}$/);
    assert.equal(makeRowId((bytes) => bytes.fill(255)), "ffffffff");
  });
});

describe("row summaries", () => {
  const labels: RowLabels = {
    channel: (id) => (id === "c1" ? "#support" : "unknown channel"),
    role: (id) => (id === "r1" ? "@Support Crew" : id === "r2" ? "@Moderators" : "unknown role"),
    duration: String,
  };

  test("never show a generated id, even when the name is empty", () => {
    const summary = summarizeRow({ name: "", id: "a1b2c3d4", handlers: [] }, type, labels);
    assert.equal(summary.title, undefined);
    assert.ok(!summary.detail.includes("a1b2c3d4"));
  });

  test("name the roles in a list of roles", () => {
    const summary = summarizeRow({ name: "Game support", handlers: ["r1", "r2"], form: [{}, {}], id: "x" }, type, labels);
    assert.equal(summary.title, "Game support");
    assert.equal(summary.detail, "@Support Crew, @Moderators · 2 questions");
  });

  test("leave out a setting whose condition is not met", () => {
    const fields = f({
      name: { kind: "string" },
      style: { kind: "choice", options: [{ value: "buttons", label: "Buttons" }, { value: "menu", label: "A menu" }] } as unknown as FieldDescriptor,
      placeholder: { kind: "string", when: { field: "style", equals: "menu" } } as unknown as FieldDescriptor,
    });
    assert.equal(summarizeRow({ name: "Main", style: "buttons", placeholder: "Pick one" }, fields, labels).detail, "Buttons");
    assert.equal(summarizeRow({ name: "Main", style: "menu", placeholder: "Pick one" }, fields, labels).detail, "A menu · Pick one");
  });

  test("skip a message made only of placeholders and mentions", () => {
    const fields = f({ name: { kind: "string" }, welcome: { kind: "message" } });
    const placeholders = { content: "{user} <@&123456789012345678>", embeds: [{ title: "{title}" }] };
    assert.equal(summarizeRow({ name: "A", welcome: placeholders }, fields, labels).detail, "");
    assert.equal(summarizeRow({ name: "A", welcome: { content: "", embeds: [{ title: "Need a hand?" }] } }, fields, labels).detail, "Need a hand?");
  });
});
