/**
 * The side navigation's collapsed preference. The inline script in the root
 * layout reads the same key and sets `data-sidebar` on the document before
 * first paint, so the stylesheet can draw the right width without waiting for
 * React.
 */

export type SidebarMode = "expanded" | "collapsed";

export const SIDEBAR_STORAGE_KEY = "tierzero-sidebar";

export const SIDEBAR_ATTRIBUTE = "data-sidebar";

export function parseSidebarMode(raw: string | null | undefined): SidebarMode {
  return raw === "collapsed" ? "collapsed" : "expanded";
}

export function toggledMode(mode: SidebarMode): SidebarMode {
  return mode === "collapsed" ? "expanded" : "collapsed";
}

export interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
}

/**
 * Ctrl+B, or Cmd+B on a Mac. Never a bare key, and never with extra
 * modifiers, which belong to the browser and the platform.
 */
export function isSidebarShortcut(event: ShortcutEvent): boolean {
  if (event.repeat) return false;
  if (event.altKey || event.shiftKey) return false;
  if (event.ctrlKey === event.metaKey) return false;
  return event.key.toLowerCase() === "b";
}

export function shortcutLabel(mac: boolean): string {
  return mac ? "⌘B" : "Ctrl+B";
}
