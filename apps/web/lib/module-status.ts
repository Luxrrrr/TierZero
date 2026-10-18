/**
 * Whether a module is actually doing anything, as opposed to merely being
 * switched on. A feature that is on but missing the one setting it cannot work
 * without should say so, rather than sit there looking configured.
 *
 * Kept free of anything that needs a bundler so the tests can import it
 * directly.
 */

import type { FieldDescriptor } from "@tier0/core";

export type ModuleStatus = "on" | "off" | "attention";

export interface MissingEssential {
  path: string;
  /** "Log channel", or for a set "Channel to greet in, Roles to give or Direct message". */
  label: string;
  /** Set when any one of several settings would do, named by `label` together. */
  anyOf?: string[];
}

/** Blank means "nobody has filled this in", which is not the same as false or 0. */
export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Filled in, for a member of an `essential` set: a switch only counts while it is on. */
export function isSetForGroup(value: unknown): boolean {
  if (value === false) return false;
  return !isBlank(value);
}

interface GroupMember {
  path: string;
  label: string;
  filled: boolean;
}

/**
 * Every `essential` field in the schema that has nothing in it, and every
 * essential set none of whose settings is filled in. A set is reported once,
 * where its first member sits, naming all of them.
 *
 * Objects are walked. A list is walked only when it is itself `essential: true`,
 * which says the feature runs on its rows (tickets run on panels): then each
 * row's own essential fields count, so a row nobody finished does not read as
 * set up. A setting whose `when` condition is not met is not asked for.
 */
export function missingEssentials(
  schema: FieldDescriptor,
  settings: unknown,
): MissingEssential[] {
  const found: MissingEssential[] = [];
  const groups = new Map<string, GroupMember[]>();
  collect(schema, settings, "", found, groups);
  for (const members of groups.values()) {
    if (members.some((member) => member.filled)) continue;
    const first = members[0];
    if (!first) continue;
    const names = members.map((member) => member.label);
    found.push({ path: first.path, label: joinOr(names), anyOf: names });
  }
  return found;
}

/** "A", "A or B", "A, B or C". */
export function joinOr(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** The sentence a status callout ends with: what to set before the feature does anything. */
export function missingSentence(missing: readonly MissingEssential[]): string {
  const single = missing.filter((entry) => !entry.anyOf).map((entry) => entry.label);
  const sets = missing.filter((entry) => entry.anyOf).map((entry) => `one of ${entry.label}`);
  if (sets.length === 0) return single.join(", ");
  return [single.join(", "), ...sets].filter(Boolean).join(", and ");
}

export function moduleStatus(enabled: boolean, missing: MissingEssential[]): ModuleStatus {
  if (!enabled) return "off";
  return missing.length > 0 ? "attention" : "on";
}

function collect(
  field: FieldDescriptor,
  value: unknown,
  path: string,
  found: MissingEssential[],
  groups: Map<string, GroupMember[]>,
  groupLabel?: string,
): void {
  if (field.kind !== "object") return;

  const fields = field.fields as Record<string, FieldDescriptor> | undefined;
  if (!fields) return;

  const source = isRecord(value) ? value : {};
  const effective: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(fields)) effective[key] = source[key] === undefined ? child.default : source[key];
  for (const [key, child] of Object.entries(fields)) {
    const childPath = path ? `${path}.${key}` : key;
    if (!conditionHolds(child.when, effective)) continue;
    // A stored value is what the bot runs on; a key nobody saved yet runs on the default.
    const childValue = source[key] === undefined ? child.default : source[key];
    if (child.essential === true && isBlank(childValue)) {
      found.push({ path: childPath, label: labelOf(child, key) });
    } else if (typeof child.essential === "string" && child.essential !== "") {
      const members = groups.get(child.essential) ?? [];
      // A group's own switch is labelled "On"; the group's name says which one it is.
      const own = key === "enabled" && child.kind === "boolean" && groupLabel ? groupLabel : labelOf(child, key);
      members.push({ path: childPath, label: own, filled: isSetForGroup(childValue) });
      groups.set(child.essential, members);
    }
    collect(child, source[key], childPath, found, groups, labelOf(child, key));
    if (child.kind === "array" && child.essential === true && Array.isArray(source[key])) {
      collectRows(child, source[key] as unknown[], childPath, found);
    }
  }
}

/** The essential settings of a list's rows, named after the list and reported once each however many rows lack them. */
function collectRows(list: FieldDescriptor, rows: unknown[], path: string, found: MissingEssential[]): void {
  const item = list.of as FieldDescriptor | undefined;
  if (!item || item.kind !== "object") return;
  const seen = new Set(found.map((entry) => entry.label));
  rows.forEach((row, index) => {
    const inRow: MissingEssential[] = [];
    collect(item, row, `${path}.${index}`, inRow, new Map());
    for (const entry of inRow) {
      const label = `${labelOf(list, "")}: ${entry.label}`;
      if (seen.has(label)) continue;
      seen.add(label);
      found.push({ ...entry, label });
    }
  });
}

/** The same rule as the form's own condition check, kept here so the tests can import this file alone. */
function conditionHolds(when: unknown, values: Record<string, unknown>): boolean {
  if (!isRecord(when) || typeof when.field !== "string") return true;
  const actual = values[when.field];
  if (when.includes !== undefined) return Array.isArray(actual) && actual.includes(when.includes);
  if (when.equals !== undefined) return actual === when.equals;
  return !isBlank(actual);
}

function labelOf(field: FieldDescriptor, key: string): string {
  if (typeof field.label === "string" && field.label.length > 0) return field.label;
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
