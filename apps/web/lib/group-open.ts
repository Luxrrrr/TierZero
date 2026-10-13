/**
 * Which collapsible groups of a settings page are open. The open set is plain
 * local UI state; everything that decides what goes into it lives here so it
 * can be tested without rendering a page.
 */

interface ChildShape {
  kind: string;
  min?: unknown;
  essential?: unknown;
  default?: unknown;
}

/** `invites.actions` and `invites[0]` both belong to the group `invites`. */
export function groupOfPath(path: string): string {
  const end = path.search(/[.[]/);
  return end === -1 ? path : path.slice(0, end);
}

/** The groups, among `keys`, that hold a validation error. */
export function groupsWithErrors(errors: Record<string, string>, keys: readonly string[]): string[] {
  const failing = new Set(Object.keys(errors).map(groupOfPath));
  return keys.filter((key) => failing.has(key));
}

/** A link to `#invites` or to the section's own id, `#group-invites`, names that group. */
export function hashTarget(hash: string, keys: readonly string[]): string | undefined {
  const name = hash.replace(/^#/, "");
  if (name === "") return undefined;
  return keys.find((key) => name === key || name === `group-${key}`);
}

export function withOpen(open: ReadonlySet<string>, keys: Iterable<string>): Set<string> {
  const next = new Set(open);
  for (const key of keys) next.add(key);
  return next;
}

export function toggled(open: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(open);
  if (!next.delete(key)) next.add(key);
  return next;
}

/**
 * Runs of two or more collapsible groups side by side, in page order. A lone
 * collapsible group has nothing to expand along with, so it gets no control.
 */
export function collapsibleRuns(items: readonly { key: string; collapsible: boolean }[]): string[][] {
  const runs: string[][] = [];
  let current: string[] = [];
  for (const item of items) {
    if (item.collapsible) {
      current.push(item.key);
      continue;
    }
    if (current.length > 1) runs.push(current);
    current = [];
  }
  if (current.length > 1) runs.push(current);
  return runs;
}

/** True once every group of the run is open, which is when the control offers to close them. */
export function runIsOpen(open: ReadonlySet<string>, run: readonly string[]): boolean {
  return run.length > 0 && run.every((key) => open.has(key));
}

/** Opens every group of the run, or closes them all when they are already open. */
export function toggleRun(open: ReadonlySet<string>, run: readonly string[]): Set<string> {
  const next = new Set(open);
  const close = runIsOpen(open, run);
  for (const key of run) {
    if (close) next.delete(key);
    else next.add(key);
  }
  return next;
}

function blank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Whether a group has something the owner has to fill in before it does
 * anything: a list that must hold at least one entry, or a setting the module
 * marks essential, still empty.
 */
export function needsAttention(fields: Record<string, ChildShape>, values: Record<string, unknown>): boolean {
  return Object.entries(fields).some(([key, field]) => {
    if (field.kind === "boolean" || field.kind === "object") return false;
    const current = values[key] ?? field.default;
    if (field.kind === "array" && typeof field.min === "number" && field.min >= 1) return blank(current);
    return field.essential === true && blank(current);
  });
}

/** Switching a group on opens it when it cannot work as it stands. */
export function opensOnEnable(
  switchedOn: boolean,
  fields: Record<string, ChildShape>,
  values: Record<string, unknown>,
): boolean {
  return switchedOn && needsAttention(fields, values);
}
