/**
 * Where a context menu goes and which keys open one, kept free of the DOM so
 * both can be tested. The component measures the menu and the window and
 * passes the numbers in.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  /** Set only when the menu is taller than the window, which then scrolls inside itself. */
  maxHeight: number | null;
  originX: "left" | "right";
  originY: "top" | "bottom";
}

export const MENU_MARGIN = 8;

/**
 * Opens down and to the right of the point, flips to the other side of it
 * when there is no room, and as a last resort is pushed back inside the window.
 */
export function placeMenu(anchor: Point, size: Size, viewport: Size, margin = MENU_MARGIN): Placement {
  const room = Math.max(0, viewport.height - margin * 2);
  const tooTall = size.height > room;
  const height = tooTall ? room : size.height;
  const width = Math.min(size.width, Math.max(0, viewport.width - margin * 2));

  let left: number;
  let originX: Placement["originX"] = "left";
  if (anchor.x + width + margin <= viewport.width) {
    left = anchor.x;
  } else if (anchor.x - width >= margin) {
    left = anchor.x - width;
    originX = "right";
  } else {
    left = Math.max(margin, viewport.width - width - margin);
  }

  let top: number;
  let originY: Placement["originY"] = "top";
  if (anchor.y + height + margin <= viewport.height) {
    top = anchor.y;
  } else if (anchor.y - height >= margin) {
    top = anchor.y - height;
    originY = "bottom";
  } else {
    top = Math.max(margin, viewport.height - height - margin);
  }

  return { left, top, maxHeight: tooTall ? room : null, originX, originY };
}

export interface KeyLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** The context menu key, or Shift+F10, which is what keyboards without that key send. */
export function isContextMenuKey(event: KeyLike): boolean {
  if (event.key === "ContextMenu") return true;
  return event.key === "F10" && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
}

/**
 * Whether a contextmenu event came from the keyboard rather than a mouse.
 * Browsers report such an event at 0,0 or at the element, and a mouse never
 * clicks exactly at the corner of the window.
 */
export function isKeyboardContextMenu(event: { clientX: number; clientY: number }): boolean {
  return event.clientX === 0 && event.clientY === 0;
}

/**
 * The item to move to for a letter typed in the menu: the next one after the
 * current that starts with it, wrapping round. -1 when none does.
 */
export function typeAheadIndex(labels: readonly string[], current: number, letter: string): number {
  const wanted = letter.toLowerCase();
  if (wanted.length !== 1 || wanted === " ") return -1;
  for (let step = 1; step <= labels.length; step += 1) {
    const index = (Math.max(current, -1) + step) % labels.length;
    if (labels[index]?.toLowerCase().startsWith(wanted)) return index;
  }
  return -1;
}
