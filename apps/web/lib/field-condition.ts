/**
 * Whether a setting that depends on a sibling is currently in play. Kept free
 * of React and of the dashboard's other modules so the tests can import it
 * directly.
 *
 * - `includes` is met when the sibling holds a list that contains the value.
 * - `equals` is met when the sibling is exactly that value.
 * - With neither, the condition is met whenever the sibling holds anything.
 */
export interface Condition {
  field: string;
  equals?: unknown;
  includes?: unknown;
}

export function conditionMet(
  condition: Condition | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!condition) return true;
  const actual = values[condition.field];
  if (condition.includes !== undefined) {
    return Array.isArray(actual) && actual.includes(condition.includes);
  }
  if (condition.equals !== undefined) return actual === condition.equals;
  return !isBlank(actual);
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
