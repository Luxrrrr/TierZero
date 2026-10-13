/**
 * The parts of the dashboard's dropdown that do not need a browser: matching
 * typed letters to options, and deciding which side of the control the list
 * opens on.
 */

export interface TypeAheadState {
  text: string;
  at: number;
}

export const TYPE_AHEAD_WINDOW_MS = 700;

/** Typing again within the window extends the word; after it, a new word starts. */
export function nextTypeAhead(
  state: TypeAheadState,
  key: string,
  now: number,
  windowMs: number = TYPE_AHEAD_WINDOW_MS,
): TypeAheadState {
  const fresh = now - state.at > windowMs;
  return { text: (fresh ? "" : state.text) + key.toLowerCase(), at: now };
}

/** True for a key that adds a character, as opposed to Enter, Tab or an arrow. */
export function isTypeAheadKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): boolean {
  return event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey;
}

interface Matchable {
  label: string;
  disabled?: boolean;
}

/**
 * The option to move to for what has been typed, or -1. Search starts at the
 * active row, so pressing "s" twice walks through everything starting with "s";
 * a longer word is matched as a prefix starting from the active row.
 */
export function matchTypeAhead(options: readonly Matchable[], text: string, active: number): number {
  if (options.length === 0 || text === "") return -1;
  const needle = text.toLowerCase();
  const repeated = needle.length > 1 && [...needle].every((char) => char === needle[0]);
  const prefix = repeated ? needle[0] ?? needle : needle;
  // One repeated letter cycles forward from the next row; a word may stay put.
  const start = repeated || needle.length === 1 ? active + 1 : active;

  for (let step = 0; step < options.length; step += 1) {
    const index = (((start + step) % options.length) + options.length) % options.length;
    const option = options[index];
    if (option && !option.disabled && option.label.toLowerCase().startsWith(prefix)) return index;
  }
  return -1;
}

/** Moves to the next enabled row in a direction, stopping at the ends. */
export function stepEnabled(
  options: readonly { disabled?: boolean }[],
  from: number,
  delta: 1 | -1,
): number {
  for (let index = from + delta; index >= 0 && index < options.length; index += delta) {
    if (!options[index]?.disabled) return index;
  }
  return from;
}

export function firstEnabledIndex(options: readonly { disabled?: boolean }[]): number {
  const index = options.findIndex((option) => !option.disabled);
  return index === -1 ? 0 : index;
}

export function lastEnabledIndex(options: readonly { disabled?: boolean }[]): number {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (!options[index]?.disabled) return index;
  }
  return 0;
}

export type PopoverSide = "bottom" | "top";

/**
 * Opens downward unless the list would not fit there and there is more room
 * above. Space is measured to the edge of whatever would clip the list, which
 * is the window or a scrolling panel around the control.
 */
export function choosePopoverSide(room: {
  below: number;
  above: number;
  height: number;
}): PopoverSide {
  if (room.below >= room.height) return "bottom";
  return room.above > room.below ? "top" : "bottom";
}
