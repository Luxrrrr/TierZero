"use client";

import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import {
  expandedAfterRemove,
  expandedWith,
  expandedWithout,
  type RowSummary,
} from "../../lib/row-summary";
import { duplicated, moved, setAfterInsert, setAfterMove } from "../../lib/list-order";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon } from "../Icons";

interface Props {
  items: unknown[];
  onChange(next: unknown[]): void;
  /** The button reads "Add " + this, so pass a singular noun. */
  itemLabel: string;
  /** What a collapsed row shows: a name for it, and the settings worth a glance. */
  describe(item: unknown, index: number): RowSummary;
  /** A fresh entry with the schema's defaults already in it. */
  newItem(): unknown;
  /** A copy of a row for Duplicate. Without it there is no Duplicate button. */
  copyItem?(item: unknown): unknown;
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
  /** The list's settings path, so a control elsewhere on the page can find and open one of its rows. */
  listPath?: string;
  /** Rows loaded from saved settings start open rather than closed. */
  startOpen?: boolean;
  children(item: unknown, index: number): ReactNode;
}

const INTERACTIVE = "button, a, input, select, textarea, [role='button']";
const CONTROLS = "input, textarea, select, button";

let keySeed = 0;
function newKey(): string {
  keySeed += 1;
  return `row-${keySeed}`;
}

export function ObjectList({
  items,
  onChange,
  itemLabel,
  describe,
  newItem,
  copyItem,
  invalidAt,
  headerStatus,
  headerActions,
  panel,
  onRowRemoved,
  min,
  max,
  disabled = false,
  "aria-labelledby": labelledBy,
  listPath,
  startOpen = false,
  children,
}: Props) {
  const baseId = useId();
  const atCapacity = max !== undefined && items.length >= max;
  const short = min !== undefined && items.length < min;

  // Rows loaded from saved settings start closed; the ones added here open.
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set(startOpen ? items.map((_, index) => index) : []));
  const focusAfterAdd = useRef<number | null>(null);
  const focusAfterMove = useRef<{ key: string; button: "up" | "down" } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // React keys that follow the rows when they move, so the state inside a
  // row's controls, such as a duration's unit, moves with its row instead of
  // staying at the old position. A change made elsewhere, such as discarding
  // the draft, only has the lengths to go on.
  const keys = useRef<string[]>([]);
  if (keys.current.length > items.length) keys.current = keys.current.slice(0, items.length);
  while (keys.current.length < items.length) keys.current.push(newKey());

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

  useEffect(() => {
    const target = focusAfterMove.current;
    if (!target) return;
    focusAfterMove.current = null;
    const row = document.querySelector<HTMLElement>(`[data-row-key="${baseId}-${target.key}"]`);
    const button = row?.querySelector<HTMLButtonElement>(`[data-move="${target.button}"]`);
    // At the top or bottom the button just used is disabled, so the other one takes focus.
    const other = row?.querySelector<HTMLButtonElement>(`[data-move="${target.button === "up" ? "down" : "up"}"]`);
    (button && !button.disabled ? button : other)?.focus();
  });

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

  function move(from: number, to: number, button?: "up" | "down") {
    if (disabled || to < 0 || to >= items.length || from === to) return;
    const name = describe(items[from], from).title ?? `${itemLabel} ${from + 1}`;
    const key = keys.current[from];
    keys.current = moved(keys.current, from, to);
    setExpanded(setAfterMove(expanded, from, to));
    if (button && key) focusAfterMove.current = { key, button };
    setAnnouncement(`Moved ${name} to position ${to + 1} of ${items.length}.`);
    onChange(moved(items, from, to));
  }

  function duplicate(index: number) {
    if (!copyItem || disabled || atCapacity) return;
    const next = duplicated(items, index, (item) => copyItem(item));
    const copyKeys = [...keys.current];
    copyKeys.splice(index + 1, 0, newKey());
    keys.current = copyKeys;
    focusAfterAdd.current = index + 1;
    setExpanded(expandedWith(setAfterInsert(expanded, index + 1), index + 1));
    setAnnouncement(`Added a copy as ${itemLabel.toLowerCase()} ${index + 2}.`);
    onChange(next);
  }

  function remove(index: number) {
    setExpanded(expandedAfterRemove(expanded, index));
    onRowRemoved?.(index);
    keys.current = keys.current.filter((_, i) => i !== index);
    onChange(items.filter((_, i) => i !== index));
  }

  function onHeadKeyDown(index: number) {
    return (event: KeyboardEvent<HTMLElement>) => {
      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      event.preventDefault();
      move(index, event.key === "ArrowUp" ? index - 1 : index + 1, event.key === "ArrowUp" ? "up" : "down");
    };
  }

  // Dragging is by the row's number, for a mouse; the arrow buttons and
  // Alt+Up or Alt+Down do the same from the keyboard.
  function dragProps(index: number) {
    if (disabled || items.length < 2) return {};
    return {
      draggable: true,
      onDragStart: (event: DragEvent<HTMLElement>) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(index));
        setDragFrom(index);
      },
      onDragEnd: () => {
        setDragFrom(null);
        setDragOver(null);
      },
    };
  }

  function dropProps(index: number) {
    if (dragFrom === null) return {};
    return {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (dragOver !== index) setDragOver(index);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        const from = dragFrom;
        setDragFrom(null);
        setDragOver(null);
        if (from !== null) move(from, index);
      },
    };
  }

  return (
    <div className="list" role="group" aria-labelledby={labelledBy} data-list-path={listPath}>
      {items.map((item, index) => {
        const open = expanded.has(index);
        const summary = describe(item, index);
        const name = summary.title ?? `${itemLabel} ${index + 1}`;
        const status = headerStatus?.(index);
        const actions = headerActions?.(index);
        const key = keys.current[index] ?? String(index);
        return (
          <div
            className="list-item"
            key={key}
            data-row-key={`${baseId}-${key}`}
            data-open={open ? "true" : "false"}
            data-invalid={invalidAt?.(index) ? "true" : undefined}
            data-dragging={dragFrom === index ? "true" : undefined}
            data-drop-target={dragOver === index && dragFrom !== index ? (dragFrom !== null && dragFrom < index ? "after" : "before") : undefined}
            {...dropProps(index)}
          >
            {/* The click is a convenience for the mouse; the Edit button is the
                keyboard and screen reader route to the same thing. */}
            <div className="list-item-head is-flush" onClick={onHeadClick(index)} onKeyDown={onHeadKeyDown(index)}>
              <span
                className="list-item-index"
                aria-hidden="true"
                title={items.length > 1 && !disabled ? "Drag to move" : undefined}
                {...dragProps(index)}
              >
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
                {items.length > 1 ? (
                  <span className="list-item-order">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-icon"
                      data-move="up"
                      disabled={disabled || index === 0}
                      aria-keyshortcuts="Alt+ArrowUp"
                      onClick={() => move(index, index - 1, "up")}
                    >
                      <ArrowUpIcon />
                      <span className="visually-hidden">Move {name} up</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-icon"
                      data-move="down"
                      disabled={disabled || index === items.length - 1}
                      aria-keyshortcuts="Alt+ArrowDown"
                      onClick={() => move(index, index + 1, "down")}
                    >
                      <ArrowDownIcon />
                      <span className="visually-hidden">Move {name} down</span>
                    </button>
                  </span>
                ) : null}
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
                  onClick={() => remove(index)}
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
                  {copyItem ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={disabled || atCapacity}
                      title={atCapacity ? `This list holds at most ${max}.` : undefined}
                      onClick={() => duplicate(index)}
                    >
                      Duplicate
                      <span className="visually-hidden"> {name}</span>
                    </button>
                  ) : null}
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

      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>

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
          keys.current = [...keys.current, newKey()];
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
