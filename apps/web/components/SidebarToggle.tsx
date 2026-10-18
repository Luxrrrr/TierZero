"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ChevronLeftIcon } from "./Icons";
import {
  SIDEBAR_ATTRIBUTE,
  SIDEBAR_STORAGE_KEY,
  isEditableTarget,
  isSidebarShortcut,
  parseSidebarMode,
  shortcutLabel,
  toggledMode,
  type SidebarMode,
} from "../lib/sidebar-state";

const DRAWER_QUERY = "(max-width: 900px)";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readMode(): SidebarMode {
  return parseSidebarMode(document.documentElement.getAttribute(SIDEBAR_ATTRIBUTE));
}

let settle: number | undefined;

function applyMode(mode: SidebarMode): void {
  const root = document.documentElement;
  // Lets the stylesheet fade labels in as the rail opens, for this change only.
  root.setAttribute("data-sidebar-motion", mode);
  window.clearTimeout(settle);
  settle = window.setTimeout(() => root.removeAttribute("data-sidebar-motion"), 400);
  if (mode === "collapsed") root.setAttribute(SIDEBAR_ATTRIBUTE, "collapsed");
  else root.removeAttribute(SIDEBAR_ATTRIBUTE);
  for (const listener of listeners) listener();
}

function remember(mode: SidebarMode): void {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, mode);
  } catch {
    // Blocked storage still leaves the choice working for this page.
  }
}

/**
 * The collapse control in the sidebar header. The document attribute set by
 * the inline script in the root layout is the source of truth, so the
 * stylesheet, this button and another tab all agree without any of them
 * holding their own copy.
 */
export function SidebarToggle() {
  // The server cannot know the stored choice, so it renders expanded and the
  // client corrects it after hydration; the stylesheet already drew the right
  // width from the attribute, so only this button's label ever changes.
  const mode = useSyncExternalStore(subscribe, readMode, () => "expanded" as SidebarMode);
  const [keys, setKeys] = useState("Ctrl+B");

  useEffect(() => {
    setKeys(shortcutLabel(/Mac|iPhone|iPad|iPod/.test(navigator.userAgent)));
  }, []);

  const toggle = useCallback(() => {
    const next = toggledMode(readMode());
    applyMode(next);
    remember(next);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isSidebarShortcut(event)) return;
      // The drawer ignores the preference, so there is nothing to toggle.
      if (window.matchMedia(DRAWER_QUERY).matches) return;
      const target = event.target;
      if (target instanceof HTMLElement && isEditableTarget(target as HTMLElement & { type?: string })) return;
      event.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  // Another tab changing the preference should not leave this one stale.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== SIDEBAR_STORAGE_KEY) return;
      applyMode(parseSidebarMode(event.newValue));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const expanded = mode === "expanded";
  const action = expanded ? "Collapse sidebar" : "Expand sidebar";

  return (
    <button
        type="button"
        className="btn btn-ghost btn-icon btn-sm sidebar-toggle"
        aria-expanded={expanded}
        aria-controls="app-sidebar"
        aria-label="Sidebar"
        aria-keyshortcuts="Control+B Meta+B"
        data-tip={`${action} (${keys})`}
        onClick={toggle}
      >
        <ChevronLeftIcon />
    </button>
  );
}
