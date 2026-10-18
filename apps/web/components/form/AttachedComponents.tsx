"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { AttachButtonStyle, FieldDescriptor, MessageAttach, MessageAttachList } from "@tier0/core";
import { renderEmoji } from "../messages/MessagePreview";
import { errorSentence } from "../../lib/field-error";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, PencilIcon, PlusIcon, XIcon } from "../Icons";
import {
  BUTTON_STYLES,
  fixedButtons,
  getPath,
  isRootRef,
  listView,
  moveItem,
  refField,
  setPath,
  writeRef,
  type FixedButton,
  type ListItem,
} from "../../lib/message-attach";

type Values = Record<string, unknown>;
type Fields = Record<string, FieldDescriptor>;

export interface AttachedProps {
  attach: MessageAttach;
  /** The path of the object holding the message, as errors are keyed, or "" at the top. */
  parentPath: string;
  siblings: Values;
  siblingFields: Fields;
  setSiblings(next: Values): void;
  root: Values;
  rootFields: Fields;
  setRoot(next: Values): void;
  errors: Record<string, string>;
  disabled: boolean;
  /** A fresh row for the list, with its defaults and a new id. */
  newItem?(): unknown;
}

type Open = { kind: "item"; index: number } | { kind: "menu" } | { kind: "fixed"; index: number } | null;

const join = (parent: string, rest: string) => (parent ? `${parent}.${rest}` : rest);

/**
 * The buttons or menu a feature adds under a message, drawn the way members
 * see them and editable where they are drawn. Each piece writes the settings
 * it comes from, so a change goes through the same save bar and validation as
 * the fields further down the page. Nothing here knows which feature it is.
 */
export function AttachedComponents(props: AttachedProps) {
  const [open, setOpen] = useState<Open>(null);
  const { attach } = props;
  return (
    <div className="msg-attach" data-disabled={props.disabled ? "true" : undefined}>
      {attach.kind === "list" ? (
        <ListComponents {...props} attach={attach} open={open} setOpen={setOpen} />
      ) : (
        <FixedComponents {...props} open={open} setOpen={setOpen} />
      )}
    </div>
  );
}

interface Shared extends AttachedProps {
  open: Open;
  setOpen(next: Open): void;
}

function ListComponents(props: Shared & { attach: MessageAttachList }) {
  const { attach, siblings, siblingFields, setSiblings, parentPath, errors, disabled, open, setOpen } = props;
  const listField = siblingFields[attach.list];
  const rowFields = ((listField?.of as FieldDescriptor | undefined)?.fields ?? {}) as Fields;
  const view = listView(attach, siblings, listField);
  const rows = Array.isArray(siblings[attach.list]) ? (siblings[attach.list] as unknown[]) : [];
  const noun = attach.noun;

  const writeRow = (index: number, field: string, value: unknown) => {
    const next = rows.map((row, at) => (at === index ? setPath((row ?? {}) as Values, field, value) : row));
    setSiblings({ ...siblings, [attach.list]: next });
  };
  const move = (index: number, by: -1 | 1) => {
    setSiblings({ ...siblings, [attach.list]: moveItem(rows, index, by) });
    setOpen({ kind: "item", index: index + by });
  };
  const add = () => {
    if (view.full || !props.newItem) return;
    setSiblings({ ...siblings, [attach.list]: [...rows, props.newItem()] });
    setOpen({ kind: "item", index: rows.length });
  };
  const listPath = join(parentPath, attach.list);
  const rowError = (index: number) =>
    [attach.label, attach.emoji, attach.style, attach.description]
      .filter((field): field is string => field !== undefined)
      .map((field) => errors[`${listPath}[${index}].${field}`])
      .find(Boolean);

  const editor = (item: ListItem) => (
    <ItemEditor
      key={item.index}
      attach={attach}
      item={item}
      row={rows[item.index]}
      rowFields={rowFields}
      menu={view.mode === "menu"}
      count={rows.length}
      errors={errors}
      errorBase={`${listPath}[${item.index}]`}
      noun={noun}
      disabled={disabled}
      onWrite={(field, value) => writeRow(item.index, field, value)}
      onMove={(by) => move(item.index, by)}
      onOpenRow={() => {
        setOpen(null);
        openListRow(listPath, item.index);
      }}
      onClose={() => setOpen(null)}
    />
  );

  const canAdd = attach.add !== false;
  const addLabel = view.full
    ? `${view.max} of ${view.max}, the most Discord allows`
    : `Add a ${noun}`;

  if (view.mode === "menu") {
    const placeholderField = attach.placeholder ? siblingFields[attach.placeholder] : undefined;
    return (
      <>
        <button
          type="button"
          className="msg-select msg-attach-select"
          aria-expanded={open?.kind === "menu"}
          disabled={disabled}
          onClick={() => setOpen(open?.kind === "menu" ? null : { kind: "menu" })}
        >
          <span className="msg-select-text">{view.placeholder}</span>
          <ChevronDownIcon />
          <span className="visually-hidden">, edit the menu&apos;s placeholder</span>
        </button>
        {open?.kind === "menu" && attach.placeholder ? (
          <Popover title="Menu placeholder" onClose={() => setOpen(null)}>
            <TextField
              label="Placeholder"
              hint="The grey text in the menu before anything is picked. Empty shows Discord's own."
              value={(getPath(siblings, attach.placeholder) as string | undefined) ?? ""}
              max={typeof placeholderField?.max === "number" ? placeholderField.max : 150}
              error={errors[join(parentPath, attach.placeholder)]}
              disabled={disabled}
              onChange={(value) => setSiblings(setPath(siblings, attach.placeholder!, value))}
              autoFocus
            />
          </Popover>
        ) : null}
        <ul className="msg-attach-options" aria-label="Options in the menu">
          {view.items.map((item) => (
            <li key={item.index}>
              <button
                type="button"
                className="msg-attach-option"
                aria-expanded={open?.kind === "item" && open.index === item.index}
                data-invalid={rowError(item.index) ? "true" : undefined}
                disabled={disabled}
                onClick={() => setOpen(open?.kind === "item" && open.index === item.index ? null : { kind: "item", index: item.index })}
              >
                {item.emoji ? <span className="msg-button-emoji">{renderEmoji(item.emoji)}</span> : null}
                <span className="msg-attach-option-text">
                  <span>{item.label}</span>
                  {item.description ? <small>{item.description}</small> : null}
                </span>
                <PencilIcon className="msg-attach-pencil" />
              </button>
              {open?.kind === "item" && open.index === item.index ? editor(item) : null}
            </li>
          ))}
        </ul>
        {canAdd ? <AddButton label={addLabel} full={view.full} disabled={disabled || !props.newItem} onAdd={add} /> : null}
      </>
    );
  }

  const openItem = open?.kind === "item" ? view.items[open.index] : undefined;
  return (
    <>
      <div className="msg-components">
        {view.rows.map((row, at) => (
          <div className="msg-buttons" key={at}>
            {row.map((item) => (
              <button
                key={item.index}
                type="button"
                className={`msg-button is-${item.style} msg-attach-button`}
                aria-expanded={open?.kind === "item" && open.index === item.index}
                data-invalid={rowError(item.index) ? "true" : undefined}
                disabled={disabled}
                onClick={() => setOpen(open?.kind === "item" && open.index === item.index ? null : { kind: "item", index: item.index })}
              >
                {item.emoji ? <span className="msg-button-emoji">{renderEmoji(item.emoji)}</span> : null}
                {item.label}
                <span className="visually-hidden">, edit this button</span>
              </button>
            ))}
            {canAdd && at === view.rows.length - 1 && !view.full ? (
              <AddButton label={addLabel} full={false} disabled={disabled || !props.newItem} onAdd={add} inline />
            ) : null}
          </div>
        ))}
        {canAdd && (view.rows.length === 0 || view.full) ? (
          <div className="msg-buttons">
            <AddButton label={addLabel} full={view.full} disabled={disabled || !props.newItem} onAdd={add} inline />
          </div>
        ) : null}
      </div>
      {openItem ? editor(openItem) : null}
    </>
  );
}

function ItemEditor({
  attach,
  item,
  row,
  rowFields,
  menu,
  count,
  errors,
  errorBase,
  noun,
  disabled,
  onWrite,
  onMove,
  onOpenRow,
  onClose,
}: {
  attach: MessageAttachList;
  item: ListItem;
  row: unknown;
  rowFields: Fields;
  menu: boolean;
  count: number;
  errors: Record<string, string>;
  errorBase: string;
  noun: string;
  disabled: boolean;
  onWrite(field: string, value: unknown): void;
  onMove(by: -1 | 1): void;
  onOpenRow(): void;
  onClose(): void;
}) {
  const labelField = refField(attach.label, rowFields, {});
  const descriptionField = attach.description ? refField(attach.description, rowFields, {}) : undefined;
  const fallback = attach.labelFallback ? String(getPath(row, attach.labelFallback) ?? "") : "";
  const text = (field: string) => (getPath(row, field) as string | undefined) ?? "";
  const position = `${item.index + 1} of ${count}`;
  return (
    <Popover title={menu ? `Option ${position}` : `Button ${position}`} onClose={onClose}>
      <TextField
        label={menu ? "Option text" : "Button text"}
        hint={fallback ? `Leave empty to use the ${noun}'s name, ${fallback}.` : undefined}
        placeholder={fallback}
        value={text(attach.label)}
        max={typeof labelField?.max === "number" ? labelField.max : menu ? 100 : 80}
        error={errors[`${errorBase}.${attach.label}`]}
        disabled={disabled}
        onChange={(value) => onWrite(attach.label, value)}
        autoFocus
      />
      {attach.emoji ? (
        <TextField
          label="Emoji"
          hint="One emoji, or a custom emoji from this server written as <:name:id>. Optional."
          value={text(attach.emoji)}
          max={64}
          narrow
          error={errors[`${errorBase}.${attach.emoji}`]}
          disabled={disabled}
          onChange={(value) => onWrite(attach.emoji!, value)}
        />
      ) : null}
      {menu && attach.description ? (
        <TextField
          label="Description"
          hint="A second, quieter line under the option. Optional."
          value={text(attach.description)}
          max={typeof descriptionField?.max === "number" ? descriptionField.max : 100}
          error={errors[`${errorBase}.${attach.description}`]}
          disabled={disabled}
          onChange={(value) => onWrite(attach.description!, value)}
        />
      ) : null}
      {!menu && attach.style ? (
        <Swatches value={item.style} disabled={disabled} onChange={(style) => onWrite(attach.style!, style)} />
      ) : null}
      <div className="attach-pop-actions">
        <button type="button" className="btn btn-ghost btn-sm" disabled={disabled || item.index === 0} onClick={() => onMove(-1)}>
          <ChevronLeftIcon />
          {menu ? "Move up" : "Move left"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={disabled || item.index >= count - 1} onClick={() => onMove(1)}>
          {menu ? "Move down" : "Move right"}
          <ChevronRightIcon />
        </button>
        <span className="attach-pop-spacer" />
        <button type="button" className="link-button" onClick={onOpenRow}>
          All settings for this {noun}
        </button>
      </div>
    </Popover>
  );
}

function FixedComponents(props: Shared) {
  const { siblings, siblingFields, setSiblings, root, rootFields, setRoot, parentPath, errors, disabled, open, setOpen } = props;
  if (props.attach.kind !== "buttons") return null;
  const buttons = fixedButtons(props.attach, siblings, root, siblingFields, rootFields);
  const write = (ref: string, value: unknown) => {
    const result = writeRef(ref, value, siblings, root);
    if (result.scope === "root") setRoot(result.next);
    else setSiblings(result.next);
  };
  const errorAt = (ref: string) => errors[isRootRef(ref) ? ref.slice(1) : join(parentPath, ref)];
  const current = open?.kind === "fixed" ? buttons.find((button) => button.index === open.index) : undefined;
  return (
    <>
      <div className="msg-buttons">
        {buttons.map((button) => (
          <button
            key={button.index}
            type="button"
            className={`msg-button is-${button.style} msg-attach-button`}
            aria-expanded={current?.index === button.index}
            data-invalid={errorAt(button.labelRef) ? "true" : undefined}
            disabled={disabled}
            onClick={() => setOpen(current?.index === button.index ? null : { kind: "fixed", index: button.index })}
          >
            {button.label}
            <span className="visually-hidden">, edit the {button.name} button</span>
          </button>
        ))}
      </div>
      {current ? <FixedEditor button={current} root={root} siblings={siblings} errorAt={errorAt} disabled={disabled} onWrite={write} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function FixedEditor({
  button,
  root,
  siblings,
  errorAt,
  disabled,
  onWrite,
  onClose,
}: {
  button: FixedButton;
  root: Values;
  siblings: Values;
  errorAt(ref: string): string | undefined;
  disabled: boolean;
  onWrite(ref: string, value: unknown): void;
  onClose(): void;
}) {
  const stored = getPath(isRootRef(button.labelRef) ? root : siblings, button.labelRef.replace(/^\//, ""));
  return (
    <Popover title={`${button.name} button`} onClose={onClose}>
      <TextField
        label="Button text"
        hint="Leave empty for the usual text."
        placeholder={typeof stored === "string" ? undefined : button.label}
        value={typeof stored === "string" ? stored : ""}
        max={button.max ?? 80}
        error={errorAt(button.labelRef)}
        disabled={disabled}
        onChange={(value) => onWrite(button.labelRef, value)}
        autoFocus
      />
      {button.styleRef ? <Swatches value={button.style} disabled={disabled} onChange={(style) => onWrite(button.styleRef!, style)} /> : null}
    </Popover>
  );
}

function AddButton({ label, full, disabled, onAdd, inline = false }: { label: string; full: boolean; disabled: boolean; onAdd(): void; inline?: boolean }) {
  return (
    <button
      type="button"
      className={inline ? "msg-attach-add" : "msg-attach-add msg-attach-add--block"}
      disabled={disabled || full}
      data-full={full ? "true" : undefined}
      onClick={onAdd}
    >
      {full ? null : <PlusIcon />}
      {label}
    </button>
  );
}

function Popover({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Read while rendering, before the popover's own field takes focus, so this
  // is the button that opened it.
  const opener = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  useEffect(() => {
    const node = ref.current;
    const from = opener.current;
    return () => {
      // Closing must not leave a keyboard user at the top of the page.
      const active = document.activeElement;
      const lost = active === null || active === document.body || (node !== null && node.contains(active));
      if (lost && from?.isConnected && !node?.contains(from)) from.focus();
    };
  }, []);
  useEffect(() => {
    const node = ref.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    node?.addEventListener("keydown", onKey);
    return () => node?.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="attach-pop" ref={ref} role="group" aria-labelledby={titleId}>
      <div className="attach-pop-head">
        <p className="attach-pop-title" id={titleId}>
          {title}
        </p>
        <button type="button" className="icon-btn" aria-label="Done" onClick={onClose}>
          <XIcon />
        </button>
      </div>
      <div className="attach-pop-body">{children}</div>
    </div>
  );
}

function TextField({
  label,
  hint,
  placeholder,
  value,
  max,
  error,
  disabled,
  narrow = false,
  autoFocus = false,
  onChange,
}: {
  label: string;
  hint?: string;
  placeholder?: string;
  value: string;
  max: number;
  error?: string;
  disabled: boolean;
  narrow?: boolean;
  autoFocus?: boolean;
  onChange(value: string | undefined): void;
}) {
  const id = useId();
  return (
    <div className="attach-pop-field">
      <div className="attach-pop-label-row">
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        <span className="field-hint" aria-hidden="true">
          {value.length}/{max}
        </span>
      </div>
      <input
        id={id}
        className={narrow ? "input attach-pop-input-narrow" : "input"}
        value={value}
        placeholder={placeholder}
        maxLength={max}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
      />
      {hint ? (
        <p className="field-help" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field-error" id={`${id}-error`} role="alert">
          {errorSentence(error)}
        </p>
      ) : null}
    </div>
  );
}

function Swatches({ value, disabled, onChange }: { value: AttachButtonStyle; disabled: boolean; onChange(next: AttachButtonStyle): void }) {
  const id = useId();
  return (
    <div className="attach-pop-field" role="radiogroup" aria-labelledby={id}>
      <span className="field-label" id={id}>
        Colour
      </span>
      <div className="attach-swatches">
        {BUTTON_STYLES.map((style) => (
          <button
            key={style.value}
            type="button"
            role="radio"
            aria-checked={value === style.value}
            className={`attach-swatch msg-button is-${style.value}`}
            disabled={disabled}
            onClick={() => onChange(style.value)}
          >
            {style.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Opens a row of a list further down the form and brings it into view, for
 * "All settings for this ...". The list marks itself with its path, so this
 * finds it without knowing what it holds.
 */
function openListRow(listPath: string, index: number) {
  const list = document.querySelector<HTMLElement>(`[data-list-path="${CSS.escape(listPath)}"]`);
  const item = list?.querySelectorAll<HTMLElement>(":scope > .list-item")[index];
  if (!item) return;
  if (item.dataset.open !== "true") item.querySelector<HTMLButtonElement>(".list-item-head button[aria-expanded]")?.click();
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  requestAnimationFrame(() => {
    item.scrollIntoView({ block: "start", behavior: calm ? "auto" : "smooth" });
    item.querySelector<HTMLElement>(".list-item-body input, .list-item-body button")?.focus({ preventScroll: true });
  });
}
