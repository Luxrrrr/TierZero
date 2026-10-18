"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Wraps the page area of a section that has its own tab strip, so a move
 * between its pages fades the page in while the strip stays put. A template
 * only remounts when its own child segment changes, which would miss moves
 * such as the member list to a member, so the wrapper is keyed by path.
 * The first render does not animate: the template above it already did.
 */
export function PageEnter({ scope, children }: { scope: "mod" | "tickets"; children: ReactNode }) {
  const pathname = usePathname() ?? "";
  // Choosing a ticket in the inbox swaps a pane, not a page.
  const key = scope === "tickets" ? pathname.replace(/\/tickets\/\d+$/, "/tickets") : pathname;

  const [state, setState] = useState({ key, animate: false });
  const current = state.key === key ? state : { key, animate: true };
  if (state.key !== key) setState(current);

  return (
    <div key={current.key} className={current.animate ? "page-enter page-swap" : "page-swap"}>
      {children}
    </div>
  );
}
