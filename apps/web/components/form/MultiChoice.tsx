"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import {
  blockMessage,
  normalizeSelection,
  sameSelection,
  toggleChoice,
} from "../../lib/multi-choice";
import { CheckIcon } from "../Icons";
import type { SelectOption } from "./Select";

interface Props {
  id: string;
  options: SelectOption[];
  values: string[];
  /** What "Reset to recommended" puts back. The link is hidden when it is already so. */
  defaults?: string[];
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange(next: string[]): void;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

/**
 * Several options on at once, as a column of rows rather than a menu: every
 * choice and what it does stays in view, which is the point when the options
 * are things like what to do to a message.
 *
 * Each row is a button with role=checkbox and a box drawn in CSS, not a native
 * checkbox, so it takes the dashboard's look in both themes.
 */
export function MultiChoice({
  id,
  options,
  values,
  defaults,
  min,
  max,
  disabled = false,
  onChange,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
}: Props) {
  const groupRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<string | undefined>();

  const order = options.map((option) => option.value);
  const selected = normalizeSelection(values, order);
  const limits = { min, max };
  const atMax = max !== undefined && selected.length >= max;
  const atMin = min !== undefined && selected.length <= min;
  const differs = defaults !== undefined && !sameSelection(selected, defaults);

  function toggle(option: SelectOption) {
    const value = option.value;
    if (disabled || option.disabled) return;
    const result = toggleChoice(selected, value, order, limits);
    if (result.blocked) {
      setNotice(blockMessage(result.blocked, limits));
      return;
    }
    setNotice(undefined);
    onChange(result.next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const rows = Array.from(
      groupRef.current?.querySelectorAll<HTMLButtonElement>("[role=checkbox]") ?? [],
    );
    const at = rows.findIndex((row) => row === document.activeElement);
    if (at === -1) return;

    const target =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? rows[Math.min(at + 1, rows.length - 1)]
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? rows[Math.max(at - 1, 0)]
          : event.key === "Home"
            ? rows[0]
            : event.key === "End"
              ? rows[rows.length - 1]
              : undefined;
    if (!target) return;
    event.preventDefault();
    target.focus();
  }

  return (
    <div className="multi-choice">
      <div
        className="multi-choice-list"
        id={id}
        role="group"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        ref={groupRef}
        onKeyDown={onKeyDown}
      >
        {options.map((option) => {
          const checked = selected.includes(option.value);
          const refused = option.disabled || (!checked && atMax);
          return (
            <button
              type="button"
              role="checkbox"
              key={option.value}
              className="multi-choice-row"
              aria-checked={checked}
              aria-disabled={refused ? true : undefined}
              data-locked={checked && atMin ? "true" : undefined}
              disabled={disabled}
              onClick={() => toggle(option)}
            >
              <span className="multi-choice-box" aria-hidden="true">
                <CheckIcon />
              </span>
              <span className="multi-choice-text">
                <span className="multi-choice-label">
                  {option.label}
                  {option.recommended ? <span className="recommended-tag">Recommended</span> : null}
                </span>
                {option.description ? (
                  <span className="multi-choice-description">{option.description}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      <div className="multi-choice-foot">
        <p className="field-hint multi-choice-notice" role="status">
          {notice}
        </p>
        {differs && !disabled ? (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setNotice(undefined);
              onChange(normalizeSelection(defaults, order));
            }}
          >
            Reset to recommended
          </button>
        ) : null}
      </div>
    </div>
  );
}
