"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  label: string;
  /** How long the button has to be held before it counts. */
  holdMs?: number;
  disabled?: boolean;
  /** Called once, when the hold completes. */
  onConfirm(): void;
}

/**
 * A button that only acts when it is held. A red bar fills it from the left while it is held, and letting go
 * early empties it again and does nothing. It is for things that cannot be undone, where a click, or a click
 * and a second click, is too easy to do by accident. It works from the keyboard too: hold Space or Enter.
 */
export function HoldButton({ label, holdMs = 3000, disabled = false, onConfirm }: Props) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmRef = useRef(onConfirm);
  confirmRef.current = onConfirm;

  function stop() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  }

  function start() {
    if (disabled || timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      confirmRef.current();
    }, holdMs);
  }

  // A timer left running after the page changes would act on something the person has left.
  useEffect(() => stop, []);

  return (
    <button
      type="button"
      className="hold-btn"
      data-holding={holding ? "true" : undefined}
      aria-disabled={disabled || undefined}
      aria-label={`${label}. Press and hold for ${Math.round(holdMs / 1000)} seconds.`}
      style={{ "--hold-ms": `${holdMs}ms` } as React.CSSProperties}
      onPointerDown={(event) => {
        if (event.button === 0) start();
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if ((event.key === " " || event.key === "Enter") && !event.repeat) {
          event.preventDefault();
          start();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") stop();
      }}
      onBlur={stop}
    >
      <span className="hold-bar" aria-hidden="true" />
      <span className="hold-label">{holding ? "Keep holding…" : label}</span>
    </button>
  );
}
