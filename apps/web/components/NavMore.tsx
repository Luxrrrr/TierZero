"use client";

import { useState, type ReactNode } from "react";
import { ChevronDownIcon } from "./Icons";

/**
 * A sidebar group that starts folded, for tools most servers never touch. They stay one click away without
 * sitting among the main features. In the narrow icon rail the heading is hidden, so the group is shown open.
 */
export function NavMore({ heading, children }: { heading: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="nav-group nav-more" data-open={open ? "true" : undefined}>
      <button type="button" className="nav-group-title nav-more-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>{heading}</span>
        <ChevronDownIcon className="nav-more-chevron" />
      </button>
      <div className="nav-more-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
