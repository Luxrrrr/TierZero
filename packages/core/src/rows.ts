import type { RowRef } from "./module.js";

interface Step {
  key: string;
  index: number | null;
}

const STEP = /^([A-Za-z_$][\w$]*)(?:\[(\d+)\])?$/;

/** Reads `patchNotes.destinations[0].games[1]`, the shape validation errors already use. */
function parsePath(path: string): Step[] | null {
  const steps: Step[] = [];
  for (const part of path.split(".")) {
    const match = STEP.exec(part);
    if (!match || match[1] === undefined) return null;
    steps.push({ key: match[1], index: match[2] === undefined ? null : Number(match[2]) });
  }
  return steps.length > 0 ? steps : null;
}

/** The path with its indices removed, which is how a module keys its row hooks. */
export function schemaPathOf(path: string): string | null {
  const steps = parsePath(path);
  return steps ? steps.map((step) => step.key).join(".") : null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Walks to the object that holds the last step's list, following every index on the way. */
function parentOf(settings: unknown, steps: Step[]): Record<string, unknown> | null {
  let current: unknown = settings;
  for (const step of steps.slice(0, -1)) {
    if (!isRecord(current)) return null;
    current = current[step.key];
    if (step.index !== null) {
      if (!Array.isArray(current)) return null;
      current = current[step.index];
    }
  }
  return isRecord(current) ? current : null;
}

/** One row of a list, found by its indexed path. Null when the path does not lead to one. */
export function resolveRow(settings: unknown, path: string): RowRef | null {
  const steps = parsePath(path);
  const last = steps?.at(-1);
  if (!steps || !last || last.index === null) return null;

  const parent = parentOf(settings, steps);
  const list = parent?.[last.key];
  if (!parent || !Array.isArray(list)) return null;

  const row = list[last.index];
  return isRecord(row) ? { path, row, parent } : null;
}

/** Every row of a list, found by the list's indexed path. Null when it does not lead to a list. */
export function resolveList(settings: unknown, path: string): RowRef[] | null {
  const steps = parsePath(path);
  const last = steps?.at(-1);
  if (!steps || !last || last.index !== null) return null;

  const parent = parentOf(settings, steps);
  const list = parent?.[last.key];
  if (!parent || !Array.isArray(list)) return null;

  return list.flatMap((row, index) =>
    isRecord(row) ? [{ path: `${path}[${index}]`, row, parent }] : [],
  );
}
