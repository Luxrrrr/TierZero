"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import {
  blockMessage,
  chipCaption,
  choiceLayout,
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
  /** Straight from the schema; without it the number of options decides. */
  layout?: unknown;
  disabled?: boolean;
  onChange(next: string[]): void;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

/**
 * Several options on at once, not a menu: every choice stays in view. A short
 * list is a wrapping row of chips with what the focused or selected options do
 * written underneath; a longer one, or one the schema asks for, is a column of
 * rows with each description beside its label.
 *
 * Either way each option is a button with role=checkbox and a box drawn in CSS, not a native
 * checkbox, so it takes the dashboard's look in both themes.
 */
export function MultiChoice({
  id,
  options,
  values,
  defaults,
  min,
  max,
  layout,
  disabled = false,
  onChange,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
}: Props) {
  const groupRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<string | undefined>();
  const [hovered, setHovered] = useState<string | undefined>();
  const [focused, setFocused] = useState<string | undefined>();
  const chips = choiceLayout(options.length, layout) === "chips";

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

  const caption = chips ? chipCaption(options, selected, hovered, focused) : "";

  return (
    <div className="multi-choice" data-layout={chips ? "chips" : "rows"}>
      <div
        className="multi-choice-list"
        id={id}
        role="group"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        ref={groupRef}
        onKeyDown={onKeyDown}
      >
        {options.map((option, index) => {
          const checked = selected.includes(option.value);
          const refused = option.disabled || (!checked && atMax);
          return (
            <button
              type="button"
              role="checkbox"
              key={option.value}
              className={chips ? "multi-choice-chip" : "multi-choice-row"}
              title={chips ? option.description : undefined}
              aria-describedby={chips && option.description ? `${id}-option-${index}` : undefined}
              onMouseEnter={chips ? () => setHovered(option.value) : undefined}
              onMouseLeave={chips ? () => setHovered(undefined) : undefined}
              onFocus={chips ? () => setFocused(option.value) : undefined}
              onBlur={chips ? () => setFocused(undefined) : undefined}
              aria-checked={checked}
              aria-disabled={refused ? true : undefined}
              data-locked={checked && atMin ? "true" : undefined}
              disabled={disabled}
              onClick={() => toggle(option)}
            >
              <span className="multi-choice-box" aria-hidden="true">
                <CheckIcon />
              </span>
              {chips ? (
                <>
                  <span className="multi-choice-label">{option.label}</span>
                  {option.recommended ? <span className="chip-recommended">Recommended</span> : null}
                  {option.description ? (
                    <span className="visually-hidden" id={`${id}-option-${index}`}>
                      {option.description}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="multi-choice-text">
                  <span className="multi-choice-label">
                    {option.label}
                    {option.recommended ? <span className="recommended-tag">Recommended</span> : null}
                  </span>
                  {option.description ? (
                    <span className="multi-choice-description">{option.description}</span>
                  ) : null}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="multi-choice-foot">
        <div className="multi-choice-lines">
          {chips && caption ? <p className="multi-choice-caption">{caption}</p> : null}
          <p className="field-hint multi-choice-notice" role="status">
            {notice}
          </p>
        </div>
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
