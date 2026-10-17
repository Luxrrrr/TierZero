import type { FieldDescriptor } from "@tier0/core";

/**
 * Splits a module's settings page into the parts its schema names with
 * `section`. Free of React and of the dashboard's other modules so the tests
 * can import it directly.
 *
 * A section is listed where its first setting appears in the schema, and
 * holds every top-level setting that names it, in schema order. A top-level
 * setting that names none goes into a last part of its own, so nothing a
 * module forgot to place is ever hidden.
 */

export interface SettingsSection {
  id: string;
  label: string;
  /** Top-level setting keys, in schema order. */
  keys: string[];
}

export const UNSECTIONED_ID = "more";
const UNSECTIONED_LABEL = "More settings";

/** "transcripts" becomes "Transcripts", and "autoClose" becomes "Auto close". */
export function sectionLabel(id: string): string {
  const spaced = id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * The parts of a settings page, or null when the schema does not split it.
 * One named section on its own is not a split either: a navigation with a
 * single entry would only be in the way.
 */
export function settingsSections(schema: FieldDescriptor): SettingsSection[] | null {
  const fields = (schema.fields ?? {}) as Record<string, FieldDescriptor>;
  const sections: SettingsSection[] = [];
  const loose: string[] = [];

  for (const [key, field] of Object.entries(fields)) {
    const id = typeof field.section === "string" && field.section.trim() !== "" ? field.section : null;
    if (id === null) {
      loose.push(key);
      continue;
    }
    const existing = sections.find((section) => section.id === id);
    if (existing) existing.keys.push(key);
    else sections.push({ id, label: sectionLabel(id), keys: [key] });
  }

  if (sections.length === 0) return null;
  if (loose.length > 0) {
    const id = sections.some((section) => section.id === UNSECTIONED_ID) ? `${UNSECTIONED_ID}-settings` : UNSECTIONED_ID;
    sections.push({ id, label: UNSECTIONED_LABEL, keys: loose });
  }
  return sections.length > 1 ? sections : null;
}

/** The top-level key an error path such as `panels[0].types[1].name` belongs to. */
export function topKeyOf(path: string): string {
  const match = /^[^.[]+/.exec(path);
  return match ? match[0] : path;
}

/** The section holding a top-level key, or undefined when none does. */
export function sectionOfKey(sections: readonly SettingsSection[], key: string): string | undefined {
  return sections.find((section) => section.keys.includes(key))?.id;
}

/** How many of the failing fields sit in each section. Sections with none are left out. */
export function sectionErrorCounts(
  sections: readonly SettingsSection[],
  errors: Record<string, string>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const path of Object.keys(errors)) {
    const id = sectionOfKey(sections, topKeyOf(path));
    if (id !== undefined) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

/**
 * The section to show after a save is refused: the current one when it holds
 * a failing field, otherwise the first that does, in the order of the page.
 */
export function sectionForErrors(
  sections: readonly SettingsSection[],
  errors: Record<string, string>,
  current: string,
): string {
  const counts = sectionErrorCounts(sections, errors);
  if (counts[current]) return current;
  return sections.find((section) => counts[section.id])?.id ?? current;
}

export const SECTION_HASH_PREFIX = "#section-";

/**
 * The section an address points at. `#section-<id>` names one directly, and
 * `#group-<key>`, which a link to one card of the page uses, names the
 * section holding that card. Extra entries the page adds of its own, such as
 * a list of commands, can be named too.
 */
export function sectionFromHash(
  hash: string,
  sections: readonly SettingsSection[],
  extraIds: readonly string[] = [],
): string | undefined {
  if (hash.startsWith(SECTION_HASH_PREFIX)) {
    const id = decodeURIComponent(hash.slice(SECTION_HASH_PREFIX.length));
    return sections.some((section) => section.id === id) || extraIds.includes(id) ? id : undefined;
  }
  if (hash.startsWith("#group-")) return sectionOfKey(sections, decodeURIComponent(hash.slice("#group-".length)));
  return undefined;
}
