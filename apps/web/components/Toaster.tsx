"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { AlertIcon, CheckIcon, XIcon } from "./Icons";
import { toastLifetime } from "../lib/toast-timing";

export interface Toast {
  kind: "success" | "error";
  title: string;
  detail?: string;
}

interface ToastContextValue {
  push(toast: Toast): void;
}

interface LiveToast extends Toast {
  id: number;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Wraps the signed-in shell so anything below it can report the outcome of a
 * save without threading a callback down. Errors stay until dismissed: they
 * usually name something the reader has to go and change.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<LiveToast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((toast: Toast) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { ...toast, id }]);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside the dashboard shell.");
  }
  return context;
}

// Each region lays out its own toasts the way the stack does.
const REGION: CSSProperties = { display: "flex", flexDirection: "column", gap: "var(--space-2)" };

/**
 * Two regions, both present from the start so assistive technology is
 * already watching them: errors interrupt (role="alert"), successes wait
 * their turn (role="status").
 */
function Toaster({ toasts, onDismiss }: { toasts: LiveToast[]; onDismiss(id: number): void }) {
  return (
    <div className="toaster">
      <div role="alert" style={REGION}>
        {toasts
          .filter((toast) => toast.kind === "error")
          .map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
          ))}
      </div>
      <div role="status" aria-live="polite" style={REGION}>
        {toasts
          .filter((toast) => toast.kind === "success")
          .map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
          ))}
      </div>
    </div>
  );
}

/** A success toast counts down only while nobody is pointing at it or focused inside it. */
function ToastItem({ toast, onDismiss }: { toast: LiveToast; onDismiss(id: number): void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(toastLifetime(toast.title, toast.detail));
  const paused = hovered || focused;

  useEffect(() => {
    if (toast.kind !== "success" || paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(1000, remaining.current - (Date.now() - started));
    };
  }, [toast.kind, toast.id, paused, onDismiss]);

  return (
    <div
      className={toast.kind === "success" ? "toast toast-success" : "toast toast-error"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      {toast.kind === "success" ? <CheckIcon className="toast-icon" /> : <AlertIcon className="toast-icon" />}
      <div className="toast-text">
        <div className="toast-title">{toast.title}</div>
        {toast.detail ? <div className="toast-detail">{toast.detail}</div> : null}
      </div>
      <button type="button" className="toast-close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
        <XIcon />
      </button>
    </div>
  );
}
