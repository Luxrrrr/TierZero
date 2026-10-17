/**
 * The published form of a role menu, snapshotted into ReactionRoleMenu.mapping
 * at publish time. Buttons decode against this, not live settings, so a menu
 * keeps working even if the dashboard config changes or the row briefly
 * outlives a restart before settings are reloaded.
 */

export interface MenuOption {
  role: string;
  label: string;
  emoji?: string;
}

export interface MenuMapping {
  /** The menu's stable id. Missing on rows posted before menus had one. */
  id?: string;
  name: string;
  exclusive: boolean;
  /** Left out for a menu whose roles go on and come off, which is what every menu did before modes. */
  mode?: "give" | "take";
  options: MenuOption[];
  /** Most roles a member may hold from this menu at once. */
  maxPicks?: number;
  /** A role a member needs before the menu does anything for them. */
  requiredRole?: string;
  /** What the menu's settings were when it was posted, to tell whether it has changed since. */
  snapshot?: string;
}

export function serializeMapping(mapping: MenuMapping): string {
  return JSON.stringify(mapping);
}

function isMenuOption(value: unknown): value is MenuOption {
  if (!value || typeof value !== "object") return false;
  const option = value as Record<string, unknown>;
  return typeof option.role === "string" && typeof option.label === "string";
}

/** Never throws: a corrupted or hand-edited row degrades to an empty menu. */
export function parseMapping(raw: string): MenuMapping {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { name: "", exclusive: false, options: [] };
  }
  const record = (parsed ?? {}) as Record<string, unknown>;
  return {
    ...(typeof record.id === "string" && record.id !== "" ? { id: record.id } : {}),
    name: typeof record.name === "string" ? record.name : "",
    exclusive: record.exclusive === true,
    ...(record.mode === "give" || record.mode === "take" ? { mode: record.mode } : {}),
    options: Array.isArray(record.options) ? record.options.filter(isMenuOption) : [],
    ...(typeof record.maxPicks === "number" && record.maxPicks > 0 ? { maxPicks: record.maxPicks } : {}),
    ...(typeof record.requiredRole === "string" && record.requiredRole !== "" ? { requiredRole: record.requiredRole } : {}),
    ...(typeof record.snapshot === "string" ? { snapshot: record.snapshot } : {}),
  };
}
