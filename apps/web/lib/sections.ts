import type { ModuleCategory } from "@tier0/core";

export interface SectionMeta {
  id: ModuleCategory;
  heading: string;
  description: string;
}

/**
 * The dashboard's categories, in the order the sidebar shows them. A
 * module's own `category` decides which one it is filed under; nothing here
 * knows about individual modules. Adding a module means declaring a category
 * on it, never touching this list.
 */
export const SECTIONS: SectionMeta[] = [
  {
    id: "moderation",
    heading: "Moderation",
    description: "Warnings, mutes, bans, and the automated filters that catch problems before you have to.",
  },
  {
    id: "members",
    heading: "Members",
    description: "Welcome messages for people joining, and the roles they can pick for themselves.",
  },
  {
    id: "engagement",
    heading: "Engagement",
    description: "Experience points and levels for active members.",
  },
  {
    id: "support",
    heading: "Support",
    description: "Ticket channels members can open when they need help.",
  },
  {
    id: "logging",
    heading: "Logging",
    description: "A record of what happened in the server and who did it.",
  },
  {
    id: "utility",
    heading: "Utility",
    description: "General-purpose commands and server information.",
  },
  {
    id: "more",
    heading: "More",
    description: "Extra tools that most servers do not need.",
  },
];

export interface SectionGroup<M> extends SectionMeta {
  modules: M[];
}

/**
 * Buckets a guild's modules by their own `category`, in sidebar order. Every
 * category comes back, including empty ones: whether an empty group is worth
 * a heading is the caller's decision, and the two callers differ.
 */
export function groupModulesBySection<M extends { category: ModuleCategory }>(
  modules: M[],
): SectionGroup<M>[] {
  return SECTIONS.map((section) => ({
    ...section,
    modules: modules.filter((module) => module.category === section.id),
  }));
}

/**
 * The groups the settings sidebar lists: modules hosted inside an area of the
 * dashboard are reached through that area's own entry, and a category left
 * with nothing to list gets no heading at all.
 */
export function navGroups<M extends { category: ModuleCategory; area?: string | null; alwaysOn?: boolean; schema?: unknown }>(
  modules: M[],
): SectionGroup<M>[] {
  // The bot's own settings are reached through the Bot messages page, not as a feature. A feature with
  // nothing to configure has no page of its own: its switch is on the overview and its commands are on
  // the Commands page.
  return groupModulesBySection(modules.filter((module) => !module.area && module.alwaysOn !== true && hasSettings(module))).filter(
    (group) => group.modules.length > 0,
  );
}

/**
 * Whether a feature has any settings to show. One that declares none, such as the information
 * commands, would only repeat the Commands page, so nothing links to a page of its own.
 */
export function hasSettings(module: { schema?: unknown }): boolean {
  const schema = module.schema;
  if (typeof schema !== "object" || schema === null) return true;
  const fields = (schema as { fields?: unknown }).fields;
  if (typeof fields !== "object" || fields === null) return true;
  return Object.keys(fields).length > 0;
}

/** Flattens modules into one list: category order first, arrival order within a category. */
export function orderModulesBySection<M extends { category: ModuleCategory }>(modules: M[]): M[] {
  return groupModulesBySection(modules).flatMap((group) => group.modules);
}

/** The categories that have at least one module, with how many, for a filter row. */
export function sectionCounts<M extends { category: ModuleCategory }>(
  modules: M[],
): { id: ModuleCategory; heading: string; count: number }[] {
  return groupModulesBySection(modules)
    .filter((group) => group.modules.length > 0)
    .map((group) => ({ id: group.id, heading: group.heading, count: group.modules.length }));
}

export function sectionHeading(id: ModuleCategory): string {
  return SECTIONS.find((section) => section.id === id)?.heading ?? id;
}

/**
 * The short mark each feature gets in the folded sidebar: its first letter, or
 * two letters where features would otherwise share one, so Leveling and Log
 * channel do not both read "L". Two words give their initials, one word its
 * first two letters.
 */
export function railMarks(names: readonly string[]): Map<string, string> {
  const first = (name: string) => name.trim().charAt(0).toUpperCase();
  const counts = new Map<string, number>();
  for (const name of names) counts.set(first(name), (counts.get(first(name)) ?? 0) + 1);
  const marks = new Map<string, string>();
  for (const name of names) {
    if ((counts.get(first(name)) ?? 0) < 2) {
      marks.set(name, first(name));
      continue;
    }
    const words = name.trim().split(/\s+/).filter(Boolean);
    const second = words.length > 1 ? (words[1]?.charAt(0) ?? "") : (words[0]?.charAt(1) ?? "");
    marks.set(name, `${first(name)}${words.length > 1 ? second.toUpperCase() : second.toLowerCase()}`);
  }
  return marks;
}
