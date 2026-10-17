/**
 * Which clicks leave the page, for the unsaved-changes guard. A link the
 * browser handles by loading a new document is already covered by
 * `beforeunload`; this is about links the app router follows without one,
 * which the browser never warns about.
 *
 * Kept free of React and of the DOM types' runtime so the tests can use plain
 * objects.
 */

export interface LinkClick {
  /** The anchor's `href` attribute, as written. */
  href: string | null;
  target: string | null;
  download: boolean;
  /** 0 for the main button. */
  button: number;
  /** Ctrl, Meta, Shift or Alt was held, which opens a tab or a window instead. */
  modified: boolean;
  defaultPrevented: boolean;
  /** The link, or something around it, opted out with `data-unsaved-guard="ignore"`. */
  ignored?: boolean;
}

/**
 * The in-app address a click would take this tab to, or null when the click
 * does not leave the page: a new tab, a download, another site, a `mailto:`,
 * or a jump to a heading on the same page.
 */
export function leavingTo(click: LinkClick, current: string): string | null {
  if (click.defaultPrevented || click.ignored) return null;
  if (click.button !== 0 || click.modified || click.download) return null;
  if (click.target && click.target !== "_self") return null;
  if (click.href === null || click.href.trim() === "") return null;

  let here: URL;
  let there: URL;
  try {
    here = new URL(current);
    there = new URL(click.href, here);
  } catch {
    return null;
  }
  if (there.protocol !== "http:" && there.protocol !== "https:") return null;
  // Another site is a full page load, which beforeunload already asks about.
  if (there.origin !== here.origin) return null;
  if (there.pathname === here.pathname && there.search === here.search) return null;
  return `${there.pathname}${there.search}${there.hash}`;
}
