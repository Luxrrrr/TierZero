"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ClockIcon, ChevronRightIcon, XIcon } from "./Icons";

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The Coming soon button in the sidebar. It opens what is planned in the same kind of side sheet the Commands page
 * uses, so it can be read from any page without leaving it. The list is drawn on the server and passed in.
 */
export function ComingSoon({ count, changelogHref, children }: { count: number; changelogHref: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    close.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const opener = trigger.current;
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, [open]);

  // Escape closes, and Tab stays inside the sheet while the page behind it is dimmed.
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = [...(sheet.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <button ref={trigger} type="button" className="nav-link nav-coming" data-rail-tip="Coming soon" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <ClockIcon />
        <span className="nav-link-text">Coming soon</span>
        {count > 0 ? <span className="nav-count">{count}</span> : null}
      </button>

      {open ? (
        <div className="sheet-layer" onKeyDown={onKeyDown}>
          <div className="sheet-scrim" onClick={() => setOpen(false)} />
          <aside ref={sheet} className="sheet coming-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <header className="coming-head">
              <div>
                <h2 id={titleId} className="coming-title">
                  Coming soon
                </h2>
                <p className="coming-sub">What is planned for TierZero.</p>
              </div>
              <button type="button" ref={close} className="sheet-close" aria-label="Close" onClick={() => setOpen(false)}>
                <XIcon />
              </button>
            </header>
            <div className="sheet-body">{children}</div>
            <footer className="coming-foot">
              <Link href={changelogHref} onClick={() => setOpen(false)}>
                Updates and changelog
                <ChevronRightIcon />
              </Link>
            </footer>
          </aside>
        </div>
      ) : null}
    </>
  );
}
