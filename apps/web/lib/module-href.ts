/**
 * Where a module's settings live. Most modules have a page of their own; one
 * that declares an `area` is hosted inside that area of the dashboard instead.
 * Every link to a module's settings goes through here so the two cases cannot
 * drift apart.
 */

export type ModuleArea = "moderation";

export interface Hostable {
  id: string;
  area?: ModuleArea | null;
}

/**
 * The module an area's own root route shows. The rest are reached through the
 * area's sub-navigation, one segment deeper.
 */
const AREA_PRIMARY: Record<ModuleArea, string> = {
  moderation: "moderation",
};

const AREA_SETTINGS_PATH: Record<ModuleArea, string> = {
  moderation: "mod/settings",
};

export function isHosted(module: Hostable): module is Hostable & { area: ModuleArea } {
  return module.area === "moderation";
}

/** The page that configures this module. */
export function moduleHref(guildId: string, module: Hostable): string {
  if (!isHosted(module)) return `/guilds/${guildId}/${module.id}`;
  const base = `/guilds/${guildId}/${AREA_SETTINGS_PATH[module.area]}`;
  return module.id === AREA_PRIMARY[module.area] ? base : `${base}/${module.id}`;
}

/**
 * The modules an area hosts, primary first and otherwise in the order the bot
 * listed them. The primary leads because it owns the area's root route.
 */
export function areaModules<M extends Hostable>(modules: readonly M[], area: ModuleArea): M[] {
  const hosted = modules.filter((module) => module.area === area);
  const primary = AREA_PRIMARY[area];
  return [...hosted.filter((m) => m.id === primary), ...hosted.filter((m) => m.id !== primary)];
}

/** The module a hosted route shows, or undefined when the id is not one the area hosts. */
export function areaModule<M extends Hostable>(
  modules: readonly M[],
  area: ModuleArea,
  moduleId: string | undefined,
): M | undefined {
  const hosted = areaModules(modules, area);
  if (moduleId === undefined) return hosted[0];
  return hosted.find((module) => module.id === moduleId);
}
