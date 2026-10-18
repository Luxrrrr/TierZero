"use client";

import { readSettingsTarget, targetIndexes, type SettingsTarget } from "../../lib/ticket-health";

/**
 * Takes the reader from a health line or a first-run step to the exact
 * setting it is about: the Panels part of the page, then the panel's row opened,
 * and the type's sheet over it. The form's lists mark themselves with
 * their settings path, so this finds them without knowing how they are drawn.
 */

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A row opens over a few frames and its contents cannot take focus until it has, so try for a moment. */
async function focusWhenShown(find: () => HTMLElement | null | undefined): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const target = find();
    target?.focus({ preventScroll: true });
    if (target && document.activeElement === target) return;
    await frame();
  }
}

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
    // The first panel that is not up yet, or the first panel when all are.
    const rows = [...(document.querySelector<HTMLElement>('[data-list-path="panels"]')?.querySelectorAll<HTMLElement>(":scope > .list-item") ?? [])];
    const waiting = rows.findIndex((row) => row.querySelector("[data-panel-state]")?.getAttribute("data-panel-state") !== "posted");
    const row = await openRow("panels", waiting === -1 ? 0 : waiting);
    if (!row) return;
    row.scrollIntoView({ block: "start", behavior: calm() ? "auto" : "smooth" });
    await focusWhenShown(() => row.querySelector<HTMLElement>("[data-panel-post]"));
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
  // A type opens in a sheet that takes focus itself; a panel's own row needs it moved in.
  if (at.type === null) await focusWhenShown(() => row.querySelector<HTMLElement>(".list-item-body input, .list-item-body button"));
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
