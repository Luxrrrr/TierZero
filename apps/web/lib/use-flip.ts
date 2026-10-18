"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Lets reordered rows glide to their new places instead of jumping. Call the
 * returned function just before the order changes; once `order` has changed
 * and the DOM has followed, each row plays from where it was to where it is.
 * Rows carry the attribute named by `attribute` as their identity.
 */
export function useFlip(container: RefObject<HTMLElement | null>, order: string, attribute = "data-row-key"): () => void {
  const before = useRef<Map<string, number> | null>(null);

  const capture = useCallback(() => {
    const root = container.current;
    if (!root) return;
    const tops = new Map<string, number>();
    for (const row of root.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
      tops.set(row.getAttribute(attribute) ?? "", row.getBoundingClientRect().top);
    }
    before.current = tops;
  }, [container, attribute]);

  useBrowserLayoutEffect(() => {
    const tops = before.current;
    before.current = null;
    const root = container.current;
    if (!tops || !root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const row of root.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
      const was = tops.get(row.getAttribute(attribute) ?? "");
      if (was === undefined) continue;
      const shift = was - row.getBoundingClientRect().top;
      if (Math.abs(shift) < 1) continue;
      row.animate([{ transform: `translateY(${shift}px)` }, { transform: "translateY(0)" }], {
        duration: 280,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      });
    }
  }, [order]);

  return capture;
}
