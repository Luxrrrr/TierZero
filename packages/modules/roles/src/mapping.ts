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
  name: string;
  exclusive: boolean;
  options: MenuOption[];
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
    name: typeof record.name === "string" ? record.name : "",
    exclusive: record.exclusive === true,
    options: Array.isArray(record.options) ? record.options.filter(isMenuOption) : [],
  };
}
