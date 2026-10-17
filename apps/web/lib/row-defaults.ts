import type { FieldDescriptor } from "@tier0/core";

/**
 * What a list row starts as when someone adds one. Free of React so the tests
 * can import it directly; the id maker is handed in for the same reason.
 */

type Fields = Record<string, FieldDescriptor>;

/** A string the dashboard fills in itself and never shows: a row's stable id. */
export function isGenerated(field: FieldDescriptor): boolean {
  return field.kind === "string" && field.generated === true;
}

/** The fields a person edits, which is every field but a generated id. */
export function editableEntries(fields: Fields): [string, FieldDescriptor][] {
  return Object.entries(fields).filter(([, field]) => !isGenerated(field));
}

/**
 * A new row with whatever the schema says the defaults are. A generated id
 * gets a fresh value. A list of rows that needs at least one starts with that
 * many, each built the same way, so a new panel arrives with a ticket type in
 * it rather than an error. A list of choices starts with its default picks.
 */
export function defaultsFor(fields: Fields, makeId: () => string): Record<string, unknown> {
  const item: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) {
    if (isGenerated(field)) {
      item[key] = makeId();
    } else if (field.kind === "array") {
      const of = (field.of ?? {}) as FieldDescriptor;
      const min = typeof field.min === "number" ? field.min : 0;
      if (of.kind === "choice" && Array.isArray(field.default)) item[key] = field.default;
      else if (of.kind === "object" && min > 0) {
        item[key] = Array.from({ length: min }, () => defaultsFor((of.fields ?? {}) as Fields, makeId));
      } else item[key] = [];
    } else if (field.kind === "object") item[key] = defaultsFor((field.fields ?? {}) as Fields, makeId);
    else if (field.default !== undefined) item[key] = field.default;
  }
  return item;
}

/**
 * A copy of a row with every generated id in it replaced, at any depth, so a
 * duplicated panel does not share its id, or its ticket types' ids, with the
 * row it was copied from.
 */
export function withFreshIds(value: unknown, fields: Fields, makeId: () => string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  const copy: Record<string, unknown> = { ...source };
  for (const [key, field] of Object.entries(fields)) {
    if (!(key in source)) continue;
    if (isGenerated(field)) {
      copy[key] = makeId();
    } else if (field.kind === "object") {
      copy[key] = withFreshIds(source[key], (field.fields ?? {}) as Fields, makeId);
    } else if (field.kind === "array" && Array.isArray(source[key])) {
      const of = (field.of ?? {}) as FieldDescriptor;
      copy[key] = of.kind === "object"
        ? (source[key] as unknown[]).map((entry) => withFreshIds(entry, (of.fields ?? {}) as Fields, makeId))
        : [...(source[key] as unknown[])];
    }
  }
  return copy;
}

/**
 * An eight-character id, the length `generatedId()` in core makes. Built from
 * `getRandomValues` because `randomUUID` only exists on a secure origin, and a
 * dashboard opened over plain http on a home network is not one.
 */
export function makeRowId(random: (bytes: Uint8Array) => Uint8Array = (bytes) => globalThis.crypto.getRandomValues(bytes)): string {
  return [...random(new Uint8Array(4))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
