import type { AttachButtonStyle, FieldDescriptor, MessageAttachButtons, MessageAttachList } from "@tier0/core";

/**
 * What a feature adds under a message it sends, worked out from the settings
 * draft, and the paths each piece is edited at. Free of React so the tests can
 * import it directly. Nothing here knows which module it is reading.
 */

type Values = Record<string, unknown>;
type Fields = Record<string, FieldDescriptor>;

/** Discord's own limits on buttons and menu options. */
export const BUTTONS_PER_ROW = 5;
export const MAX_COMPONENTS = 25;

export const BUTTON_STYLES: readonly { value: AttachButtonStyle; label: string }[] = [
  { value: "primary", label: "Blurple" },
  { value: "secondary", label: "Grey" },
  { value: "success", label: "Green" },
  { value: "danger", label: "Red" },
];

const isRecord = (value: unknown): value is Values => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export function isButtonStyle(value: unknown): value is AttachButtonStyle {
  return value === "primary" || value === "secondary" || value === "success" || value === "danger";
}

/** The value at a dotted path, or undefined. */
export function getPath(source: unknown, path: string): unknown {
  let at: unknown = source;
  for (const key of path.split(".")) {
    if (!isRecord(at)) return undefined;
    at = at[key];
  }
  return at;
}

/** A copy of `source` with the value at a dotted path replaced, creating objects on the way. */
export function setPath(source: Values, path: string, value: unknown): Values {
  const [key, ...rest] = path.split(".");
  if (key === undefined) return source;
  if (rest.length === 0) {
    const next = { ...source };
    if (value === undefined) delete next[key];
    else next[key] = value;
    return next;
  }
  const child = isRecord(source[key]) ? (source[key] as Values) : {};
  return { ...source, [key]: setPath(child, rest.join("."), value) };
}

/** Whether a reference starts from the settings root rather than from beside the message. */
export const isRootRef = (ref: string) => ref.startsWith("/");
const bare = (ref: string) => (isRootRef(ref) ? ref.slice(1) : ref);

/** Reads a reference against the object holding the message, or the root. */
export function readRef(ref: string, siblings: Values, root: Values): unknown {
  return getPath(isRootRef(ref) ? root : siblings, bare(ref));
}

/** The descriptor a dotted path names inside an object's fields. */
export function fieldAtPath(fields: Fields, path: string): FieldDescriptor | undefined {
  const [key, ...rest] = path.split(".");
  const field = key === undefined ? undefined : fields[key];
  if (!field || rest.length === 0) return field;
  return field.kind === "object" ? fieldAtPath((field.fields ?? {}) as Fields, rest.join(".")) : undefined;
}

/** The descriptor a reference names. */
export function refField(ref: string, siblingFields: Fields, rootFields: Fields): FieldDescriptor | undefined {
  return fieldAtPath(isRootRef(ref) ? rootFields : siblingFields, bare(ref));
}

/** What a setting holds, or its default when the draft has nothing there yet. */
function valueOrDefault(value: unknown, field: FieldDescriptor | undefined): unknown {
  return value === undefined || value === null ? field?.default : value;
}

// -- one button per row of a list -----------------------------------------------

export interface ListItem {
  index: number;
  label: string;
  /** The label came from the fallback, as the button text was left empty. */
  fallback: boolean;
  emoji: string;
  style: AttachButtonStyle;
  description: string;
}

export interface ListView {
  mode: "buttons" | "menu";
  items: ListItem[];
  /** The buttons in rows of five, as Discord lays them out. */
  rows: ListItem[][];
  placeholder: string;
  /** The list holds as many rows as it may. */
  full: boolean;
  max: number;
}

/** The text Discord shows on a menu with no placeholder. */
export const DEFAULT_MENU_TEXT = "Make a selection";

export function listView(attach: MessageAttachList, siblings: Values, listField?: FieldDescriptor): ListView {
  const rows = Array.isArray(siblings[attach.list]) ? (siblings[attach.list] as unknown[]) : [];
  const max = Math.min(typeof listField?.max === "number" ? listField.max : MAX_COMPONENTS, MAX_COMPONENTS);
  const items = rows.slice(0, MAX_COMPONENTS).map((row, index): ListItem => {
    const label = text(getPath(row, attach.label));
    const fallback = attach.labelFallback ? text(getPath(row, attach.labelFallback)) : "";
    const style = attach.style ? getPath(row, attach.style) : undefined;
    return {
      index,
      label: label || fallback || `Option ${index + 1}`,
      fallback: label === "",
      emoji: attach.emoji ? text(getPath(row, attach.emoji)) : "",
      style: isButtonStyle(style) ? style : "primary",
      description: attach.description ? text(getPath(row, attach.description)) : "",
    };
  });
  const menu = attach.mode !== undefined && getPath(siblings, attach.mode.field) === attach.mode.menu;
  const chunked: ListItem[][] = [];
  for (let at = 0; at < items.length; at += BUTTONS_PER_ROW) chunked.push(items.slice(at, at + BUTTONS_PER_ROW));
  return {
    mode: menu ? "menu" : "buttons",
    items,
    rows: chunked,
    placeholder: attach.placeholder ? text(getPath(siblings, attach.placeholder)) || DEFAULT_MENU_TEXT : DEFAULT_MENU_TEXT,
    full: rows.length >= max,
    max,
  };
}

/** A list with one row moved by one place, or unchanged at either end. */
export function moveItem<T>(items: readonly T[], index: number, by: -1 | 1): T[] {
  const target = index + by;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return [...items];
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved as T);
  return next;
}

// -- buttons kept in other settings ------------------------------------------------

export interface FixedButton {
  index: number;
  name: string;
  label: string;
  style: AttachButtonStyle;
  labelRef: string;
  styleRef: string | null;
  /** The longest text the label setting takes. */
  max: number | null;
}

export function fixedButtons(
  attach: MessageAttachButtons,
  siblings: Values,
  root: Values,
  siblingFields: Fields = {},
  rootFields: Fields = {},
): FixedButton[] {
  return attach.buttons.flatMap((button, index): FixedButton[] => {
    if (button.when !== undefined) {
      const on = valueOrDefault(readRef(button.when, siblings, root), refField(button.when, siblingFields, rootFields));
      if (on !== true) return [];
    }
    const labelField = refField(button.label, siblingFields, rootFields);
    const label = text(valueOrDefault(readRef(button.label, siblings, root), labelField));
    const styleField = button.style ? refField(button.style, siblingFields, rootFields) : undefined;
    const style = button.style ? valueOrDefault(readRef(button.style, siblings, root), styleField) : undefined;
    return [
      {
        index,
        name: button.name,
        label: label || button.name,
        style: isButtonStyle(style) ? style : (button.defaultStyle ?? "secondary"),
        labelRef: button.label,
        styleRef: button.style ?? null,
        max: typeof labelField?.max === "number" ? labelField.max : null,
      },
    ];
  });
}

/** Writes a reference, into the object beside the message or into the root. */
export function writeRef(
  ref: string,
  value: unknown,
  siblings: Values,
  root: Values,
): { scope: "siblings"; next: Values } | { scope: "root"; next: Values } {
  return isRootRef(ref)
    ? { scope: "root", next: setPath(root, bare(ref), value) }
    : { scope: "siblings", next: setPath(siblings, bare(ref), value) };
}
