"use client";

import { useEffect, useId, useRef, useState } from "react";
import { KeyboardIcon, XIcon } from "../Icons";
import { shortcutFor, stepRow, TICKET_SHORTCUTS } from "../../lib/ticket-shortcuts";

/**
 * Keys for working through the inbox without the mouse, and the small list
 * that says what they are. The keys act on what is on the page: the list's
 * rows, the open ticket's Claim button and reply box, and the search box, so
 * they never do anything the page itself does not offer.
 */
export function InboxShortcuts({ listId }: { listId: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // A dialog owns the keyboard while it is open.
      if (document.querySelector("[aria-modal='true'], dialog[open]")) return;
      const action = shortcutFor({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        target: event.target instanceof HTMLElement ? event.target : null,
      });
      if (!action) return;

      if (action === "help") {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }
      if (action === "search") {
        const box = document.querySelector<HTMLInputElement>(".tk-search input");
        if (!box) return;
        event.preventDefault();
        box.focus();
        box.select();
        return;
      }
      if (action === "reply") {
        const field = document.querySelector<HTMLTextAreaElement>("[data-shortcut='reply']");
        if (!field) return;
        event.preventDefault();
        field.focus();
        return;
      }
      if (action === "replyLatest") {
        if (!document.querySelector("[data-shortcut='reply']")) return;
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("tk-reply-latest"));
        return;
      }
      if (action === "new") {
        const button = document.querySelector<HTMLButtonElement>("[data-shortcut='new-ticket']");
        if (!button || button.getAttribute("aria-disabled") === "true") return;
        event.preventDefault();
        button.click();
        return;
      }
      if (action === "claim") {
        const button = document.querySelector<HTMLButtonElement>("[data-shortcut='claim']");
        if (!button || button.getAttribute("aria-disabled") === "true") return;
        event.preventDefault();
        button.click();
        return;
      }
      const rows = [...(document.getElementById(listId)?.querySelectorAll<HTMLAnchorElement>("a.tk-row") ?? [])];
      const current = rows.findIndex((row) => row.getAttribute("aria-current") === "page");
      const next = stepRow(current, rows.length, action === "next" ? 1 : -1);
      if (next === null) return;
      event.preventDefault();
      rows[next]!.click();
      rows[next]!.focus({ preventScroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div className="tk-keys">
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-ghost btn-sm tk-keys-button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <KeyboardIcon />
        <span className="visually-hidden">Keyboard shortcuts</span>
      </button>
      {open ? (
        <div ref={panelRef} className="tk-keys-panel" id={panelId} role="group" aria-label="Keyboard shortcuts">
          <div className="tk-keys-head">
            <p className="tk-keys-title">Keyboard shortcuts</p>
            <button
              type="button"
              className="icon-btn"
              aria-label="Close"
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus();
              }}
            >
              <XIcon />
            </button>
          </div>
          <dl className="tk-keys-list">
            {TICKET_SHORTCUTS.map((entry) => (
              <div key={entry.action}>
                <dt>
                  {entry.keys.map((key) => (
                    <span key={key} className="kbd">
                      {key}
                    </span>
                  ))}
                </dt>
                <dd>{entry.does}</dd>
              </div>
            ))}
          </dl>
          <p className="tk-keys-foot">They work while you are not typing in a box.</p>
        </div>
      ) : null}
    </div>
  );
}
