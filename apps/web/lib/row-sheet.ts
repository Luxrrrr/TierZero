import type { FieldDescriptor, RowCard } from "@tier0/core";

/**
 * How a row of a list drawn with `layout: "sheet"` is split into tabs and
 * summarised on its card. Every setting in the row, however deep inside its
 * groups, names its tab with `section`; a group's own `section` is the default
 * for what is inside it. Tabs are listed in the order their first setting
 * appears. A setting that names none goes in the first tab, so nothing a
 * module forgot to place is hidden. Free of React, and of the dashboard's
 * other modules, so the tests can import it directly.
 */

type Fields = Record<string, FieldDescriptor>;

// Small helpers the dashboard has elsewhere, repeated here so this file imports
// nothing of the dashboard's.
const stripIndices = (path: string): string => path.replace(/\[\d+\]/g, "");

function sectionLabel(id: string): string {
  const spaced = id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function humanize(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function isFilled(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function conditionHolds(when: unknown, row: Record<string, unknown>): boolean {
  if (typeof when !== "object" || when === null) return true;
  const { field, equals, includes } = when as { field?: unknown; equals?: unknown; includes?: unknown };
  if (typeof field !== "string") return true;
  const actual = row[field];
  if (includes !== undefined) return Array.isArray(actual) && actual.includes(includes);
  if (equals !== undefined) return actual === equals;
  return !isBlank(actual);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export interface SheetTab {
  id: string;
  label: string;
}

/** What a tab is flagged for: a setting that was refused, or one still empty that the row needs. */
export type TabMark = "error" | "needed";

export interface RowNote {
  /** The setting's path from the row, such as `opening.category`. */
  path: string;
  tab: string;
  text: string;
}

function own(field: FieldDescriptor): string | undefined {
  return typeof field.section === "string" && field.section.trim() !== "" ? field.section : undefined;
}

function isGenerated(field: FieldDescriptor): boolean {
  return field.kind === "string" && field.generated === true;
}

/** The tabs of a row, in order. Empty when no setting of the row names one. */
export function sheetTabs(rowFields: Fields): SheetTab[] {
  const ids: string[] = [];
  const visit = (fields: Fields, inherited: string | undefined) => {
    for (const field of Object.values(fields)) {
      if (isGenerated(field)) continue;
      const here = own(field) ?? inherited;
      if (field.kind === "object") {
        visit((field.fields ?? {}) as Fields, here);
        continue;
      }
      if (here !== undefined && !ids.includes(here)) ids.push(here);
    }
  };
  visit(rowFields, undefined);
  return ids.map((id) => ({ id, label: sectionLabel(id) }));
}

/**
 * The settings of a row that belong in one tab, with every group trimmed to
 * what is in it and headed by its `tabLabels` entry for that tab. A group with
 * nothing in the tab is left out.
 */
export function fieldsForTab(rowFields: Fields, tab: string, first: string): Fields {
  const prune = (fields: Fields, inherited: string | undefined): Fields => {
    const kept: Fields = {};
    for (const [key, field] of Object.entries(fields)) {
      const here = own(field) ?? inherited;
      if (field.kind === "object") {
        const inside = prune((field.fields ?? {}) as Fields, here);
        if (Object.keys(inside).length === 0) continue;
        const labels = field.tabLabels as Record<string, string> | undefined;
        kept[key] = { ...field, label: labels?.[tab] ?? field.label, fields: inside };
        continue;
      }
      if ((here ?? first) === tab) kept[key] = field;
    }
    return kept;
  };
  return prune(rowFields, undefined);
}

/** The tab a setting at `path` (from the row, indices allowed) is drawn in. */
export function tabOfPath(rowFields: Fields, path: string, first: string): string {
  const keys = stripIndices(path)
    .split(".")
    .filter((key) => key !== "");
  let fields = rowFields;
  let inherited: string | undefined;
  let found: string | undefined;
  for (const key of keys) {
    const field = fields[key];
    if (!field) break;
    const here = own(field) ?? inherited;
    found = here;
    if (field.kind !== "object") break;
    fields = (field.fields ?? {}) as Fields;
    inherited = here;
  }
  return found ?? first;
}

/**
 * The settings of a row that are empty and that a row is better off with:
 * those marked `essential` and those carrying a `nudge`. A setting whose
 * condition is not met is not asked for. Each note says it in a few words.
 */
export function rowNotes(rowFields: Fields, row: Record<string, unknown>, first: string): RowNote[] {
  const notes: RowNote[] = [];
  const visit = (fields: Fields, values: Record<string, unknown>, prefix: string, inherited: string | undefined) => {
    // A setting nobody saved yet runs on its default, which is what a condition on it reads.
    const effective: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(fields)) effective[key] = values[key] === undefined ? field.default : values[key];
    for (const [key, field] of Object.entries(fields)) {
      if (isGenerated(field)) continue;
      if (!conditionHolds(field.when, effective)) continue;
      const here = own(field) ?? inherited;
      const path = prefix === "" ? key : `${prefix}.${key}`;
      if (field.kind === "object") {
        visit((field.fields ?? {}) as Fields, record(values[key]), path, here);
        continue;
      }
      if (!isBlank(effective[key])) continue;
      const nudge = typeof field.nudge === "string" && field.nudge !== "" ? field.nudge : undefined;
      if (nudge === undefined && field.essential !== true) continue;
      const label = typeof field.label === "string" ? field.label : key;
      notes.push({ path, tab: here ?? first, text: nudge ?? `No ${label.toLowerCase()} yet` });
    }
  };
  visit(rowFields, row, "", undefined);
  return notes;
}

/**
 * What each tab of a row is flagged for. `errors` are the refused settings'
 * paths from the row. A refusal outranks something merely empty.
 */
export function tabMarks(rowFields: Fields, row: Record<string, unknown>, errors: readonly string[], first: string): Record<string, TabMark> {
  const marks: Record<string, TabMark> = {};
  for (const note of rowNotes(rowFields, row, first)) marks[note.tab] = "needed";
  for (const path of errors) marks[tabOfPath(rowFields, path, first)] = "error";
  return marks;
}

/** The part of an error path after the row's own, or null when the error is about something else. */
export function pathInRow(errorPath: string, rowPath: string): string | null {
  if (errorPath === rowPath) return "";
  return errorPath.startsWith(`${rowPath}.`) ? errorPath.slice(rowPath.length + 1) : null;
}

// -- the card ----------------------------------------------------------------

export interface CardLabels {
  /** "@Support", or a short fallback while the list loads. */
  role(id: string): string;
}

export interface RowCardView {
  title: string | undefined;
  emoji: string | undefined;
  swatch: { color: string; label: string } | undefined;
  chips: { id: string; label: string }[];
  facts: string[];
  notes: string[];
}

type Option = { value: string; label: string; swatch?: string };

/** The setting at a dotted path from the row, with the values beside it so its condition can be read. */
function locate(
  rowFields: Fields,
  row: Record<string, unknown>,
  path: string,
): { field: FieldDescriptor; key: string; value: unknown; siblings: Record<string, unknown> } | undefined {
  const keys = path.split(".");
  let fields = rowFields;
  let values = row;
  for (let at = 0; at < keys.length; at += 1) {
    const key = keys[at] ?? "";
    const field = fields[key];
    if (!field) return undefined;
    if (at === keys.length - 1) {
      const effective: Record<string, unknown> = {};
      for (const [name, sibling] of Object.entries(fields)) effective[name] = values[name] === undefined ? sibling.default : values[name];
      return { field, key, value: effective[key], siblings: effective };
    }
    if (field.kind !== "object") return undefined;
    fields = (field.fields ?? {}) as Fields;
    values = record(values[key]);
  }
  return undefined;
}

/** "Ticket types" counted as one reads "ticket type": the first plural word is the one that changes. */
function singular(label: string): string {
  const words = label.toLowerCase().split(" ");
  const at = words.findIndex((word) => word.endsWith("s") && !word.endsWith("ss"));
  if (at === -1) return words.join(" ");
  const word = words[at] ?? "";
  words[at] = word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.slice(0, -1);
  return words.join(" ");
}

function fact(field: FieldDescriptor, key: string, value: unknown): string | undefined {
  const label = typeof field.label === "string" ? field.label : humanize(key);
  switch (field.kind) {
    case "choice": {
      if (typeof value !== "string" || value === "") return undefined;
      const options = (field.options ?? []) as Option[];
      return options.find((option) => option.value === value)?.label ?? value;
    }
    case "array": {
      const count = Array.isArray(value) ? value.length : 0;
      const named = typeof field.item === "string" && field.item !== "";
      const one = named ? String(field.item) : singular(label);
      const many = named ? `${String(field.item)}s` : label.toLowerCase();
      if (count === 0) return `No ${many}`;
      return count === 1 ? `1 ${one}` : `${count} ${many}`;
    }
    case "string":
      return isFilled(value) ? value : undefined;
    case "integer":
      return typeof value === "number" ? `${label} ${value}` : undefined;
    case "boolean":
      return value === true ? label : undefined;
    default:
      return undefined;
  }
}

/**
 * What a row's card shows, read from the schema's `card` paths: the first
 * filled text setting as its name, an emoji, the colour of a choice whose
 * options carry a swatch, the roles of a list as chips, a few short facts, and
 * a note for each thing the row still needs.
 */
export function rowCard(row: Record<string, unknown>, rowFields: Fields, card: RowCard, labels: CardLabels, first: string): RowCardView {
  let title: string | undefined;
  for (const [key, field] of Object.entries(rowFields)) {
    if (field.kind !== "string" || isGenerated(field) || !conditionHolds(field.when, row)) continue;
    const value = row[key];
    if (isFilled(value)) {
      title = value;
      break;
    }
  }

  const emojiAt = card.emoji ? locate(rowFields, row, card.emoji) : undefined;
  const emoji = isFilled(emojiAt?.value) ? emojiAt.value : undefined;

  let swatch: RowCardView["swatch"];
  const swatchAt = card.swatch ? locate(rowFields, row, card.swatch) : undefined;
  if (swatchAt) {
    const chosen = ((swatchAt.field.options ?? []) as Option[]).find((option) => option.value === swatchAt.value);
    if (chosen?.swatch) swatch = { color: chosen.swatch, label: chosen.label };
  }

  const chipsAt = card.chips ? locate(rowFields, row, card.chips) : undefined;
  const ids = chipsAt && Array.isArray(chipsAt.value) ? chipsAt.value.filter(isFilled) : [];

  const facts: string[] = [];
  for (const path of card.facts ?? []) {
    const at = locate(rowFields, row, path);
    if (!at || !conditionHolds(at.field.when, at.siblings)) continue;
    const text = fact(at.field, at.key, at.value);
    if (text) facts.push(text);
  }

  return {
    title,
    emoji,
    swatch,
    chips: ids.map((id) => ({ id, label: labels.role(id) })),
    facts,
    notes: rowNotes(rowFields, row, first).map((note) => note.text),
  };
}
