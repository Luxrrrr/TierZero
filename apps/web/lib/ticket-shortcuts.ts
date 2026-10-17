/**
 * The inbox's keyboard shortcuts, as plain data and decisions so the tests
 * can check them without a browser.
 */

export type TicketShortcut = "next" | "previous" | "claim" | "reply" | "search" | "help";

export const TICKET_SHORTCUTS: readonly { keys: string[]; action: TicketShortcut; does: string }[] = [
  { keys: ["j"], action: "next", does: "Open the next ticket in the list" },
  { keys: ["k"], action: "previous", does: "Open the previous ticket" },
  { keys: ["c"], action: "claim", does: "Claim the open ticket" },
  { keys: ["r"], action: "reply", does: "Write a reply" },
  { keys: ["/"], action: "search", does: "Search tickets" },
  { keys: ["?"], action: "help", does: "Show or hide this list" },
];

const BY_KEY = new Map<string, TicketShortcut>(TICKET_SHORTCUTS.flatMap((entry) => entry.keys.map((key) => [key, entry.action] as const)));

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** Where focus was when the key was pressed. */
  target: { tagName?: string; isContentEditable?: boolean; type?: string } | null;
}

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const BUTTON_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset"]);

/** Whether a key press is someone typing rather than a command: in a field, or with Ctrl, Cmd or Alt held. */
export function isTyping(event: KeyLike): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return true;
  const target = event.target;
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toUpperCase() ?? "";
  if (tag === "INPUT") return !BUTTON_INPUTS.has((target.type ?? "text").toLowerCase());
  return TYPING_TAGS.has(tag);
}

/** The shortcut a key press asks for, or null when it is not one or the person is typing. */
export function shortcutFor(event: KeyLike): TicketShortcut | null {
  if (isTyping(event)) return null;
  return BY_KEY.get(event.key) ?? null;
}

/**
 * The row j or k lands on. From no selection, j starts at the top and k at
 * the bottom; at either end it stays put rather than wrapping, so holding the
 * key cannot cycle past the ticket someone was looking for.
 */
export function stepRow(current: number, count: number, direction: 1 | -1): number | null {
  if (count <= 0) return null;
  if (current < 0 || current >= count) return direction === 1 ? 0 : count - 1;
  const next = current + direction;
  return next < 0 || next >= count ? null : next;
}
