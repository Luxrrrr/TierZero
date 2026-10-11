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
  label: string;
}

/** Blank means "nobody has filled this in", which is not the same as false or 0. */
export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Every `essential` field in the schema that has nothing in it.
 *
 * Objects are walked, arrays are not: an essential field inside a repeating row
 * would be a per-row error, which the save already reports against that row.
 */
export function missingEssentials(
  schema: FieldDescriptor,
  settings: unknown,
): MissingEssential[] {
  const found: MissingEssential[] = [];
  collect(schema, settings, "", found);
  return found;
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
): void {
  if (field.kind !== "object") return;

  const fields = field.fields as Record<string, FieldDescriptor> | undefined;
  if (!fields) return;

  const source = isRecord(value) ? value : {};
  for (const [key, child] of Object.entries(fields)) {
    const childPath = path ? `${path}.${key}` : key;
    const childValue = source[key];
    if (child.essential === true && isBlank(childValue)) {
      found.push({ path: childPath, label: labelOf(child, key) });
    }
    collect(child, childValue, childPath, found);
  }
}

function labelOf(field: FieldDescriptor, key: string): string {
  if (typeof field.label === "string" && field.label.length > 0) return field.label;
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
