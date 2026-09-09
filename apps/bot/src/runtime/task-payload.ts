/**
 * Payload handling for scheduled work, kept free of imports so it can be
 * exercised on its own. Payloads are stored as JSON text because SQLite has no
 * JSON column, and anything read back has to survive a row written by an
 * older version of a module.
 */

export type TaskPayload = Record<string, unknown>;

export function parsePayload(text: string): TaskPayload {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as TaskPayload)
      : {};
  } catch {
    return {};
  }
}

/**
 * Checks that the given fields match, not that the payloads are identical.
 * That lets a caller cancel every pending unban for a member without knowing
 * what else was recorded alongside it.
 */
export function matchesPayload(payload: unknown, match: TaskPayload | undefined): boolean {
  if (!match) return true;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return false;
  const source = payload as TaskPayload;
  return Object.entries(match).every(([key, expected]) => source[key] === expected);
}

/** Kinds are namespaced by module so two modules may use the same name. */
export function namespaceKind(moduleId: string, kind: string): string {
  return `${moduleId}:${kind}`;
}

export function splitKind(namespaced: string): { moduleId: string; kind: string } | null {
  const separator = namespaced.indexOf(":");
  if (separator <= 0 || separator === namespaced.length - 1) return null;
  return {
    moduleId: namespaced.slice(0, separator),
    kind: namespaced.slice(separator + 1),
  };
}
