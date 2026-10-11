"use client";

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  expandedAfterRemove,
  expandedWith,
  expandedWithout,
  type RowSummary,
} from "../../lib/row-summary";
import { PlusIcon } from "../Icons";

interface Props {
  items: unknown[];
  onChange(next: unknown[]): void;
  /** The button reads "Add " + this, so pass a singular noun. */
  itemLabel: string;
  /** What a collapsed row shows: a name for it, and the settings worth a glance. */
  describe(item: unknown, index: number): RowSummary;
  /** A fresh entry with the schema's defaults already in it. */
  newItem(): unknown;
  invalidAt?(index: number): boolean;
  /** Right of the name, before the buttons: a status line, say. */
  headerStatus?(index: number): ReactNode;
  /** Buttons that sit ahead of Edit and Remove. */
  headerActions?(index: number): ReactNode;
  /** Drawn under a row's header whether or not the row is open. */
  panel?(index: number): ReactNode;
  /** Called before the row goes, so anything keyed by index can be let go. */
  onRowRemoved?(index: number): void;
  min?: number;
  max?: number;
  disabled?: boolean;
  "aria-labelledby"?: string;
  children(item: unknown, index: number): ReactNode;
}

const INTERACTIVE = "button, a, input, select, textarea, [role='button']";
const CONTROLS = "input, textarea, select, button";

export function ObjectList({
  items,
  onChange,
  itemLabel,
  describe,
  newItem,
  invalidAt,
  headerStatus,
  headerActions,
  panel,
  onRowRemoved,
  min,
  max,
  disabled = false,
  "aria-labelledby": labelledBy,
  children,
}: Props) {
  const baseId = useId();
  const atCapacity = max !== undefined && items.length >= max;
  const short = min !== undefined && items.length < min;

  // Rows loaded from saved settings start closed; the ones added here open.
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const focusAfterAdd = useRef<number | null>(null);

  const invalid = items.map((_, index) => index).filter((index) => invalidAt?.(index) === true);
  const invalidKey = invalid.join(",");
  const [seenInvalid, setSeenInvalid] = useState("");
  if (invalidKey !== seenInvalid) {
    // Adjusting state during render rather than in an effect, so the row is
    // already open when the page looks for the first field that failed.
    setSeenInvalid(invalidKey);
    if (invalid.length > 0) setExpanded(expandedWith(expanded, ...invalid));
  }

  useEffect(() => {
    // Discarding changes can leave fewer rows than there are remembered.
    if ([...expanded].some((index) => index >= items.length)) {
      setExpanded(new Set([...expanded].filter((index) => index < items.length)));
    }
  }, [expanded, items.length]);

  useEffect(() => {
    const index = focusAfterAdd.current;
    if (index === null) return;
    focusAfterAdd.current = null;
    document
      .getElementById(bodyId(baseId, index))
      ?.querySelector<HTMLElement>(CONTROLS)
      ?.focus();
  }, [baseId, items.length]);

  const toggle = (index: number) =>
    setExpanded((current) =>
      current.has(index) ? expandedWithout(current, index) : expandedWith(current, index),
    );

  const collapseFromBody = (index: number) => {
    setExpanded((current) => expandedWithout(current, index));
    document.getElementById(toggleId(baseId, index))?.focus();
  };

  const onHeadClick = (index: number) => (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
    toggle(index);
  };

  return (
    <div className="list" role="group" aria-labelledby={labelledBy}>
      {items.map((item, index) => {
        const open = expanded.has(index);
        const summary = describe(item, index);
        const name = summary.title ?? `${itemLabel} ${index + 1}`;
        const status = headerStatus?.(index);
        const actions = headerActions?.(index);
        return (
          <div
            className="list-item"
            key={index}
            data-open={open ? "true" : "false"}
            data-invalid={invalidAt?.(index) ? "true" : undefined}
          >
            {/* The click is a convenience for the mouse; the Edit button is the
                keyboard and screen reader route to the same thing. */}
            <div className="list-item-head is-flush" onClick={onHeadClick(index)}>
              <span className="list-item-index" aria-hidden="true">
                {index + 1}
              </span>
              <div className="list-item-main">
                <span
                  className={summary.title ? "list-item-summary" : "list-item-summary is-placeholder"}
                >
                  {name}
                </span>
                {summary.detail ? (
                  <span className="list-item-detail" title={summary.detail}>
                    {summary.detail}
                  </span>
                ) : null}
              </div>
              {status ? <div className="list-item-status">{status}</div> : null}
              <div className="list-item-actions">
                {actions}
                <button
                  type="button"
                  id={toggleId(baseId, index)}
                  className="btn btn-ghost btn-sm"
                  aria-expanded={open}
                  aria-controls={open ? bodyId(baseId, index) : undefined}
                  onClick={() => toggle(index)}
                >
                  {open ? "Done" : "Edit"}
                  <span className="visually-hidden"> {name}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={disabled}
                  onClick={() => {
                    setExpanded(expandedAfterRemove(expanded, index));
                    onRowRemoved?.(index);
                    onChange(items.filter((_, i) => i !== index));
                  }}
                >
                  Remove
                  <span className="visually-hidden"> {name}</span>
                </button>
              </div>
            </div>

            {panel?.(index)}

            {open ? (
              <div className="list-item-body" id={bodyId(baseId, index)}>
                <div className="form-grid">{children(item, index)}</div>
                <div className="list-item-foot">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => collapseFromBody(index)}
                  >
                    Done
                    <span className="visually-hidden"> editing {name}</span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}

      {short ? (
        <p className="list-note is-short">
          At least {min} needed for this to do anything.
        </p>
      ) : null}

      <button
        type="button"
        className="list-add"
        disabled={disabled || atCapacity}
        onClick={() => {
          focusAfterAdd.current = items.length;
          setExpanded(expandedWith(expanded, items.length));
          onChange([...items, newItem()]);
        }}
      >
        <PlusIcon />
        {atCapacity ? `Maximum of ${max}` : `Add ${itemLabel.toLowerCase()}`}
      </button>
    </div>
  );
}

function bodyId(base: string, index: number): string {
  return `${base}-body-${index}`;
}

function toggleId(base: string, index: number): string {
  return `${base}-toggle-${index}`;
}
