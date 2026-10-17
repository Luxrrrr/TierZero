import { GENERATED_ID } from "@tier0/core";

/**
 * Role menu logic that needs no Discord client: ids for menus saved before they
 * had one, the fingerprint that tells a posted menu from its current settings,
 * and what a press or a pick does to a member's roles.
 */

/** FNV-1a, as eight hex characters. Stable across processes, which is all an id needs. */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (const char of text) {
    value ^= char.codePointAt(0) ?? 0;
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(16).padStart(8, "0");
}

/**
 * The id a menu saved before menus had ids is given, worked out from its name.
 * A menu posted back then is found by the same name, so it keeps its live
 * message once the dashboard saves the id.
 */
export function legacyMenuId(name: string): string {
  return `n${hash(name)}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Fills in the id of every menu that has none. The first menu with a name gets
 * the name's id, which is the one an old post is matched to, as `/rolemenu`
 * always picked the first menu with the name typed. Leaves current values alone.
 */
export function upgradeMenus(stored: Record<string, unknown>): Record<string, unknown> {
  const menus = stored.menus;
  if (!Array.isArray(menus) || menus.every((menu) => !isRecord(menu) || typeof menu.id === "string")) return stored;

  const taken = new Set(menus.flatMap((menu) => (isRecord(menu) && typeof menu.id === "string" ? [menu.id] : [])));
  const next = menus.map((menu) => {
    if (!isRecord(menu) || typeof menu.id === "string") return menu;
    const base = legacyMenuId(typeof menu.name === "string" ? menu.name : "");
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    return { ...menu, id };
  });
  return { ...stored, menus: next };
}

export function isMenuId(value: unknown): value is string {
  return typeof value === "string" && GENERATED_ID.test(value);
}

/**
 * What a posted menu was built from. Two menus with the same fingerprint post
 * the same message, so a stored one that differs from the current settings
 * means the live menu is out of date.
 */
export function menuSnapshot(menu: Record<string, unknown>): string {
  const { id: _id, mode, ...rest } = menu;
  // A menu posted before modes existed must not read as changed just because the setting now has a value.
  return hash(stable(mode === undefined || mode === "toggle" ? rest : { ...rest, mode }));
}

/** JSON with every object's keys in order, so the same settings always read the same. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export interface MenuRules {
  /** Menu roles the member holds now. */
  current: string[];
  /** Every role the menu offers. */
  menuRoles: string[];
  exclusive: boolean;
  maxPicks?: number;
  /** "give" never takes a picked role away, "take" never gives one. Toggling both ways when left out. */
  mode?: "toggle" | "give" | "take";
}

export type ChangeResult =
  | { ok: true; toAdd: string[]; toRemove: string[] }
  | { ok: false; reason: "tooMany"; max: number };

/**
 * What picking `picked` does: each picked role the member holds is taken off,
 * each one they lack is given, unless the menu only gives or only takes away.
 * An exclusive menu leaves at most one role, the last one picked. Otherwise a
 * menu with a limit refuses a pick that would leave the member holding more
 * than it allows.
 */
export function computeChange(picked: string[], rules: MenuRules): ChangeResult {
  const held = rules.current.filter((id) => rules.menuRoles.includes(id));
  const wanted = [...new Set(picked)].filter((id) => rules.menuRoles.includes(id));
  const toRemove = rules.mode === "give" ? [] : wanted.filter((id) => held.includes(id));
  let toAdd = rules.mode === "take" ? [] : wanted.filter((id) => !held.includes(id));

  if (rules.exclusive) {
    toAdd = toAdd.slice(-1);
    const others = held.filter((id) => !toAdd.includes(id) && !toRemove.includes(id));
    return { ok: true, toAdd, toRemove: toAdd.length > 0 ? [...toRemove, ...others] : toRemove };
  }

  if (rules.maxPicks !== undefined) {
    const after = held.length - toRemove.length + toAdd.length;
    if (toAdd.length > 0 && after > rules.maxPicks) return { ok: false, reason: "tooMany", max: rules.maxPicks };
  }
  return { ok: true, toAdd, toRemove };
}
