import type { FieldDescriptor } from "@tier0/core";

/**
 * Turns a list row into the two short strings its collapsed header shows. Kept
 * free of React and of the dashboard's other modules so it can be tested with
 * plain objects; whatever needs the guild's channels or the duration helpers
 * is handed in.
 */

export interface RowLabels {
  /** "#general", or a short fallback while the list loads or after a deletion. */
  channel(id: string): string;
  /** "@Moderator", or a short fallback. */
  role(id: string): string;
  /** A person-readable duration. Two values that mean the same time must match. */
  duration(value: unknown): string;
}

export interface RowSummary {
  title: string | undefined;
  detail: string;
}

type Fields = Record<string, FieldDescriptor>;
type Option = { value: string; label: string };

const DETAIL_SEPARATOR = " · ";
const LONGEST_TEXT_DETAIL = 40;

export function humanize(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** `patchNotes.destinations[0].games` becomes the schema path `patchNotes.destinations.games`. */
export function stripIndices(path: string): string {
  return path.replace(/\[\d+\]/g, "");
}

export function summarizeRow(
  row: Record<string, unknown>,
  fields: Fields,
  labels: RowLabels,
): RowSummary {
  const entries = Object.entries(fields);
  const titled = pickTitle(row, entries, labels);

  const parts: string[] = [];
  for (const [key, field] of entries) {
    if (key === titled?.key) continue;
    const part = detailFor(field, key, row[key], labels);
    if (part) parts.push(part);
  }

  return { title: titled?.text, detail: parts.join(DETAIL_SEPARATOR) };
}

function pickTitle(
  row: Record<string, unknown>,
  entries: [string, FieldDescriptor][],
  labels: RowLabels,
): { key: string; text: string } | undefined {
  for (const [key, field] of entries) {
    if (field.kind !== "string" && field.kind !== "choice") continue;
    const text = field.kind === "choice" ? choiceLabel(field, row[key]) : row[key];
    if (typeof text === "string" && text !== "") return { key, text };
  }
  for (const [key, field] of entries) {
    const id = row[key];
    if (field.kind === "channel" && isFilled(id)) return { key, text: labels.channel(id) };
  }
  for (const [key, field] of entries) {
    const id = row[key];
    if (field.kind === "role" && isFilled(id)) return { key, text: labels.role(id) };
  }
  return undefined;
}

function detailFor(
  field: FieldDescriptor,
  key: string,
  value: unknown,
  labels: RowLabels,
): string | undefined {
  const label = (field.label as string | undefined) ?? humanize(key);

  switch (field.kind) {
    case "string":
      return isFilled(value) ? truncate(value) : undefined;
    case "emoji":
      return isFilled(value) ? value : undefined;
    case "message":
      return messageDetail(value);
    case "integer":
      return typeof value === "number" ? `${label} ${value}` : undefined;
    case "duration": {
      if (value === undefined || value === null || value === "") return undefined;
      const shown = labels.duration(value);
      if (field.default !== undefined && shown === labels.duration(field.default)) {
        return undefined;
      }
      return `${label} ${shown}`;
    }
    case "choice":
      return isFilled(value) ? choiceLabel(field, value) : undefined;
    case "channel":
      return isFilled(value) ? labels.channel(value) : undefined;
    case "role":
      return isFilled(value) ? labels.role(value) : undefined;
    case "array": {
      const of = field.of as FieldDescriptor | undefined;
      if (of?.kind === "choice") {
        return Array.isArray(value) ? summarizeChoices(value, (of.options ?? []) as Option[]) : undefined;
      }
      if (of?.kind !== "object" || !Array.isArray(value) || value.length === 0) return undefined;
      return `${value.length} ${value.length === 1 ? singularLabel(label) : label.toLowerCase()}`;
    }
    default:
      return undefined;
  }
}

/** The first of a message's text, or what it is made of when it has none. */
function messageDetail(value: unknown): string | undefined {
  if (typeof value === "string") return isFilled(value.trim()) ? truncate(value.trim()) : undefined;
  if (typeof value !== "object" || value === null) return undefined;
  const { content, embeds } = value as { content?: unknown; embeds?: unknown };
  if (typeof content === "string" && content.trim() !== "") return truncate(content.trim().replace(/\s+/g, " "));
  if (Array.isArray(embeds) && embeds.length > 0) {
    const title = (embeds[0] as { title?: unknown } | undefined)?.title;
    return typeof title === "string" && title.trim() !== "" ? truncate(title.trim()) : embeds.length === 1 ? "Embed" : `${embeds.length} embeds`;
  }
  return undefined;
}

function choiceLabel(field: FieldDescriptor, value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  const options = (field.options ?? []) as Option[];
  return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * The picked options of a multi-select as their labels, in the order the
 * options are declared. When they do not all fit, the ones that do are shown
 * with a count of the rest.
 */
export function summarizeChoices(
  values: readonly unknown[],
  options: readonly Option[],
  longest: number = LONGEST_TEXT_DETAIL,
): string | undefined {
  const picked = new Set(values.filter((entry): entry is string => typeof entry === "string"));
  const known = new Set(options.map((option) => option.value));
  const labels = [
    ...options.filter((option) => picked.has(option.value)).map((option) => option.label),
    ...[...picked].filter((value) => !known.has(value)),
  ];
  if (labels.length === 0) return undefined;

  const all = labels.join(", ");
  if (all.length <= longest) return all;

  const shown: string[] = [];
  for (const label of labels) {
    const rest = labels.length - shown.length - 1;
    const candidate = [...shown, label].join(", ") + (rest > 0 ? ` +${rest}` : "");
    if (candidate.length > longest && shown.length > 0) break;
    shown.push(label);
  }
  const hidden = labels.length - shown.length;
  const text = shown.join(", ") + (hidden > 0 ? ` +${hidden}` : "");
  return text.length > longest ? truncate(text) : text;
}

function truncate(text: string): string {
  return text.length > LONGEST_TEXT_DETAIL ? `${text.slice(0, LONGEST_TEXT_DETAIL - 1)}…` : text;
}

function isFilled(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/**
 * Which rows are open is kept by index, so adding and removing a row has to
 * move that state along with the rows themselves.
 */
export function expandedAfterRemove(expanded: ReadonlySet<number>, removed: number): Set<number> {
  const next = new Set<number>();
  for (const index of expanded) {
    if (index < removed) next.add(index);
    else if (index > removed) next.add(index - 1);
  }
  return next;
}

export function expandedWith(expanded: ReadonlySet<number>, ...indexes: number[]): Set<number> {
  const next = new Set(expanded);
  for (const index of indexes) next.add(index);
  return next;
}

export function expandedWithout(expanded: ReadonlySet<number>, index: number): Set<number> {
  const next = new Set(expanded);
  next.delete(index);
  return next;
}

/**
 * "Games posted here" counted as one reads "game posted here". The plural noun
 * is the first word that looks plural, which also handles "Reward tiers".
 */
function singularLabel(label: string): string {
  const words = label.toLowerCase().split(" ");
  const at = words.findIndex((word) => word.endsWith("s") && !word.endsWith("ss"));
  if (at === -1) return words.join(" ");
  const word = words[at] ?? "";
  words[at] = word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.slice(0, -1);
  return words.join(" ");
}
