import type { FieldDescriptor } from "@tier0/core";
import type { GuildModuleState } from "./control-api";
import type { GuidedStep } from "../components/GuidedSetup";
import { guidedProjection } from "./guided";

/**
 * Turns a list of module ids into the steps the wizard walks, dropping any
 * module this install does not have and any whose schema tagged nothing worth
 * asking about. Order follows the ids given, not the order the bot listed them.
 */
export function guidedSteps(
  modules: readonly GuildModuleState[],
  moduleIds: readonly string[],
): GuidedStep[] {
  const byId = new Map(modules.map((module) => [module.id, module]));
  const steps: GuidedStep[] = [];

  for (const id of moduleIds) {
    const module = byId.get(id);
    if (!module) continue;

    const schema = guidedProjection(module.schema as unknown as FieldDescriptor);
    if (!schema) continue;

    steps.push({
      moduleId: module.id,
      area: module.area,
      name: module.name,
      summary: module.summary,
      schema,
      settings: module.settings,
      enabled: module.enabled,
    });
  }

  return steps;
}
