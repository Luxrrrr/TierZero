"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "../lib/use-presence";

export interface ConfirmRequest {
  title: string;
  text: string;
  /** The button that goes ahead. */
  confirmLabel: string;
  /** The button that goes ahead is drawn as destructive. */
  danger?: boolean;
}

/**
 * Asks before something that cannot be taken back, in the dashboard's own
 * dialog rather than the browser's. `ask` resolves true when the person went
 * ahead; render `host` once in the component that calls it.
 */
export function useConfirm(): { ask(request: ConfirmRequest): Promise<boolean>; host: ReactNode } {
  const [open, setOpen] = useState<ConfirmRequest | null>(null);
  // The last request stays up while the dialog plays its exit.
  const shown = useRef<ConfirmRequest | null>(null);
  if (open) shown.current = open;
  const presence = usePresence(open !== null, 180);
  const resolver = useRef<((answer: boolean) => void) | null>(null);

  const ask = useCallback((request: ConfirmRequest) => {
    resolver.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOpen(request);
    });
  }, []);

  const answer = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpen(null);
  }, []);

  useEffect(() => () => resolver.current?.(false), []);

  return {
    ask,
    host: presence.mounted && shown.current ? <ConfirmDialog request={shown.current} onAnswer={answer} leaving={presence.leaving} /> : null,
  };
}

function ConfirmDialog({ request, onAnswer, leaving }: { request: ConfirmRequest; onAnswer(value: boolean): void; leaving: boolean }) {
  const titleId = useId();
  const textId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onAnswer(false);
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])];
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

  return createPortal(
    <div className="sheet-layer leave-layer" data-leaving={leaving ? "true" : undefined}>
      <div className="sheet-scrim" aria-hidden="true" onClick={() => onAnswer(false)} />
      <div
        ref={dialogRef}
        className="msg-dialog leave-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        onKeyDown={onKeyDown}
      >
        <div className="msg-dialog-head">
          <h2 className="msg-dialog-title" id={titleId}>
            {request.title}
          </h2>
        </div>
        <div className="msg-dialog-body">
          <p id={textId}>{request.text}</p>
        </div>
        <div className="msg-dialog-foot leave-dialog-foot">
          <button type="button" className="btn btn-ghost" ref={cancelRef} onClick={() => onAnswer(false)}>
            Cancel
          </button>
          <button type="button" className={request.danger ? "btn btn-danger" : "btn btn-primary"} onClick={() => onAnswer(true)}>
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
