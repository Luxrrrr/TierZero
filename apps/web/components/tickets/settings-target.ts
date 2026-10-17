"use client";

import { readSettingsTarget, targetIndexes, type SettingsTarget } from "../../lib/ticket-health";

/**
 * Takes the reader from a health line or a first-run step to the exact
 * setting it is about: the Panels part of the page, then the panel's row and
 * the type's row inside it, opened. The form's lists mark themselves with
 * their settings path, so this finds them without knowing how they are drawn.
 */

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

async function showPanelsPart(): Promise<void> {
  if (window.location.hash !== "#section-panels") {
    window.location.hash = "section-panels";
    await frame();
  }
  await frame();
}

async function openRow(listPath: string, index: number): Promise<HTMLElement | null> {
  const list = document.querySelector<HTMLElement>(`[data-list-path="${CSS.escape(listPath)}"]`);
  const item = list?.querySelectorAll<HTMLElement>(":scope > .list-item")[index] ?? null;
  if (!item) return null;
  if (item.dataset.open !== "true") item.querySelector<HTMLButtonElement>(".list-item-head button[aria-expanded]")?.click();
  await frame();
  return item;
}

export async function openSettingsTarget(
  target: SettingsTarget | null,
  panels: readonly { id: string; types: readonly { id: string }[] }[],
  options: { post?: boolean } = {},
): Promise<void> {
  await showPanelsPart();
  if (options.post) {
    const strip = document.querySelector<HTMLElement>(".tk-strip");
    strip?.scrollIntoView({ block: "start", behavior: calm() ? "auto" : "smooth" });
    strip?.querySelector<HTMLElement>(".tk-strip-actions .btn-primary, .tk-strip-actions .btn-secondary:last-of-type")?.focus({ preventScroll: true });
    return;
  }
  const at = target ? targetIndexes(target, panels) : null;
  if (!at) {
    document.querySelector<HTMLElement>('[data-list-path="panels"]')?.scrollIntoView({ block: "start", behavior: calm() ? "auto" : "smooth" });
    return;
  }
  const panelRow = await openRow("panels", at.panel);
  const row = at.type === null ? panelRow : ((await openRow(`panels[${at.panel}].types`, at.type)) ?? panelRow);
  if (!row) return;
  row.scrollIntoView({ block: "start", behavior: calm() ? "auto" : "smooth" });
  row.querySelector<HTMLElement>(".list-item-body input, .list-item-body button")?.focus({ preventScroll: true });
}

/**
 * Follows a settings address written by `settingsTargetHref` or a first-run
 * step, once the page has drawn, and then drops the query so a reload does
 * not open the row again.
 */
export function followSettingsAddress(panels: readonly { id: string; types: readonly { id: string }[] }[]): void {
  const query = new URLSearchParams(window.location.search);
  const post = query.get("post") === "1";
  const target = readSettingsTarget(window.location.search);
  if (!post && !target) return;
  query.delete("post");
  query.delete("panel");
  query.delete("type");
  const rest = query.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
  void openSettingsTarget(target, panels, { post });
}
