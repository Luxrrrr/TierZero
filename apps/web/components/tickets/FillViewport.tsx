"use client";

import { useEffect } from "react";

/** Space left under the inbox, so it never touches the bottom of the window. */
const BOTTOM_GAP_PX = 28;

/** Distance from the top of the page, which ignores the transform of the page enter animation. */
function offsetFromPageTop(element: HTMLElement): number {
  let top = 0;
  for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) top += node.offsetTop;
  return top;
}

/**
 * Sizes the inbox to the visible window, from where it starts down to a gap
 * above the bottom edge. A fixed rem offset guessed the height of the header
 * above it, and was wrong whenever a notice sat in between.
 */
export function FillViewport() {
  useEffect(() => {
    const page = document.querySelector<HTMLElement>(".tk-inbox-page");
    const box = page?.querySelector<HTMLElement>(".tk-inbox");
    if (!page || !box) return;

    const measure = () => {
      const room = window.innerHeight - offsetFromPageTop(box) - BOTTOM_GAP_PX;
      page.style.setProperty("--tk-fill", `${Math.max(0, Math.round(room))}px`);
    };

    measure();
    const settle = window.setTimeout(measure, 400);
    window.addEventListener("resize", measure);
    void document.fonts?.ready.then(measure);
    // A notice above the inbox appearing or going away moves it.
    const observer = new ResizeObserver(measure);
    for (let node = box.previousElementSibling; node; node = node.previousElementSibling) observer.observe(node);
    const content = page.closest(".app-content");
    if (content) observer.observe(content);

    return () => {
      window.clearTimeout(settle);
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, []);

  return null;
}
