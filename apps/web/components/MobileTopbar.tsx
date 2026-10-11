"use client";

import type { RefObject } from "react";
import { MenuIcon } from "./Icons";

interface Props {
  title: string;
  open: boolean;
  onOpen(): void;
  buttonRef: RefObject<HTMLButtonElement>;
}

/**
 * Only visible below the sidebar's breakpoint, where the navigation has
 * collapsed into a drawer and the page needs something to open it from.
 */
export function MobileTopbar({ title, open, onOpen, buttonRef }: Props) {
  return (
    <div className="app-topbar">
      <button
        type="button"
        ref={buttonRef}
        className="btn btn-ghost btn-icon btn-sm"
        aria-expanded={open}
        aria-label="Open navigation"
        onClick={onOpen}
      >
        <MenuIcon />
      </button>
      <span className="app-topbar-title">{title}</span>
    </div>
  );
}
