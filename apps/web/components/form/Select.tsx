"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  choosePopoverSide,
  firstEnabledIndex,
  isTypeAheadKey,
  lastEnabledIndex,
  matchTypeAhead,
  nextTypeAhead,
  stepEnabled,
  type PopoverSide,
  type TypeAheadState,
} from "../../lib/select-logic";
import { ChevronDownIcon } from "../Icons";
import { useOutsideClose } from "./Combobox";

export interface SelectOption {
  value: string;
  label: string;
  /** One line under the label that says what choosing it does. */
  description?: string;
  /** Marks the option the dashboard suggests for most servers. */
  recommended?: boolean;
  disabled?: boolean;
}

interface Props {
  options: SelectOption[];
  /** Controlled use: pass `value` and `onChange`. */
  value?: string | undefined;
  onChange?(next: string): void;
  /**
   * Uncontrolled use, for a plain form that is submitted to the server: pass
   * `name` and the chosen value travels with the form.
   */
  defaultValue?: string;
  name?: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  /** The compact height used in toolbars and beside other small controls. */
  size?: "md" | "sm";
  /** Lands on the wrapper, which is what page CSS sizes. */
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

/**
 * A single choice from a short list. It looks and behaves like the channel and
 * role pickers rather than the browser's own menu, which cannot be styled and
 * differs on every platform.
 *
 * Focus moves to the list while it is open and the active row is pointed at
 * with aria-activedescendant, so rows are never focus stops of their own.
 */
export function Select({
  options,
  value,
  onChange,
  defaultValue,
  name,
  id,
  placeholder = "Choose an option",
  disabled = false,
  size = "md",
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
}: Props) {
  const generated = useId();
  const triggerId = id ?? `${generated}-trigger`;
  const valueId = `${generated}-value`;
  const listId = `${generated}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [own, setOwn] = useState(defaultValue ?? "");

  const controlled = onChange !== undefined;
  const current = controlled ? value : own;
  const selected = options.find((option) => option.value === current);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useOutsideClose(rootRef, open, () => setOpen(false));

  function pick(next: string) {
    if (onChange) onChange(next);
    else setOwn(next);
    close(true);
  }

  // The button is named by the field's label and also by its own text, so a
  // screen reader says what is chosen and not only what is being chosen.
  const triggerName = ariaLabel
    ? { "aria-label": ariaLabel, "aria-labelledby": `${triggerId} ${valueId}` }
    : labelledBy
      ? { "aria-labelledby": `${labelledBy} ${valueId}` }
      : {};

  const rootClass = ["select-root", size === "sm" ? "select-root-sm" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass} ref={rootRef}>
      {name !== undefined ? <input type="hidden" name={name} value={current ?? ""} /> : null}
      <button
        type="button"
        id={triggerId}
        ref={triggerRef}
        className="combobox-trigger select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-describedby={describedBy}
        {...triggerName}
        disabled={disabled}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="combobox-value" id={valueId}>
          {selected ? (
            <span className="combobox-option-text">{selected.label}</span>
          ) : (
            <span className="combobox-placeholder">{placeholder}</span>
          )}
        </span>
        <ChevronDownIcon className="combobox-chevron" />
      </button>

      {open ? (
        <SelectList
          listId={listId}
          options={options}
          selectedValue={current}
          rootRef={rootRef}
          label={ariaLabel}
          labelledBy={labelledBy}
          onPick={pick}
          onClose={close}
        />
      ) : null}
    </div>
  );
}

interface ListProps {
  listId: string;
  options: SelectOption[];
  selectedValue: string | undefined;
  rootRef: RefObject<HTMLDivElement | null>;
  label: string | undefined;
  labelledBy: string | undefined;
  onPick(value: string): void;
  onClose(restoreFocus: boolean): void;
}

function SelectList({
  listId,
  options,
  selectedValue,
  rootRef,
  label,
  labelledBy,
  onPick,
  onClose,
}: ListProps) {
  const baseId = useId();
  const popoverRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef<TypeAheadState>({ text: "", at: 0 });
  const initial = useMemo(() => {
    const at = options.findIndex((option) => option.value === selectedValue && !option.disabled);
    return at === -1 ? firstEnabledIndex(options) : at;
  }, [options, selectedValue]);
  const [active, setActive] = useState(initial);
  const [side, setSide] = useState<PopoverSide>("bottom");

  useEffect(() => {
    listRef.current?.focus({ preventScroll: true });
  }, []);

  // Measured before paint so the list never flashes on the wrong side.
  useLayoutEffect(() => {
    const popover = popoverRef.current;
    const root = rootRef.current;
    if (!popover || !root) return;
    const anchor = root.getBoundingClientRect();
    const bounds = clippingBounds(root);
    setSide(
      choosePopoverSide({
        below: bounds.bottom - anchor.bottom,
        above: anchor.top - bounds.top,
        height: popover.offsetHeight + 6,
      }),
    );
  }, [rootRef]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-position="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((from) => stepEnabled(options, from, 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        setActive((from) => stepEnabled(options, from, -1));
        return;
      case "Home":
        event.preventDefault();
        setActive(firstEnabledIndex(options));
        return;
      case "End":
        event.preventDefault();
        setActive(lastEnabledIndex(options));
        return;
      case "Enter":
      case " ": {
        // Without this the key would also submit a form the control sits in.
        event.preventDefault();
        const option = options[active];
        if (option && !option.disabled) onPick(option.value);
        return;
      }
      case "Escape":
        event.preventDefault();
        // Otherwise the same key press also closes whatever holds this list.
        event.stopPropagation();
        onClose(true);
        return;
      case "Tab":
        // Focus goes back to the button first, so Tab carries on from there
        // instead of from a list that is about to disappear.
        onClose(true);
        return;
      default:
        break;
    }

    if (isTypeAheadKey(event)) {
      typed.current = nextTypeAhead(typed.current, event.key, Date.now());
      const match = matchTypeAhead(options, typed.current.text, active);
      if (match !== -1) setActive(match);
    }
  }

  const naming = label ? { "aria-label": label } : labelledBy ? { "aria-labelledby": labelledBy } : {};

  return (
    <div className="combobox-popover select-popover" data-side={side} ref={popoverRef}>
      <div
        className="combobox-list select-list"
        id={listId}
        role="listbox"
        tabIndex={-1}
        ref={listRef}
        aria-activedescendant={options.length > 0 ? `${baseId}-option-${active}` : undefined}
        onKeyDown={onKeyDown}
        {...naming}
      >
        {options.map((option, position) => (
          <div
            key={option.value}
            id={`${baseId}-option-${position}`}
            data-position={position}
            role="option"
            aria-selected={option.value === selectedValue}
            aria-disabled={option.disabled ? true : undefined}
            className={position === active ? "combobox-option is-active" : "combobox-option"}
            onMouseMove={() => {
              if (position !== active && !option.disabled) setActive(position);
            }}
            onClick={() => {
              if (!option.disabled) onPick(option.value);
            }}
          >
            <span className="combobox-option-text">
              {option.label}
              {option.description ? (
                <span className="combobox-option-hint">{option.description}</span>
              ) : null}
            </span>
            {option.recommended ? <span className="recommended-tag">Recommended</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The edges of the area the list can use: the window, narrowed by the nearest
 * ancestor that scrolls or clips, such as a dialog body.
 */
function clippingBounds(from: HTMLElement): { top: number; bottom: number } {
  let top = 0;
  let bottom = window.innerHeight;
  for (let node = from.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "visible") continue;
    const rect = node.getBoundingClientRect();
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.bottom);
    break;
  }
  return { top, bottom };
}
