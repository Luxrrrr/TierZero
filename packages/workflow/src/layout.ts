/**
 * The shape of a list of steps that has if, else and end if in it. The steps are
 * one flat list, so this works out which else and end belong to which if, and is
 * forgiving about a list that does not close properly: an if that is never
 * ended runs to the end of the list, and an else or end with no if is skipped.
 */

export const IF_STEPS = ["ifRole", "ifChannel", "ifWords", "ifVariable", "ifChance"] as const;

export const isIf = (type: string): boolean => (IF_STEPS as readonly string[]).includes(type);

export interface Layout {
  /** For an if, the index of its else, or -1. */
  elseOf: number[];
  /** For an if or an else, the index of the end that closes it, or the length of the list when nothing does. */
  endOf: number[];
  /** How deep each step sits, for drawing it indented. */
  depth: number[];
  /** Whether each else or end belongs to an if. */
  matched: boolean[];
}

/** Nested ifs deeper than this are read as if they were not there. */
export const MAX_DEPTH = 6;

export function layoutOf(types: readonly string[]): Layout {
  const count = types.length;
  const elseOf = new Array<number>(count).fill(-1);
  const endOf = new Array<number>(count).fill(count);
  const depth = new Array<number>(count).fill(0);
  const matched = new Array<boolean>(count).fill(true);
  const open: { at: number; seenElse: boolean }[] = [];

  types.forEach((type, index) => {
    if (isIf(type)) {
      depth[index] = open.length;
      open.push({ at: index, seenElse: false });
    } else if (type === "else") {
      const top = open[open.length - 1];
      if (!top || top.seenElse) {
        matched[index] = false;
        depth[index] = open.length;
        return;
      }
      top.seenElse = true;
      elseOf[top.at] = index;
      depth[index] = open.length - 1;
    } else if (type === "endif") {
      const top = open.pop();
      if (!top) {
        matched[index] = false;
        depth[index] = 0;
        return;
      }
      endOf[top.at] = index;
      const otherwise = elseOf[top.at];
      if (otherwise !== undefined && otherwise !== -1) endOf[otherwise] = index;
      depth[index] = open.length;
    } else {
      depth[index] = open.length;
    }
  });
  return { elseOf, endOf, depth, matched };
}
