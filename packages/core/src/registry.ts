import type { ModuleDefinition } from "./module.js";
import type { FieldDescriptor, FieldError } from "./schema.js";

export interface ModuleSummary {
  id: string;
  name: string;
  summary: string;
  requires: string[];
  commands: { name: string; description: string }[];
  schema: FieldDescriptor;
}

/**
 * Holds every module the bot knows about. The dashboard reads from the same
 * registry over the control API, which is what keeps the two processes from
 * drifting apart on what a setting is called or what it accepts.
 */
export class ModuleRegistry {
  private readonly modules = new Map<string, ModuleDefinition>();

  register(definition: ModuleDefinition): void {
    if (this.modules.has(definition.id)) {
      throw new Error(`Duplicate module id: ${definition.id}`);
    }
    for (const command of definition.commands ?? []) {
      const owner = this.ownerOf(command.name);
      if (owner) {
        throw new Error(
          `Command /${command.name} is claimed by both ${owner} and ${definition.id}`,
        );
      }
    }
    this.modules.set(definition.id, definition as ModuleDefinition);
  }

  get(id: string): ModuleDefinition | undefined {
    return this.modules.get(id);
  }

  all(): ModuleDefinition[] {
    return [...this.modules.values()];
  }

  ownerOf(commandName: string): string | undefined {
    for (const module of this.modules.values()) {
      if (module.commands?.some((c) => c.name === commandName)) return module.id;
    }
    return undefined;
  }

  /** Everything the dashboard needs to render the module list and its forms. */
  describe(): ModuleSummary[] {
    return this.all().map((module) => ({
      id: module.id,
      name: module.name,
      summary: module.summary,
      requires: module.requires ?? [],
      commands: (module.commands ?? []).map((c) => ({
        name: c.name,
        description: c.description,
      })),
      schema: module.settings.describe(),
    }));
  }

  /**
   * Validates stored settings against a module's current schema. Missing keys
   * take their defaults, so a module can add a setting without a migration.
   */
  resolveSettings(
    moduleId: string,
    stored: unknown,
  ): { ok: true; value: unknown } | { ok: false; errors: FieldError[] } {
    const module = this.modules.get(moduleId);
    if (!module) {
      return { ok: false, errors: [{ path: "", message: `Unknown module ${moduleId}` }] };
    }
    return module.settings.parse(stored ?? {});
  }
}
