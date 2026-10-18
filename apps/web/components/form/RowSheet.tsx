"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { SheetTab, TabMark } from "../../lib/row-sheet";
import { useSlidingIndicator } from "../../lib/use-sliding-indicator";
import { XIcon } from "../Icons";
import { renderEmoji } from "../messages/MessagePreview";

interface Props {
  /** Names the sheet for screen readers and heads it. */
  title: string;
  emoji?: string | undefined;
  /** A quiet line under the title, such as where the row sits in its list. */
  subtitle?: string;
  tabs: SheetTab[];
  marks: Record<string, TabMark>;
  tab: string;
  onTab(id: string): void;
  /** Drawn the first time a tab is shown, then kept so what it holds is not lost by switching away. */
  renderTab(id: string): ReactNode;
  /** What the row is called, for the remove and duplicate buttons: "ticket type". */
  noun: string;
  disabled: boolean;
  canDuplicate: boolean;
  onDuplicate(): void;
  onRemove(): void;
  onClose(): void;
  /** True while the sheet plays its exit. */
  leaving: boolean;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const MARK_TEXT: Record<TabMark, string> = {
  error: "has a setting to fix",
  needed: "is missing something",
};

/**
 * A row of a list opened in a sheet from the right instead of in place: a
 * header with the row's name, tabs for the parts of the row, and a footer with
 * the things that act on the whole row. It edits the same draft as the rest of
 * the page, so closing it keeps every change and the page's own Save applies
 * them. Escape and the scrim close it, Tab stays inside it, and the control
 * that opened it gets focus back.
 */
export function RowSheet({
  title,
  emoji,
  subtitle,
  tabs,
  marks,
  tab,
  onTab,
  renderTab,
  noun,
  disabled,
  canDuplicate,
  onDuplicate,
  onRemove,
  onClose,
  leaving,
}: Props) {
  const baseId = useId();
  const sheetRef = useRef<HTMLElement>(null);
  const tablistRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set([tab]));
  const [confirming, setConfirming] = useState(false);
  const removeRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  const shown = visited.has(tab) ? visited : new Set([...visited, tab]);
  if (shown !== visited) setVisited(shown);

  const markKey = tabs.map((entry) => `${entry.id}:${marks[entry.id] ?? ""}`).join(",");
  useSlidingIndicator(() => tablistRef.current, `${tab}|${markKey}`, { axis: "x", selector: '[aria-selected="true"]' });

  // Focus goes into the sheet when it opens: the first field on a computer, the
  // sheet itself on a phone, where a field would raise the keyboard over it.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const panel = ".row-sheet-panel:not([hidden])";
    // A refusal sends focus to the setting that failed, whatever the device.
    const failed = sheet.querySelector<HTMLElement>(`${panel} [data-invalid="true"] :is(input, textarea, select, button)`);
    const field = failed ?? (coarse ? null : sheet.querySelector<HTMLElement>(`${panel} :is(input, textarea, select, button)`));
    (field ?? sheet).focus({ preventScroll: true });
    failed?.scrollIntoView({ block: "center" });
  }, []);

  // The button that was pressed is gone when the question opens or closes, so focus follows it.
  useEffect(() => {
    if (wasConfirming.current === confirming) return;
    wasConfirming.current = confirming;
    (confirming ? keepRef : removeRef).current?.focus();
  }, [confirming]);

  // With focus lost to the page, as after a button disappears, Escape still has to close the sheet.
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.target !== document.body && event.target !== document.documentElement) return;
      latestClose.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    const sheet = sheetRef.current;
    // A dialog opened from inside the sheet is a child of it in React's tree but not in the page, and it handles its own keys.
    if (!sheet || !(event.target instanceof Node) || !sheet.contains(event.target)) return;
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.stopPropagation();
      if (confirming) setConfirming(false);
      else onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.offsetParent !== null);
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === sheet)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const edge = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
    if (step === 0 && edge === -1) return;
    event.preventDefault();
    const at = tabs.findIndex((entry) => entry.id === tab);
    const next = tabs[edge !== -1 ? edge : (at + step + tabs.length) % tabs.length];
    if (!next) return;
    onTab(next.id);
    requestAnimationFrame(() => document.getElementById(`${baseId}-tab-${next.id}`)?.focus());
  }

  const titleId = `${baseId}-title`;
  const tabbed = tabs.length > 1;

  return createPortal(
    <div className="sheet-layer row-sheet-layer" data-leaving={leaving ? "true" : undefined}>
      <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
      <aside
        ref={sheetRef}
        className="sheet row-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="row-sheet-head">
          <div className="row-sheet-title">
            {emoji ? (
              <span className="row-sheet-emoji" aria-hidden="true">
                {renderEmoji(emoji)}
              </span>
            ) : null}
            <div>
              <h2 className="row-sheet-name" id={titleId}>
                {title}
              </h2>
              {subtitle ? <p className="row-sheet-sub">{subtitle}</p> : null}
            </div>
          </div>
          <button type="button" ref={closeRef} className="sheet-close" aria-label={`Close ${title}`} onClick={onClose}>
            <XIcon />
          </button>
        </header>

        {tabbed ? (
          <div className="row-sheet-tabs" role="tablist" aria-label={`Settings for ${title}`} ref={tablistRef} onKeyDown={onTabKeyDown}>
            {tabs.map((entry) => {
              const mark = marks[entry.id];
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  id={`${baseId}-tab-${entry.id}`}
                  className="row-sheet-tab"
                  aria-selected={entry.id === tab}
                  aria-controls={`${baseId}-panel-${entry.id}`}
                  tabIndex={entry.id === tab ? 0 : -1}
                  data-mark={mark}
                  onClick={() => onTab(entry.id)}
                >
                  {entry.label}
                  {mark ? (
                    <>
                      <span className="row-sheet-mark" aria-hidden="true" />
                      <span className="visually-hidden"> ({MARK_TEXT[mark]})</span>
                    </>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="sheet-body row-sheet-body">
          {tabs.map((entry) =>
            shown.has(entry.id) ? (
              <div
                key={entry.id}
                className="row-sheet-panel"
                role={tabbed ? "tabpanel" : undefined}
                id={`${baseId}-panel-${entry.id}`}
                aria-labelledby={tabbed ? `${baseId}-tab-${entry.id}` : undefined}
                hidden={entry.id !== tab}
              >
                <div className="form-grid">{renderTab(entry.id)}</div>
              </div>
            ) : null,
          )}
        </div>

        <footer className="row-sheet-foot">
          {confirming ? (
            <div className="row-sheet-confirm" role="alert">
              <p>
                Remove this {noun}? It goes from the page now, and from Discord once you save.
              </p>
              <div className="row-sheet-confirm-actions">
                <button type="button" ref={keepRef} className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
                  Keep it
                </button>
                <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}>
                  Remove it
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="row-sheet-foot-left">
                <button type="button" ref={removeRef} className="btn btn-ghost btn-sm row-sheet-remove" disabled={disabled} onClick={() => setConfirming(true)}>
                  Remove this {noun}
                </button>
                {canDuplicate ? (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} onClick={onDuplicate}>
                    Make a copy
                  </button>
                ) : null}
              </div>
              <div className="row-sheet-foot-right">
                <span className="row-sheet-hint">Save changes on the page when you are done.</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
                  Close
                </button>
              </div>
            </>
          )}
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
