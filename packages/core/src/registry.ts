import type { ModuleCategory, ModuleDefinition } from "./module.js";
import type { ResponseTemplate } from "./response.js";
import type { Shape } from "./schema.js";
import type { FieldDescriptor, FieldError } from "./schema.js";

export interface ModuleSummary {
  id: string;
  name: string;
  summary: string;
  category: ModuleCategory;
  /** Where the dashboard hosts this module's settings, when not on its own page. */
  area: "moderation" | "tickets" | null;
  /** On in every server with no switch, as the bot's own built-in settings are. */
  alwaysOn: boolean;
  requires: string[];
  commands: CommandSummary[];
  schema: FieldDescriptor;
  /** Which list settings have a status line, and the actions on their rows. */
  rows: Record<string, RowDescription>;
  /** Actions on the whole feature, drawn on its settings page. */
  actions: ActionDescription[];
}

export interface CommandSummary {
  name: string;
  description: string;
  kind: CommandKind;
  /**
   * The permission bits Discord requires to see the command, as a decimal
   * string. Null means everyone sees it.
   */
  defaultPermissions: string | null;
  /** Whether the command answers privately unless an owner says otherwise. */
  privateByDefault: boolean;
  /** True when the command decides per reply, so one private or public choice would misdescribe it. */
  repliesVary: boolean;
  /** Null when the command's reply is not plain text an owner can reword. */
  response: ResponseTemplate | null;
  /**
   * The parts of a slash command that has them, such as `/ticket close`.
   * Empty for a command without parts. Each part can be switched off and
   * limited on its own, under the override key in `key`.
   */
  subcommands: SubcommandSummary[];
}

export interface SubcommandSummary {
  /** As members type it after the command: `close`, or `group close` inside a group. */
  name: string;
  /** The command and the part, as the override is stored: `ticket close`. */
  key: string;
  description: string;
}

/** The override key of one part of a command, the way Discord names it: words separated by spaces. */
export function subcommandKey(command: string, group: string | null, subcommand: string): string {
  return [command, group, subcommand].filter((part): part is string => typeof part === "string" && part !== "").join(" ");
}

interface CommandOptionJson {
  type?: number;
  name?: string;
  description?: string;
  options?: CommandOptionJson[];
}

const SUB_COMMAND = 1;
const SUB_COMMAND_GROUP = 2;

/** The parts of a slash command, read from what it registers with Discord. */
export function subcommandsOf(command: string, json: unknown): SubcommandSummary[] {
  const options = ((json as { options?: CommandOptionJson[] } | null)?.options ?? []).filter((option) => typeof option?.name === "string");
  const parts: SubcommandSummary[] = [];
  for (const option of options) {
    if (option.type === SUB_COMMAND) {
      parts.push({ name: option.name!, key: subcommandKey(command, null, option.name!), description: option.description ?? "" });
    } else if (option.type === SUB_COMMAND_GROUP) {
      for (const inner of option.options ?? []) {
        if (inner.type !== SUB_COMMAND || typeof inner.name !== "string") continue;
        parts.push({
          name: `${option.name} ${inner.name}`,
          key: subcommandKey(command, option.name!, inner.name),
          description: inner.description ?? "",
        });
      }
    }
  }
  return parts;
}

/** A slash command, or an entry in the right-click menu of a member or a message. */
export type CommandKind = "slash" | "user" | "message";

export interface ActionDescription {
  id: string;
  label: string;
  help?: string;
  section?: string;
  input?: FieldDescriptor;
}

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
      alwaysOn: module.alwaysOn === true,
      requires: module.requires ?? [],
      commands: [
        ...(module.commands ?? []).map((c) => ({
          name: c.name,
          description: c.description,
          kind: "slash" as CommandKind,
          defaultPermissions: defaultPermissionsOf(c.build()),
          response: c.response ?? null,
          privateByDefault: c.publicReply !== true,
          repliesVary: c.variedReply === true,
          subcommands: subcommandsOf(c.name, c.build().toJSON()),
        })),
        ...(module.contextCommands ?? []).map((c) => ({
          name: c.name,
          description: c.description,
          kind: c.kind as CommandKind,
          defaultPermissions: defaultPermissionsOf(c.build()),
          response: c.response ?? null,
          privateByDefault: c.publicReply !== true,
          repliesVary: false,
          subcommands: [],
        })),
      ],
      schema: module.settings.describe(),
      actions: Object.entries(module.actions ?? {}).map(([id, action]) => ({
        id,
        label: action.label,
        help: action.help,
        section: action.section,
        input: action.input?.describe(),
      })),
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

function defaultPermissionsOf(builder: { toJSON(): unknown }): string | null {
  const value = (builder.toJSON() as { default_member_permissions?: string | null })
    .default_member_permissions;
  return value ?? null;
}
