/**
 * The saved light or dark choice and the collapsed sidebar, put on the
 * document before anything is painted. The collapsed sidebar is a width, so
 * applying it later would show the wide one for a frame and then snap.
 * Storage throws in a browser set to block it; the system preference and the
 * wide sidebar are then the right defaults.
 *
 * Self-contained on purpose: the root layout sends its source as an inline
 * script, and the same function runs on the client when there was no server
 * render to carry that script (see PrePaint.tsx).
 */
export function applyPrePaint(themeKey: string, sidebarKey: string, sidebarAttribute: string): void {
  try {
    const root = document.documentElement;
    const theme = localStorage.getItem(themeKey);
    if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
    else root.removeAttribute("data-theme");
    if (localStorage.getItem(sidebarKey) === "collapsed") root.setAttribute(sidebarAttribute, "collapsed");
  } catch {
    // Blocked storage: the defaults stand.
  }
}

/** The same key ThemeToggle writes the choice under. */
export const THEME_KEY = "tierzero-theme";

export type PrePaintArgs = [themeKey: string, sidebarKey: string, sidebarAttribute: string];

/** The function above as an inline script that calls itself with these keys. */
export function prePaintScript(args: PrePaintArgs): string {
  return `(${applyPrePaint.toString()})(${args.map((arg) => JSON.stringify(arg)).join(",")})`;
}
