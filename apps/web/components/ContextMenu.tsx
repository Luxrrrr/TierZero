"use client";

import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { placeMenu, typeAheadIndex, type Placement } from "../lib/menu-position";
import "./context-menu.css";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** A muted second line. On a disabled item it says why. */
  hint?: string | null;
  disabled?: boolean;
  danger?: boolean;
  /** Starts a new group, with a divider above. */
  separated?: boolean;
  /** Makes the item a link. An external one opens in a new tab. */
  href?: string;
  external?: boolean;
  onSelect(): void;
}

export interface ContextMenuAnchor {
  x: number;
  y: number;
  /** A keyboard open puts focus on the first item; a pointer open leaves it on the menu. */
  via: "pointer" | "keyboard";
}

interface Props {
  /** Names the menu for screen readers: "Actions for Priya". */
  label: string;
  items: ContextMenuItem[];
  anchor: ContextMenuAnchor;
  /** `returnFocus` is true when the reader dismissed it from the keyboard and should land where they were. */
  onClose(returnFocus: boolean): void;
}

const firstEnabled = (items: ContextMenuItem[]) => items.findIndex((item) => !item.disabled);

/**
 * A menu that opens at a point, as Discord's right-click menu does. It sits
 * above everything, stays inside the window, and is a single tab stop: arrow
 * keys, Home and End move through it, a letter jumps to the item that starts
 * with it, Escape closes it and returns focus, Tab leaves it. Items that
 * cannot be used stay in the list, focusable, so their reason can be read.
 */
export function ContextMenu({ label, items, anchor, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [active, setActive] = useState(() => (anchor.via === "keyboard" ? firstEnabled(items) : -1));
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const idPrefix = useId();

  // Measured before the first paint so the menu never shows at the wrong place.
  // A resize observer keeps it inside the window when its content changes, as
  // when the bot's answer adds or removes entries.
  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node) return;
    const place = () => {
      const natural = node.scrollHeight + (node.offsetHeight - node.clientHeight);
      setPlacement(
        placeMenu(
          { x: anchor.x + 2, y: anchor.y + 2 },
          { width: node.offsetWidth, height: Math.max(natural, node.offsetHeight) },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(node);
    return () => observer.disconnect();
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    const node = menuRef.current;
    if (anchor.via === "keyboard" && active >= 0) itemRefs.current[active]?.focus();
    else node?.focus({ preventScroll: true });
    // Only on open; later moves are focused by `move`.
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) closeRef.current(false);
    };
    const away = () => closeRef.current(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", away);
    window.addEventListener("blur", away);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", away);
      window.removeEventListener("blur", away);
    };
  }, []);

  function move(next: number) {
    setActive(next);
    itemRefs.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const count = items.length;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      move(active < 0 ? 0 : (active + 1) % count);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(active < 0 ? count - 1 : (active - 1 + count) % count);
    } else if (event.key === "Home") {
      event.preventDefault();
      move(0);
    } else if (event.key === "End") {
      event.preventDefault();
      move(count - 1);
    } else if (event.key === "Tab") {
      onClose(false);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const found = typeAheadIndex(
        items.map((item) => item.label),
        active,
        event.key,
      );
      if (found >= 0) {
        event.preventDefault();
        move(found);
      }
    }
  }

  function choose(event: MouseEvent, item: ContextMenuItem) {
    if (item.disabled) {
      event.preventDefault();
      return;
    }
    // An internal link is followed by the caller, so the page changes without a reload.
    if (item.href && !item.external) event.preventDefault();
    item.onSelect();
  }

  const style = {
    left: placement?.left ?? anchor.x,
    top: placement?.top ?? anchor.y,
    maxHeight: placement?.maxHeight ?? undefined,
    transformOrigin: placement ? `${placement.originY} ${placement.originX}` : undefined,
  };

  return createPortal(
    <div
      ref={menuRef}
      className="popover popover-fixed ctx-menu"
      role="menu"
      aria-label={label}
      tabIndex={-1}
      style={style}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => {
        const labelId = `${idPrefix}-${item.id}-label`;
        const hintId = `${idPrefix}-${item.id}-hint`;
        const props = {
          role: "menuitem",
          ref: (node: HTMLElement | null) => {
            itemRefs.current[index] = node;
          },
          tabIndex: active === index ? 0 : -1,
          className: "popover-item ctx-item" + (active === index ? " is-active" : ""),
          "data-danger": item.danger ? "true" : undefined,
          "aria-disabled": item.disabled || undefined,
          // Named by the label alone and described by the line under it, so the reason is read once.
          "aria-labelledby": labelId,
          "aria-describedby": item.hint ? hintId : undefined,
          title: item.disabled && item.hint ? item.hint : undefined,
          onMouseEnter: () => {
            setActive(index);
            itemRefs.current[index]?.focus({ preventScroll: true });
          },
          onClick: (event: MouseEvent) => choose(event, item),
        };
        const body = (
          <>
            {item.icon ? (
              <span className="ctx-icon" aria-hidden="true">
                {item.icon}
              </span>
            ) : null}
            <span className="ctx-text">
              <span className="ctx-label" id={labelId}>
                {item.label}
              </span>
              {item.hint ? (
                <span className="ctx-hint" id={hintId}>
                  {item.hint}
                </span>
              ) : null}
            </span>
          </>
        );
        return (
          <Fragment key={item.id}>
            {item.separated && index > 0 ? <div role="separator" className="popover-divider" /> : null}
            {item.href && !item.disabled ? (
              <a
                {...props}
                href={item.href}
                {...(item.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                onKeyDown={(event) => {
                  if (event.key === " ") {
                    event.preventDefault();
                    event.currentTarget.click();
                  }
                }}
              >
                {body}
              </a>
            ) : (
              <button type="button" {...props}>
                {body}
              </button>
            )}
          </Fragment>
        );
      })}
    </div>,
    document.body,
  );
}
