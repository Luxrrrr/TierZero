"use client";

import { useEffect } from "react";

/**
 * Rows that scroll sideways on a phone (the Moderation tabs, the filter chips)
 * give no sign that more is hidden past the edge. This marks each one with
 * whether it can scroll further either way, and mod.css fades that edge, so a
 * cut-off tab reads as "keep going" rather than as the end of the list.
 *
 * The hook lives in the layout, so it can mark a row in the page below before
 * React has hydrated that row. Every element the selector matches carries
 * `suppressHydrationWarning`, because the data attributes are added behind
 * React's back on purpose. A new row matching the selector needs it too.
 */

export const SCROLL_CUE_SELECTOR = ".mod-tabs, .mod-toolbar-group, .log-switch, .settings-switch";

/** Which edges have more past them, with a couple of pixels of slack for rounding. */
export function cueEdges(scrollLeft: number, scrollWidth: number, clientWidth: number): { start: boolean; end: boolean } {
  const max = scrollWidth - clientWidth;
  if (max <= 2) return { start: false, end: false };
  return { start: scrollLeft > 2, end: scrollLeft < max - 2 };
}

function mark(element: HTMLElement): void {
  const edges = cueEdges(element.scrollLeft, element.scrollWidth, element.clientWidth);
  element.dataset.cueStart = edges.start ? "true" : "false";
  element.dataset.cueEnd = edges.end ? "true" : "false";
}

/** The current tab is brought into view, so on a phone the page you are on is never one of the hidden tabs. */
function revealCurrent(): void {
  const tabs = document.querySelector<HTMLElement>(".mod-tabs");
  const current = tabs?.querySelector<HTMLElement>('[aria-current="page"]');
  if (!tabs || !current) return;
  const left = current.offsetLeft - tabs.offsetLeft;
  if (left < tabs.scrollLeft || left + current.offsetWidth > tabs.scrollLeft + tabs.clientWidth) {
    tabs.scrollLeft = Math.max(0, left - 16);
  }
}

export function useScrollCues(key: string): void {
  useEffect(() => {
    const watched = new Set<HTMLElement>();
    const onScroll = (event: Event) => mark(event.currentTarget as HTMLElement);
    const resize = new ResizeObserver((entries) => {
      for (const entry of entries) mark(entry.target as HTMLElement);
    });

    const scan = () => {
      for (const element of document.querySelectorAll<HTMLElement>(SCROLL_CUE_SELECTOR)) {
        if (!watched.has(element)) {
          watched.add(element);
          element.addEventListener("scroll", onScroll, { passive: true });
          resize.observe(element);
        }
        mark(element);
      }
    };

    scan();
    revealCurrent();
    // Filter links swap the rows below without a new route, so new rows are picked up as they appear.
    let pending = 0;
    const mutations = new MutationObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(scan);
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(pending);
      mutations.disconnect();
      resize.disconnect();
      for (const element of watched) element.removeEventListener("scroll", onScroll);
    };
  }, [key]);
}
