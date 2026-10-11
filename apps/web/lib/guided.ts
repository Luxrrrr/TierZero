/**
 * Quick setup: the short path through a feature for someone who does not yet
 * know what any of the settings mean.
 *
 * A module opts in by tagging fields `guided` in its schema, exactly as it
 * tags `essential`. Nothing here knows what any particular module does. The
 * wizard renders whatever comes back through the same form renderer the full
 * settings page uses, so a new module gets a quick setup without a line of
 * dashboard code.
 *
 * Kept free of anything that needs a bundler so the tests can import it
 * directly.
 */

import type { FieldCondition, FieldDescriptor } from "@tier0/core";

type Fields = Record<string, FieldDescriptor>;

/** A named run through several features, offered on the quick setup hub. */
export interface GuidedFlow {
  id: string;
  title: string;
  /** One line on the hub card, in the voice of what the operator gets. */
  blurb: string;
  /** Module ids, in the order the wizard visits them. */
  modules: string[];
}

/**
 * The bundles worth doing in one sitting. A feature not named here is still
 * reachable on its own from its settings page; these exist because moderation
 * without automod, or a ticket panel with nowhere to put the channels, is a
 * half-configured server rather than a finished one.
 */
export const FLOWS: GuidedFlow[] = [
  {
    id: "moderation",
    title: "Moderation",
    blurb:
      "Choose where moderator actions are recorded, how warnings and timeouts behave, and which messages get filtered automatically.",
    modules: ["moderation", "automod"],
  },
  {
    id: "tickets",
    title: "Tickets",
    blurb:
      "Put up the panel members press for help, choose where their private channels are created, and say who can answer them.",
    modules: ["tickets"],
  },
];

export function flowById(id: string): GuidedFlow | undefined {
  return FLOWS.find((flow) => flow.id === id);
}

/**
 * The flows worth showing for one server, with modules this install does not
 * have dropped. A bundle whose modules are all missing is not offered at all.
 */
export function availableFlows(moduleIds: readonly string[]): GuidedFlow[] {
  const present = new Set(moduleIds);
  return FLOWS.map((flow) => ({
    ...flow,
    modules: flow.modules.filter((id) => present.has(id)),
  })).filter((flow) => flow.modules.length > 0);
}

/** Whether a module has anything to ask about, and so a quick setup at all. */
export function hasGuidedSetup(schema: FieldDescriptor): boolean {
  return guidedProjection(schema) !== null;
}

/**
 * The dotted paths of every field the quick setup asks about: those tagged
 * `guided`, plus every `essential` one, which is asked whether or not it is
 * tagged because the feature does nothing until it is filled in.
 *
 * Objects are walked, arrays are not, matching `missingEssentials`. A setting
 * that only exists inside a repeating row is too much to put in front of
 * someone who has not decided how many rows they want yet.
 */
export function guidedPaths(schema: FieldDescriptor): string[] {
  const selected = new Set<string>();
  collect(schema, "", selected);
  expandConditions(schema, selected);
  return orderPaths(schema, selected);
}

/**
 * The schema reduced to the fields the quick setup asks about, keeping the
 * nesting and the group labels so the form renderer draws the same cards it
 * would on the full page. Null when a module has tagged nothing.
 *
 * Settings left out are not lost: the wizard edits the module's whole settings
 * object and sends it back intact, so anything it does not draw rides along
 * untouched.
 */
export function guidedProjection(schema: FieldDescriptor): FieldDescriptor | null {
  const selected = new Set<string>();
  collect(schema, "", selected);
  expandConditions(schema, selected);
  return project(schema, "", selected);
}

/** The field at a dotted path, for callers that need its label or condition. */
export function fieldAt(schema: FieldDescriptor, path: string): FieldDescriptor | undefined {
  if (path === "") return schema;
  let current: FieldDescriptor | undefined = schema;
  for (const segment of path.split(".")) {
    const fields = current?.fields as Fields | undefined;
    current = fields?.[segment];
    if (!current) return undefined;
  }
  return current;
}

function collect(field: FieldDescriptor, path: string, selected: Set<string>): void {
  if (field.kind !== "object") return;
  const fields = field.fields as Fields | undefined;
  if (!fields) return;

  for (const [key, child] of Object.entries(fields)) {
    const childPath = path ? `${path}.${key}` : key;
    if (child.essential === true || child.guided === true) selected.add(childPath);
    collect(child, childPath, selected);
  }
}

/**
 * Pulls in any sibling a selected field's `when` names. Without this the
 * wizard can draw a control greyed out with the switch that would enable it
 * left behind on the full settings page, which is a dead end.
 */
function expandConditions(schema: FieldDescriptor, selected: Set<string>): void {
  for (;;) {
    let added = false;
    for (const path of [...selected]) {
      const condition = fieldAt(schema, path)?.when as FieldCondition | undefined;
      if (!condition) continue;

      const siblingPath = siblingOf(path, condition.field);
      if (selected.has(siblingPath)) continue;
      if (!fieldAt(schema, siblingPath)) continue;

      selected.add(siblingPath);
      added = true;
    }
    if (!added) return;
  }
}

function siblingOf(path: string, name: string): string {
  const cut = path.lastIndexOf(".");
  return cut === -1 ? name : `${path.slice(0, cut)}.${name}`;
}

function project(
  field: FieldDescriptor,
  path: string,
  selected: Set<string>,
): FieldDescriptor | null {
  if (field.kind !== "object") return selected.has(path) ? field : null;

  const fields = field.fields as Fields | undefined;
  if (!fields) return null;

  const kept: Fields = {};
  for (const [key, child] of Object.entries(fields)) {
    const childPath = path ? `${path}.${key}` : key;
    const projected = project(child, childPath, selected);
    if (projected) kept[key] = projected;
  }

  if (Object.keys(kept).length === 0) return null;
  return { ...field, fields: kept };
}

/** Selected paths in the order the schema declares them, parents before children. */
function orderPaths(schema: FieldDescriptor, selected: Set<string>): string[] {
  const ordered: string[] = [];
  walk(schema, "");
  return ordered;

  function walk(field: FieldDescriptor, path: string): void {
    if (field.kind !== "object") return;
    const fields = field.fields as Fields | undefined;
    if (!fields) return;
    for (const [key, child] of Object.entries(fields)) {
      const childPath = path ? `${path}.${key}` : key;
      if (selected.has(childPath)) ordered.push(childPath);
      walk(child, childPath);
    }
  }
}
