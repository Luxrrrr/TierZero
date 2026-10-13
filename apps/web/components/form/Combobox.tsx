"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { ChevronDownIcon, PlusIcon, SearchIcon, XIcon } from "../Icons";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Heading this option sits under. Options keep the order they are given in. */
  group?: string;
  /** A short aside on the right of the row, such as why it cannot be picked. */
  note?: string;
  /** A line under the label that says what choosing it does. */
  hint?: string;
  disabled?: boolean;
  icon?: ReactNode;
  /** Extra text the search should match on, beyond the label. */
  keywords?: string;
}

interface SharedProps {
  options: ComboboxOption[];
  disabled?: boolean;
  /** The list is still being fetched. */
  loading?: boolean;
  /** Fills the width of its column instead of stopping at the default 24rem. */
  wide?: boolean;
  searchLabel?: string;
  searchPlaceholder?: string;
  /** Shown when the search matches nothing. */
  emptyText?: string;
  /** A standing note under the list, such as why a row cannot be picked. */
  footer?: ReactNode;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

interface SingleProps extends SharedProps {
  /** Shows the search box. Turn it off for a short list that fits on screen. */
  searchable?: boolean;
  id: string;
  value: string | undefined;
  onChange(next: string | undefined): void;
  placeholder?: string;
  /** How to name a stored value that is no longer in the list. */
  missingLabel?: string;
  /** Offers a row that empties the field. */
  clearable?: boolean;
  clearLabel?: string;
}

/**
 * A row whose value is the empty string clears the field. No Discord id is ever
 * empty, so nothing else can collide with it.
 */
const CLEAR = "";

export function Combobox({
  id,
  value,
  onChange,
  options,
  disabled = false,
  loading = false,
  wide = false,
  placeholder = "Choose one",
  missingLabel,
  clearable = false,
  clearLabel = "Clear this",
  searchable = true,
  searchLabel = "Search",
  searchPlaceholder = "Search",
  emptyText = "Nothing matches that.",
  footer,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
}: SingleProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useOutsideClose(rootRef, open, () => setOpen(false));

  const selected = options.find((option) => option.value === value);
  const listOptions = useMemo(() => {
    if (!clearable || value === undefined) return options;
    return [{ value: CLEAR, label: clearLabel, icon: <XIcon /> }, ...options];
  }, [clearable, clearLabel, options, value]);

  return (
    <div className={wide ? "combobox combobox-wide" : "combobox"} ref={rootRef}>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className="combobox-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        disabled={disabled || loading}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="combobox-value">
          {loading ? (
            <span className="combobox-placeholder">Loading…</span>
          ) : selected ? (
            <>
              {selected.icon}
              <span className="combobox-option-text">{selected.label}</span>
            </>
          ) : value !== undefined && missingLabel ? (
            <span className="combobox-option-text">{missingLabel}</span>
          ) : (
            <span className="combobox-placeholder">{placeholder}</span>
          )}
        </span>
        <ChevronDownIcon className="combobox-chevron" />
      </button>

      {open ? (
        <Popup
          options={listOptions}
          selectedValues={value === undefined ? [] : [value]}
          searchable={searchable}
          searchLabel={searchLabel}
          searchPlaceholder={searchPlaceholder}
          emptyText={emptyText}
          footer={footer}
          onPick={(picked) => {
            onChange(picked === CLEAR ? undefined : picked);
            close(true);
          }}
          onClose={close}
        />
      ) : null}
    </div>
  );
}

interface MultiProps extends SharedProps {
  id: string;
  values: string[];
  onChange(next: string[]): void;
  max?: number;
  /** The label on the dashed trigger that opens the list. */
  addLabel?: string;
  /** Stands in for the chips when nothing is chosen, such as "Anyone". */
  emptyLabel?: string;
  /** Names a stored value that is no longer in the list. */
  missingLabel?: string;
}

export function MultiCombobox({
  id,
  values,
  onChange,
  options,
  max,
  disabled = false,
  loading = false,
  wide = true,
  addLabel = "Add",
  emptyLabel,
  missingLabel = "No longer on the server",
  searchLabel = "Search",
  searchPlaceholder = "Search",
  emptyText = "Nothing matches that.",
  footer,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
}: MultiProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useOutsideClose(rootRef, open, () => setOpen(false));

  const atCapacity = max !== undefined && values.length >= max;
  const byValue = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options],
  );
  const available = useMemo(
    () => options.filter((option) => !values.includes(option.value)),
    [options, values],
  );

  return (
    <div className={wide ? "combobox combobox-wide" : "combobox"} ref={rootRef}>
      <div className="chip-list">
        {values.length === 0 && emptyLabel ? <span className="faint">{emptyLabel}</span> : null}
        {values.map((selectedValue) => {
          const option = byValue.get(selectedValue);
          const label = option?.label ?? missingLabel;
          return (
            <span className="chip" key={selectedValue}>
              {option?.icon}
              <span className="chip-text">{label}</span>
              <button
                type="button"
                className="chip-remove"
                aria-label={`Remove ${label}`}
                disabled={disabled}
                onClick={() => onChange(values.filter((v) => v !== selectedValue))}
              >
                <XIcon />
              </button>
            </span>
          );
        })}

        <button
          type="button"
          id={id}
          ref={triggerRef}
          className="chip-add"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={labelledBy ? `${id}-add ${labelledBy}` : undefined}
          aria-describedby={describedBy}
          disabled={disabled || loading || atCapacity}
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          <PlusIcon />
          <span id={`${id}-add`}>{loading ? "Loading…" : addLabel}</span>
        </button>
      </div>

      {atCapacity ? <p className="field-hint">Maximum of {max}.</p> : null}

      {open ? (
        <Popup
          options={available}
          selectedValues={[]}
          searchLabel={searchLabel}
          searchPlaceholder={searchPlaceholder}
          emptyText={available.length === 0 ? "Everything is already added." : emptyText}
          footer={footer}
          onPick={(picked) => {
            onChange([...values, picked]);
            if (max !== undefined && values.length + 1 >= max) close(true);
          }}
          onClose={close}
        />
      ) : null}
    </div>
  );
}

interface PopupProps {
  options: ComboboxOption[];
  selectedValues: string[];
  searchable?: boolean;
  searchLabel: string;
  searchPlaceholder: string;
  emptyText: string;
  footer?: ReactNode;
  onPick(value: string): void;
  onClose(restoreFocus: boolean): void;
}

interface PositionedOption {
  option: ComboboxOption;
  position: number;
}

interface OptionGroup {
  key: number;
  name: string | undefined;
  rows: PositionedOption[];
}

/**
 * The list itself: a search field carrying the keyboard model, and a listbox
 * whose active row is pointed at by aria-activedescendant rather than by moving
 * focus, which is what lets someone type and arrow around at the same time.
 */
function Popup({
  options,
  selectedValues,
  searchable = true,
  searchLabel,
  searchPlaceholder,
  emptyText,
  footer,
  onPick,
  onClose,
}: PopupProps) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      `${option.label} ${option.keywords ?? ""}`.toLowerCase().includes(needle),
    );
  }, [options, query]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    setActive(firstEnabled(visible));
  }, [visible]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-position="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function move(delta: number) {
    if (visible.length === 0) return;
    let next = active;
    for (let step = 0; step < visible.length; step += 1) {
      next = (next + delta + visible.length) % visible.length;
      if (!visible[next]?.disabled) break;
    }
    setActive(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
        event.preventDefault();
        setActive(firstEnabled(visible));
        break;
      case "End":
        event.preventDefault();
        setActive(lastEnabled(visible));
        break;
      case "Enter": {
        event.preventDefault();
        const option = visible[active];
        if (option && !option.disabled) onPick(option.value);
        break;
      }
      case "Escape":
        event.preventDefault();
        // Otherwise the same key press also closes whatever holds this popup.
        event.stopPropagation();
        onClose(true);
        break;
      case "Tab":
        onClose(false);
        break;
      default:
        break;
    }
  }

  return (
    <div className="combobox-popover">
      <div className={searchable ? "combobox-search" : "combobox-search visually-hidden"}>
        <SearchIcon />
        <input
          ref={searchRef}
          type="text"
          role="combobox"
          aria-label={searchLabel}
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={visible.length > 0 ? optionId(baseId, active) : undefined}
          placeholder={searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>

      {visible.length === 0 ? <p className="combobox-empty">{emptyText}</p> : null}

      <div className="combobox-list" id={listId} role="listbox" ref={listRef}>
        {groupOptions(visible).map((group) =>
          group.name === undefined ? (
            group.rows.map((row) => renderOption(row))
          ) : (
            <div
              role="group"
              aria-labelledby={`${baseId}-group-${group.key}`}
              key={`group-${group.key}`}
            >
              <div className="combobox-group-label" id={`${baseId}-group-${group.key}`}>
                {group.name}
              </div>
              {group.rows.map((row) => renderOption(row))}
            </div>
          ),
        )}
      </div>

      {footer ? <div className="combobox-foot">{footer}</div> : null}
    </div>
  );

  function renderOption({ option, position }: PositionedOption) {
    return (
      <div
        key={option.value}
        id={optionId(baseId, position)}
        data-position={position}
        role="option"
        aria-selected={selectedValues.includes(option.value)}
        aria-disabled={option.disabled ? true : undefined}
        className={position === active ? "combobox-option is-active" : "combobox-option"}
        onMouseMove={() => {
          if (position !== active) setActive(position);
        }}
        onClick={() => {
          if (!option.disabled) onPick(option.value);
        }}
      >
        {option.icon}
        <span className="combobox-option-text">
          {option.label}
          {option.hint ? <span className="combobox-option-hint">{option.hint}</span> : null}
        </span>
        {option.note ? <span className="combobox-option-note">{option.note}</span> : null}
      </div>
    );
  }
}

/** Runs of options sharing a heading, in the order the caller sorted them. */
function groupOptions(options: ComboboxOption[]): OptionGroup[] {
  const groups: OptionGroup[] = [];
  options.forEach((option, position) => {
    const last = groups[groups.length - 1];
    if (last && last.name === option.group) last.rows.push({ option, position });
    else groups.push({ key: groups.length, name: option.group, rows: [{ option, position }] });
  });
  return groups;
}

function firstEnabled(options: ComboboxOption[]): number {
  const index = options.findIndex((option) => !option.disabled);
  return index === -1 ? 0 : index;
}

function lastEnabled(options: ComboboxOption[]): number {
  for (let i = options.length - 1; i >= 0; i -= 1) {
    if (!options[i]?.disabled) return i;
  }
  return 0;
}

function optionId(base: string, position: number): string {
  return `${base}-option-${position}`;
}

/** Closes the list when the next press of a pointer lands anywhere else. */
export function useOutsideClose(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onOutside: () => void,
) {
  const handler = useRef(onOutside);
  handler.current = onOutside;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Node && ref.current?.contains(target)) return;
      handler.current();
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [ref, open]);
}
