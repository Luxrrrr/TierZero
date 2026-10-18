"use client";

import { useRef } from "react";
import { usePathname } from "next/navigation";
import { useSlidingIndicator } from "../lib/use-sliding-indicator";

/**
 * The bar beside the current entry in the sidebar. It is one element that
 * slides to the new entry on a navigation, rather than a mark drawn on each
 * link, and the navigation is its parent.
 */
export function NavMarker() {
  const pathname = usePathname() ?? "";
  const ref = useRef<HTMLSpanElement>(null);
  useSlidingIndicator(() => ref.current?.parentElement ?? null, pathname, { axis: "y", selector: ".nav-link.is-current" });
  return <span ref={ref} className="nav-marker" aria-hidden="true" />;
}
