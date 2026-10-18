"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { MoreIcon } from "../Icons";

export interface RowMenuItem {
  label: string;
  onSelect(): void;
  disabled?: boolean;
  /** Why it is disabled, said as a tooltip. */
  title?: string;
  danger?: boolean;
}

interface Props {
  /** Names the menu button for screen readers: "More actions for Support". */
  label: string;
  items: RowMenuItem[];
}

/**
 * A small menu behind a three dots button, for the things that act on a whole
 * row and are not what someone came to do: copying it, removing it. Arrow keys
 * move through it, Escape closes it and gives focus back to the button.
 */
export function RowMenu({ label, items }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const nodes = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const at = nodes.indexOf(document.activeElement as HTMLElement);
    nodes[(at + step + nodes.length) % nodes.length]?.focus();
  }

  return (
    <div className="row-menu" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        ref={buttonRef}
        className="btn btn-ghost btn-sm btn-icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreIcon />
        <span className="visually-hidden">{label}</span>
      </button>
      {open ? (
        <div className="row-menu-list" role="menu" id={menuId} aria-label={label}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="row-menu-item"
              data-danger={item.danger ? "true" : undefined}
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus();
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
