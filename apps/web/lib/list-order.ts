/**
 * Moving and copying rows of a list setting. The row order is what members see
 * where a list becomes buttons, so it has to be changeable without deleting
 * and re-adding rows. Anything kept per row by position, such as which rows are
 * open, moves with them.
 *
 * Kept free of React and of the dashboard's other modules so the tests can
 * import it directly.
 */

/** The list with one entry moved from `from` to `to`; the same list when either is out of range. */
export function moved<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items];
  const next = [...items];
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry as T);
  return next;
}

/** Where the row at `index` ends up after the move. */
export function indexAfterMove(index: number, from: number, to: number): number {
  if (index === from) return to;
  if (from < to && index > from && index <= to) return index - 1;
  if (from > to && index >= to && index < from) return index + 1;
  return index;
}

export function setAfterMove(set: ReadonlySet<number>, from: number, to: number): Set<number> {
  return new Set([...set].map((index) => indexAfterMove(index, from, to)));
}

/** Rows after `index` shift down by one to make room for the copy placed right after it. */
export function setAfterInsert(set: ReadonlySet<number>, at: number): Set<number> {
  return new Set([...set].map((index) => (index >= at ? index + 1 : index)));
}

/**
 * A copy of a row placed right after it. `copy` makes the copy: a generated id
 * names a row for the records that point at it, so the caller hands in what
 * gives the copy fresh ones rather than sharing them.
 */
export function duplicated<T>(items: readonly T[], index: number, copy: (item: T) => T): T[] {
  const source = items[index];
  if (source === undefined) return [...items];
  const next = [...items];
  next.splice(index + 1, 0, copy(structuredClone(source)));
  return next;
}
