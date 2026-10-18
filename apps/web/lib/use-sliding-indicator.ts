"use client";

import { useEffect, useLayoutEffect } from "react";

// Layout effects warn when rendered on the server; the indicator only needs
// measuring in a browser.
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

interface Options {
  /** Which way the indicator travels. */
  axis: "x" | "y";
  /** What marks the current entry inside the container. */
  selector: string;
  /** Pull the indicator in by the current entry's own left and right padding. */
  inset?: boolean;
}

/**
 * Measures the current entry in a list and publishes its place as custom
 * properties on the container (`--ind-x`/`--ind-w` or `--ind-y`/`--ind-h`, in
 * pixels, unitless), so one element can slide between entries on a transform.
 * The container is marked `data-indicator` once it has been placed and `ready`
 * a frame after, so the first placement is never animated.
 */
export function useSlidingIndicator(getRoot: () => HTMLElement | null, key: string, { axis, selector, inset = false }: Options): void {
  useBrowserLayoutEffect(() => {
    const root = getRoot();
    if (!root) return;

    const measure = () => {
      const target = root.querySelector<HTMLElement>(selector);
      if (!target) {
        root.style.setProperty("--ind-o", "0");
        return;
      }
      const box = root.getBoundingClientRect();
      const rect = target.getBoundingClientRect();
      if (axis === "x") {
        const pad = inset ? Number.parseFloat(getComputedStyle(target).paddingLeft) || 0 : 0;
        root.style.setProperty("--ind-x", String(rect.left - box.left + root.scrollLeft + pad));
        root.style.setProperty("--ind-w", String(Math.max(0, rect.width - pad * 2)));
      } else {
        root.style.setProperty("--ind-y", String(rect.top - box.top + root.scrollTop));
        root.style.setProperty("--ind-h", String(rect.height));
      }
      root.style.setProperty("--ind-o", "1");
      if (!root.hasAttribute("data-indicator")) {
        root.setAttribute("data-indicator", "placed");
        requestAnimationFrame(() => requestAnimationFrame(() => root.setAttribute("data-indicator", "ready")));
      }
    };

    measure();

    // Fonts and the collapsing rail both move entries without a navigation.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(root);
    for (const entry of root.querySelectorAll("a")) observer?.observe(entry);
    void document.fonts?.ready.then(measure);

    return () => observer?.disconnect();
  }, [key, axis, selector, inset]);
}
