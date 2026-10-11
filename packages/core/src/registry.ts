import type { ModuleCategory, ModuleDefinition } from "./module.js";
import type { Shape } from "./schema.js";
import type { FieldDescriptor, FieldError } from "./schema.js";

export interface ModuleSummary {
  id: string;
  name: string;
  summary: string;
  category: ModuleCategory;
  /** Where the dashboard hosts this module's settings, when not on its own page. */
  area: "moderation" | null;
  requires: string[];
  commands: { name: string; description: string; kind: CommandKind }[];
  schema: FieldDescriptor;
  /** Which list settings have a status line, and the actions on their rows. */
  rows: Record<string, RowDescription>;
}

/** A slash command, or an entry in the right-click menu of a member or a message. */
export type CommandKind = "slash" | "user" | "message";

export interface RowDescription {
  status: boolean;
  actions: { id: string; label: string; help?: string; input?: FieldDescriptor }[];
}

/**
 * Holds every module the bot knows about. The dashboard reads from the same
 * registry over the control API, so the two processes can never drift apart
 * on what a setting is called or what it accepts.
 */
export class ModuleRegistry {
  private readonly modules = new Map<string, ModuleDefinition>();

  /**
   * Accepts a module at its own settings shape and stores it erased. The
   * registry looks modules up by string at runtime, so nothing downstream can
   * know the shape anyway, and taking it here keeps the call site checked.
   */
  register<S extends Shape>(definition: ModuleDefinition<S>): void {
    if (this.modules.has(definition.id)) {
      throw new Error(`Duplicate module id: ${definition.id}`);
    }
    const claimed = new Set<string>();
    for (const command of [...(definition.commands ?? []), ...(definition.contextCommands ?? [])]) {
      const owner = this.ownerOf(command.name) ?? (claimed.has(command.name) ? definition.id : undefined);
      if (owner) {
        throw new Error(
          `Command ${command.name} is claimed by both ${owner} and ${definition.id}`,
        );
      }
      claimed.add(command.name);
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
      if (
        module.commands?.some((c) => c.name === commandName) ||
        module.contextCommands?.some((c) => c.name === commandName)
      ) {
        return module.id;
      }
    }
    return undefined;
  }

  /** Everything the dashboard needs to render the module list and its forms. */
  describe(): ModuleSummary[] {
    return this.all().map((module) => ({
      id: module.id,
      name: module.name,
      summary: module.summary,
      category: module.category ?? "utility",
      area: module.area ?? null,
      requires: module.requires ?? [],
      commands: [
        ...(module.commands ?? []).map((c) => ({
          name: c.name,
          description: c.description,
          kind: "slash" as CommandKind,
        })),
        ...(module.contextCommands ?? []).map((c) => ({
          name: c.name,
          description: c.description,
          kind: c.kind as CommandKind,
        })),
      ],
      schema: module.settings.describe(),
      rows: Object.fromEntries(
        Object.entries(module.rows ?? {}).map(([path, hooks]) => [
          path,
          {
            status: hooks.status !== undefined,
            actions: Object.entries(hooks.actions ?? {}).map(([id, action]) => ({
              id,
              label: action.label,
              help: action.help,
              input: action.input?.describe(),
            })),
          },
        ]),
      ),
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
