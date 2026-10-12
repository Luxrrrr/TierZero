"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { CharacterCount } from "./CharacterCount";
import { confirmationProblem, PURGE_WORD, purgeConfirmed } from "./timeline";
import type { ModResult } from "./useModAction";

const FOCUSABLE =
  'a[href], button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Where focus goes when the dialog closes and the control that opened it has gone. */
export type FocusFallback = () => HTMLElement | null;

interface ShellProps {
  title: string;
  /** "form" makes the dialog a bottom sheet on a phone, with its buttons kept in view while the fields scroll. */
  layout?: "confirm" | "form";
  icon?: ReactNode;
  tone: "default" | "danger";
  descriptionId: string;
  onClose(): void;
  /** While true the dialog cannot be dismissed, so a request in flight is not abandoned. */
  locked?: boolean;
  fallbackFocus?: FocusFallback;
  children: ReactNode;
}

/**
 * A modal with the behaviour the keyboard needs: focus moves in, Tab stays
 * inside, Escape closes, and focus returns to what opened it, or to the
 * fallback when a confirmed change removed that control. The page behind
 * stops scrolling so a long timeline does not move under the scrim.
 */
export function DialogShell({
  title,
  layout = "confirm",
  icon,
  tone,
  descriptionId,
  onClose,
  locked = false,
  fallbackFocus,
  children,
}: ShellProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const fallbackRef = useRef(fallbackFocus);
  fallbackRef.current = fallbackFocus;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = panel.current;
    if (!node) return;

    const preferred = node.querySelector<HTMLElement>("[data-autofocus]");
    (preferred ?? node.querySelector<HTMLElement>(FOCUSABLE) ?? node).focus();

    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        if (!lockedRef.current) closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = overflow;
      const target = opener && document.contains(opener) ? opener : (fallbackRef.current?.() ?? null);
      target?.focus();
    };
  }, []);

  return createPortal(
    <div
      className="pf-scrim"
      data-layout={layout}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !locked) onClose();
      }}
    >
      <div
        ref={panel}
        className="pf-dialog"
        data-tone={tone}
        data-layout={layout}
        role={tone === "danger" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <div className="pf-dialog-head">
          {icon ? (
            <span className="pf-dialog-icon" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          <h2 className="pf-dialog-title" id={titleId}>
            {title}
          </h2>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

interface ActionDialogProps {
  title: string;
  icon?: ReactNode;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** When set, the dialog asks for a written reason and will not continue without one. */
  reason?: { label: string; placeholder?: string; maxLength: number; hint?: string; initial?: string };
  /** Asks for the word "purge" before the confirm button wakes up. */
  typedConfirm?: boolean;
  /** True closes the dialog; a string is shown inside it as the reason the change failed. */
  onConfirm(reason: string): Promise<ModResult>;
  onClose(): void;
  fallbackFocus?: FocusFallback;
}

export function ActionDialog({
  title,
  icon,
  body,
  confirmLabel,
  danger = false,
  reason,
  typedConfirm = false,
  onConfirm,
  onClose,
  fallbackFocus,
}: ActionDialogProps) {
  const [text, setText] = useState(reason?.initial ?? "");
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const submitting = useRef(false);
  const fieldId = useId();
  const hintId = useId();
  const wordId = useId();
  const bodyId = useId();
  const errorId = useId();
  const problemId = useId();

  const trimmed = text.trim();
  const ready = (!reason || trimmed.length > 0) && (!typedConfirm || purgeConfirmed(word));
  const autofocusCancel = !reason && !typedConfirm;
  const describedBy = (ids: (string | false | null | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;

  async function submit() {
    if (submitting.current) return;
    if (!ready) {
      // The confirm button only looks unavailable; pressing it anyway says
      // what is missing and goes to the field, rather than doing nothing.
      setProblem(confirmationProblem(Boolean(reason), text, typedConfirm, word));
      const missingReason = Boolean(reason) && trimmed === "";
      document.getElementById(missingReason ? fieldId : wordId)?.focus();
      return;
    }
    setProblem(null);
    submitting.current = true;
    setBusy(true);
    setError(null);
    let result: ModResult;
    try {
      result = await onConfirm(trimmed);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
    if (result === true) onClose();
    else setError(result);
  }

  return (
    <DialogShell
      title={title}
      icon={icon}
      tone={danger ? "danger" : "default"}
      descriptionId={bodyId}
      onClose={onClose}
      locked={busy}
      fallbackFocus={fallbackFocus}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        aria-busy={busy || undefined}
      >
        <div className="pf-dialog-body">
          <div className="pf-dialog-text" id={bodyId}>
            {body}
          </div>
          {reason ? (
            <div className="pf-field">
              <div className="pf-field-row">
                <label className="pf-field-label" htmlFor={fieldId}>
                  {reason.label}
                </label>
                <CharacterCount length={text.length} limit={reason.maxLength} />
              </div>
              <textarea
                id={fieldId}
                className="textarea pf-textarea"
                rows={3}
                value={text}
                maxLength={reason.maxLength}
                placeholder={reason.placeholder}
                aria-describedby={describedBy([problem && trimmed === "" && problemId, reason.hint && hintId, error && errorId])}
                aria-invalid={error || (problem && trimmed === "") ? true : undefined}
                required
                readOnly={busy}
                onChange={(event) => {
                  setText(event.target.value);
                  setProblem(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                data-autofocus
              />
              {reason.hint ? (
                <p className="pf-field-hint" id={hintId}>
                  {reason.hint}
                </p>
              ) : null}
            </div>
          ) : null}
          {typedConfirm ? (
            <div className="pf-field">
              <label className="pf-field-label" htmlFor={wordId}>
                Type <span className="pf-confirm-word">{PURGE_WORD}</span> to confirm
              </label>
              <input
                id={wordId}
                className="input pf-confirm-input"
                value={word}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                readOnly={busy}
                aria-describedby={describedBy([problem && problemId, error && errorId])}
                aria-invalid={problem ? true : undefined}
                onChange={(event) => {
                  setWord(event.target.value);
                  setProblem(null);
                }}
                {...(reason ? {} : { "data-autofocus": true })}
              />
            </div>
          ) : null}
          {problem ? (
            <p className="pf-field-error" role="alert" id={problemId}>
              {problem}
            </p>
          ) : null}
          {error ? (
            <p className="pf-dialog-error" role="alert" id={errorId}>
              {error}
            </p>
          ) : null}
        </div>
        <div className="pf-dialog-actions">
          <button
            type="button"
            className="btn btn-secondary"
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) onClose();
            }}
            {...(autofocusCancel ? { "data-autofocus": true } : {})}
          >
            Cancel
          </button>
          {/* aria-disabled rather than disabled: a disabled button drops focus to the page, and the reader loses their place. */}
          <button
            type="submit"
            className={danger ? "btn btn-danger" : "btn btn-primary"}
            aria-disabled={busy || !ready || undefined}
            aria-describedby={error ? errorId : undefined}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
