"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { duplicated, moved } from "../../lib/list-order";
import type { RowCardView, SheetTab, TabMark } from "../../lib/row-sheet";
import { useFlip } from "../../lib/use-flip";
import { usePresence } from "../../lib/use-presence";
import { AlertIcon, ArrowDownIcon, ArrowUpIcon, PlusIcon } from "../Icons";
import { renderEmoji } from "../messages/MessagePreview";
import { RowSheet } from "./RowSheet";

interface Props {
  items: unknown[];
  onChange(next: unknown[]): void;
  /** The add button reads "Add " + this, so pass a singular noun. */
  itemLabel: string;
  newItem(): unknown;
  copyItem?(item: unknown): unknown;
  invalidAt?(index: number): boolean;
  /** The tab holding the first setting of a row that was refused, so the sheet opens there. */
  errorTab?(index: number): string | undefined;
  min?: number;
  max?: number;
  disabled?: boolean;
  "aria-labelledby"?: string;
  listPath?: string;
  tabs: SheetTab[];
  card(item: unknown, index: number): RowCardView;
  marks(item: unknown, index: number): Record<string, TabMark>;
  renderTab(item: unknown, index: number, tab: string): ReactNode;
  /** Called before a row goes, so anything keyed by index can be let go. */
  onRowRemoved?(index: number): void;
}

const INTERACTIVE = "button, a, input, select, textarea, [role='button']";

/**
 * A list of rows drawn as cards, each opening in a sheet to be edited, for
 * rows with too many settings to unfold in place. The card is the row's
 * summary: its name, a colour dot and an emoji, the roles it names, a few
 * facts, and a note for what it still needs. The sheet is opened by the
 * card's Edit button, by clicking the card, or by adding a row.
 */
export function SheetList({
  items,
  onChange,
  itemLabel,
  newItem,
  copyItem,
  invalidAt,
  errorTab,
  min,
  max,
  disabled = false,
  "aria-labelledby": labelledBy,
  listPath,
  tabs,
  card,
  marks,
  renderTab,
  onRowRemoved,
}: Props) {
  const baseId = useId();
  const atCapacity = max !== undefined && items.length >= max;
  const short = min !== undefined && items.length < min;
  const firstTab = tabs[0]?.id ?? "";
  const sheetTabs = tabs.length > 0 ? tabs : [{ id: "", label: "" }];

  const [open, setOpen] = useState<{ index: number; tab: string } | null>(null);
  // What the sheet shows while it plays its exit, after `open` has gone.
  const lastOpen = useRef(open);
  if (open) lastOpen.current = open;
  const presence = usePresence(open !== null, 220);
  const skipExit = useRef(false);
  if (open) skipExit.current = false;
  const [announcement, setAnnouncement] = useState("");

  // Keys that follow rows when they move, so what is open inside one stays with it.
  const keys = useRef<string[]>([]);
  const seed = useRef(0);
  const newKey = () => {
    seed.current += 1;
    return `row-${seed.current}`;
  };
  if (keys.current.length > items.length) keys.current = keys.current.slice(0, items.length);
  while (keys.current.length < items.length) keys.current.push(newKey());
  const listRef = useRef<HTMLDivElement>(null);
  const flip = useFlip(listRef, keys.current.join(","));
  const focusAfterMove = useRef<{ key: string; button: "up" | "down" } | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  const invalid = items.map((_, index) => index).filter((index) => invalidAt?.(index) === true);
  const invalidKey = invalid.join(",");
  const [seenInvalid, setSeenInvalid] = useState("");
  if (invalidKey !== seenInvalid) {
    // Adjusted during render so the sheet is already open when the page looks for the first field that failed.
    setSeenInvalid(invalidKey);
    const first = invalid[0];
    if (first !== undefined) setOpen({ index: first, tab: errorTab?.(first) ?? firstTab });
  }

  useEffect(() => {
    // Discarding changes can leave fewer rows than there were.
    if (open && open.index >= items.length) setOpen(null);
  }, [open, items.length]);

  useEffect(() => {
    const target = focusAfterMove.current;
    if (!target) return;
    focusAfterMove.current = null;
    const row = document.querySelector<HTMLElement>(`[data-row-key="${baseId}-${target.key}"]`);
    const button = row?.querySelector<HTMLButtonElement>(`[data-move="${target.button}"]`);
    const other = row?.querySelector<HTMLButtonElement>(`[data-move="${target.button === "up" ? "down" : "up"}"]`);
    (button && !button.disabled ? button : other)?.focus();
  });

  const editId = (index: number) => `${baseId}-edit-${index}`;

  function close() {
    const index = open?.index;
    setOpen(null);
    if (index !== undefined) document.getElementById(editId(index))?.focus();
  }

  function move(from: number, to: number, button: "up" | "down") {
    if (disabled || to < 0 || to >= items.length || from === to) return;
    const name = card(items[from], from).title ?? `${itemLabel} ${from + 1}`;
    flip();
    const key = keys.current[from];
    keys.current = moved(keys.current, from, to);
    if (key) focusAfterMove.current = { key, button };
    setAnnouncement(`Moved ${name} to position ${to + 1} of ${items.length}.`);
    onChange(moved(items, from, to));
  }

  function add() {
    if (disabled || atCapacity) return;
    keys.current = [...keys.current, newKey()];
    setOpen({ index: items.length, tab: firstTab });
    onChange([...items, newItem()]);
  }

  function duplicate(index: number) {
    if (!copyItem || disabled || atCapacity) return;
    const copyKeys = [...keys.current];
    copyKeys.splice(index + 1, 0, newKey());
    keys.current = copyKeys;
    setAnnouncement(`Added a copy as ${itemLabel.toLowerCase()} ${index + 2}.`);
    setOpen({ index: index + 1, tab: open?.tab ?? firstTab });
    onChange(duplicated(items, index, (item) => copyItem(item)));
  }

  function remove(index: number) {
    onRowRemoved?.(index);
    keys.current = keys.current.filter((_, i) => i !== index);
    skipExit.current = true;
    setOpen(null);
    onChange(items.filter((_, i) => i !== index));
    requestAnimationFrame(() => addRef.current?.focus());
  }

  const onHeadClick = (index: number) => (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
    setOpen({ index, tab: firstTab });
  };

  const onHeadKeyDown = (index: number) => (event: KeyboardEvent<HTMLElement>) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    move(index, event.key === "ArrowUp" ? index - 1 : index + 1, event.key === "ArrowUp" ? "up" : "down");
  };

  // A removed row has nothing left to show while it fades, so that one just goes.
  const sheetShown = open ?? (presence.leaving && !skipExit.current ? lastOpen.current : null);
  const sheetItem = sheetShown ? items[sheetShown.index] : undefined;
  const sheetCard = sheetShown && sheetItem !== undefined ? card(sheetItem, sheetShown.index) : undefined;

  return (
    <div className="list sheet-list" role="group" aria-labelledby={labelledBy} data-list-path={listPath} ref={listRef}>
      {items.map((item, index) => {
        const view = card(item, index);
        const name = view.title ?? `${itemLabel} ${index + 1}`;
        const key = keys.current[index] ?? String(index);
        const isOpen = open?.index === index;
        const flagged = Object.values(marks(item, index)).includes("error");
        return (
          <div
            className="list-item sheet-card"
            key={key}
            data-row-key={`${baseId}-${key}`}
            data-layout="sheet"
            data-open={isOpen ? "true" : "false"}
            data-flagged={invalidAt?.(index) || flagged ? "true" : undefined}
          >
            <div className="list-item-head is-flush sheet-card-head" onClick={onHeadClick(index)} onKeyDown={onHeadKeyDown(index)}>
              <span className="list-item-index" aria-hidden="true">
                {index + 1}
              </span>
              <div className="sheet-card-main">
                <p className="sheet-card-title">
                  {view.emoji ? (
                    <span className="sheet-card-emoji" aria-hidden="true">
                      {renderEmoji(view.emoji)}
                    </span>
                  ) : null}
                  <span className={view.title ? "sheet-card-name" : "sheet-card-name is-placeholder"}>{name}</span>
                  {view.swatch ? (
                    <span className="sheet-card-swatch" style={{ background: view.swatch.color }} title={`${view.swatch.label} button`}>
                      <span className="visually-hidden">{view.swatch.label} button</span>
                    </span>
                  ) : null}
                </p>
                {view.chips.length > 0 ? (
                  <ul className="sheet-card-chips" aria-label="Handlers">
                    {view.chips.map((chip) => (
                      <li className="chip chip-static" key={chip.id}>
                        <span className="chip-text">{chip.label}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {view.notes.length > 0 ? (
                  <ul className="sheet-card-notes">
                    {view.notes.map((note) => (
                      <li key={note}>
                        <AlertIcon />
                        {note}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {view.facts.length > 0 ? <p className="sheet-card-facts">{view.facts.join(" · ")}</p> : null}
              </div>
              <div className="list-item-actions">
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
                  id={editId(index)}
                  className="btn btn-secondary btn-sm"
                  aria-haspopup="dialog"
                  aria-expanded={isOpen}
                  onClick={() => setOpen({ index, tab: firstTab })}
                >
                  Edit
                  <span className="visually-hidden"> {name}</span>
                </button>
              </div>
            </div>
          </div>
        );
      })}

      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>

      {short ? <p className="list-note is-short">At least {min} needed for this to do anything.</p> : null}

      <button type="button" ref={addRef} className="list-add" disabled={disabled || atCapacity} onClick={add}>
        <PlusIcon />
        {atCapacity ? `Maximum of ${max}` : `Add ${itemLabel.toLowerCase()}`}
      </button>

      {sheetShown && sheetItem !== undefined && sheetCard ? (
        <RowSheet
          key={keys.current[sheetShown.index] ?? sheetShown.index}
          title={sheetCard.title ?? `${itemLabel} ${sheetShown.index + 1}`}
          emoji={sheetCard.emoji}
          subtitle={`${itemLabel} ${sheetShown.index + 1} of ${items.length}`}
          tabs={sheetTabs}
          marks={marks(sheetItem, sheetShown.index)}
          tab={sheetTabs.some((entry) => entry.id === sheetShown.tab) ? sheetShown.tab : firstTab}
          onTab={(tab) => setOpen((current) => (current ? { ...current, tab } : current))}
          renderTab={(tab) => renderTab(sheetItem, sheetShown.index, tab)}
          noun={itemLabel.toLowerCase()}
          disabled={disabled}
          canDuplicate={copyItem !== undefined && !atCapacity}
          onDuplicate={() => duplicate(sheetShown.index)}
          onRemove={() => remove(sheetShown.index)}
          onClose={close}
          leaving={presence.leaving}
        />
      ) : null}
    </div>
  );
}
