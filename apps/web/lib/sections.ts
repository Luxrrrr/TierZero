import type { ModuleCategory } from "@tier0/core";
import type { GuildModuleState } from "./control-api";

export interface SectionMeta {
  id: ModuleCategory;
  heading: string;
  description: string;
}

/**
 * The dashboard's six sections, in the order the navigation shows them. A
 * module's own `category` decides which one its card lands in; nothing here
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
];

export function isSectionId(value: string): value is ModuleCategory {
  return SECTIONS.some((section) => section.id === value);
}

export interface SectionGroup extends SectionMeta {
  modules: GuildModuleState[];
  /** Whether any module in this section is switched on for the guild. */
  hasEnabled: boolean;
}

/** Buckets a guild's modules by their own `category`, in nav order. */
export function groupModulesBySection(modules: GuildModuleState[]): SectionGroup[] {
  return SECTIONS.map((section) => {
    const sectionModules = modules.filter((module) => module.category === section.id);
    return {
      ...section,
      modules: sectionModules,
      hasEnabled: sectionModules.some((module) => module.enabled),
    };
  });
}

/**
 * Where to send a guild page that names a section with nothing to show —
 * either the slug isn't one of the six categories, or it is but the install
 * has no module registered under it. Falls back to "utility" so there is
 * always somewhere to land even when no section has a module at all.
 */
export function fallbackSectionId(groups: SectionGroup[]): ModuleCategory {
  return groups.find((group) => group.modules.length > 0)?.id ?? "utility";
}
