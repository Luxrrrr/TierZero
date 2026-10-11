import type { FieldDescriptor } from "@tier0/core";
import type { GuildModuleState } from "./control-api";
import { missingEssentials, moduleStatus, type MissingEssential, type ModuleStatus } from "./module-status";

/**
 * A module plus the two derived values every surface needs: whether it can
 * actually do anything yet, and which settings it is waiting on. Computed on
 * the server once per request and handed down, so the sidebar, the overview
 * tiles and the module header can never disagree about a module's state.
 */
export interface ModuleView extends GuildModuleState {
  status: ModuleStatus;
  missing: MissingEssential[];
}

export function toModuleView(module: GuildModuleState): ModuleView {
  const missing = missingEssentials(module.schema as unknown as FieldDescriptor, module.settings);
  return { ...module, missing, status: moduleStatus(module.enabled, missing) };
}

export function toModuleViews(modules: GuildModuleState[]): ModuleView[] {
  return modules.map(toModuleView);
}

/** "On" / "Off" / "Needs setup · Log channel", for a status line beside a dot. */
export function statusLine(status: ModuleStatus, missing: MissingEssential[]): string {
  if (status === "off") return "Off";
  if (status === "on") return "On";
  const names = missing.map((entry) => entry.label).join(", ");
  return names ? `Needs setup · ${names}` : "Needs setup";
}

/** The short form, for a badge or for text a screen reader reads after a name. */
export function statusWord(status: ModuleStatus): string {
  if (status === "off") return "Off";
  if (status === "on") return "On";
  return "Needs setup";
}
