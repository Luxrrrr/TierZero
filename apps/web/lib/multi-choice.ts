/**
 * The rules behind a list of options where several can be on at once, such as
 * the actions an automod rule takes. Pure, so the control stays a thin shell
 * and the limits can be tested without rendering anything.
 */

export interface ChoiceLimits {
  min?: number;
  max?: number;
}

export type ToggleBlock = "min" | "max";

export interface ToggleResult {
  next: string[];
  /** Set when the press was refused, so the control can say why. */
  blocked?: ToggleBlock;
}

/**
 * Puts a stored value in the order the options are declared in and drops
 * repeats and anything that is no longer an option. Picking from a fixed set
 * cannot repeat an option, so a schema's `unique` needs nothing beyond this,
 * and the saved order does not depend on the order somebody clicked in.
 */
export function normalizeSelection(values: readonly string[], order: readonly string[]): string[] {
  const picked = new Set(values);
  return order.filter((value) => picked.has(value));
}

export function toggleChoice(
  selected: readonly string[],
  value: string,
  order: readonly string[],
  limits: ChoiceLimits = {},
): ToggleResult {
  const current = normalizeSelection(selected, order);

  if (current.includes(value)) {
    if (limits.min !== undefined && current.length - 1 < limits.min) {
      return { next: current, blocked: "min" };
    }
    return { next: current.filter((entry) => entry !== value) };
  }

  if (limits.max !== undefined && current.length + 1 > limits.max) {
    return { next: current, blocked: "max" };
  }
  return { next: normalizeSelection([...current, value], order) };
}

/** Order does not matter to whether two selections are the same. */
export function sameSelection(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

export function blockMessage(block: ToggleBlock, limits: ChoiceLimits): string {
  if (block === "min") {
    const min = limits.min ?? 1;
    return min <= 1 ? "Pick at least one." : `Pick at least ${min}.`;
  }
  const max = limits.max ?? 1;
  return max === 1 ? "Only one can be picked." : `Only ${max} can be picked.`;
}
