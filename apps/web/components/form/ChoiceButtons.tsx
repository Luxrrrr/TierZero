"use client";

import { useRef, type KeyboardEvent } from "react";
import type { SelectOption } from "./Select";

interface Props {
  options: (SelectOption & { swatch?: string })[];
  value: string | undefined;
  onChange(next: string): void;
  /** `segmented` is a row of toggle buttons; `swatches` is a row of colour dots with their names. */
  variant: "segmented" | "swatches";
  id?: string;
  disabled?: boolean;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

/**
 * A choice drawn as buttons in a row instead of a drop-down, for a few short
 * options that are better seen together than hidden behind a click. One radio
 * group: arrow keys move the choice, and only the chosen button is a tab stop.
 * A segmented control shows the chosen option's description under the row.
 */
export function ChoiceButtons({ options, value, onChange, variant, id, disabled = false, "aria-labelledby": labelledBy, "aria-describedby": describedBy }: Props) {
  const group = useRef<HTMLDivElement>(null);
  const chosen = options.find((option) => option.value === value);
  // With nothing chosen the first button still has to be reachable.
  const stop = chosen?.value ?? options[0]?.value;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const step = keys[event.key];
    const enabled = options.filter((option) => !option.disabled);
    if (step === undefined || enabled.length === 0) return;
    event.preventDefault();
    const at = enabled.findIndex((option) => option.value === (chosen?.value ?? stop));
    const next = enabled[(at + step + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.value);
    requestAnimationFrame(() => group.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus());
  }

  return (
    <div className="choice-buttons-wrap">
      <div
        ref={group}
        id={id}
        className={variant === "swatches" ? "choice-buttons choice-swatches" : "choice-buttons choice-segmented"}
        role="radiogroup"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onKeyDown={onKeyDown}
      >
        {options.map((option) => {
          const on = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={on}
              data-value={option.value}
              tabIndex={option.value === stop ? 0 : -1}
              className="choice-button"
              disabled={disabled || option.disabled}
              onClick={() => onChange(option.value)}
            >
              {variant === "swatches" ? <span className="choice-dot" style={{ background: option.swatch }} aria-hidden="true" /> : null}
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
      {variant === "segmented" && chosen?.description ? <p className="choice-note">{chosen.description}</p> : null}
    </div>
  );
}
