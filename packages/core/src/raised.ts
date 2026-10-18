import { durationToMs, type FieldDescriptor } from "./schema.js";

type Fields = Record<string, FieldDescriptor>;

export interface RaisedDuration {
  /** The dotted, indexed path the dashboard keys the field by. */
  path: string;
  /** The minimum the stored value was raised to, written like "1m". */
  min: string;
}

/**
 * The durations in a module's stored settings that are below the minimum the
 * schema now declares. Reading settings raises them silently, so the bot and
 * the dashboard use the minimum while the database still holds the old value
 * until the next save; this lists them so the dashboard can say so.
 */
export function raisedDurations(schema: FieldDescriptor, stored: unknown): RaisedDuration[] {
  const found: RaisedDuration[] = [];
  const visit = (field: FieldDescriptor, value: unknown, path: string) => {
    if (field.kind === "duration") {
      const min = typeof field.min === "string" ? field.min : null;
      const floor = min === null ? null : durationToMs(min);
      if (min !== null && floor !== null && typeof value === "number" && Number.isFinite(value) && Math.max(0, Math.round(value)) < floor) {
        found.push({ path, min });
      }
    } else if (field.kind === "object") {
      const record = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
      for (const [key, child] of Object.entries((field.fields ?? {}) as Fields)) {
        visit(child, record[key], path ? `${path}.${key}` : key);
      }
    } else if (field.kind === "array" && Array.isArray(value)) {
      value.forEach((entry, index) => visit(field.of as FieldDescriptor, entry, `${path}[${index}]`));
    }
  };
  visit(schema, stored, "");
  return found;
}
