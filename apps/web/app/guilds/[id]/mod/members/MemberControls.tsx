"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";

/**
 * The member cell holds a real link for keyboard and assistive tech; this
 * only extends the pointer target to the rest of the row.
 */
export function ClickableRow({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  const open = (event: MouseEvent<HTMLTableRowElement>) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("a, button, input, select")) return;
    if (window.getSelection()?.toString()) return;
    if (event.metaKey || event.ctrlKey) {
      window.open(href, "_blank");
      return;
    }
    router.push(href);
  };
  return (
    <tr role="row" onClick={open}>
      {children}
    </tr>
  );
}
