import type {
  ChatInputCommandInteraction,
  Client,
  Guild,
  Message,
  GuildMember,
  PartialGuildMember,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";
import type { ObjectField, Shape, ShapeValues } from "./schema.js";

/**
 * Everything a command or handler is given at call time. Settings are already
 * parsed and defaulted for the guild in question, so handlers never touch the
 * raw JSON column.
 */
export interface ModuleContext<T = unknown> {
  client: Client;
  guild: Guild;
  settings: T;
  /** Persists a partial settings change and triggers onSettingsChange. */
  update(patch: Partial<T>): Promise<void>;
  /** Work to carry out later, such as lifting a temporary ban. */
  tasks: ScheduledWork;
}

export type TaskPayload = Record<string, unknown>;

export interface ScheduledWork {
  /**
   * Runs the module's handler for `kind` at `runAt`. The row outlives the
   * process, so a restart between scheduling and running loses nothing.
   */
  schedule(kind: string, runAt: Date, payload?: TaskPayload): Promise<void>;
  /**
   * Drops pending work of this kind whose payload contains every entry in
   * `match`. Returns how many were dropped. Used when an action is reversed
   * early, such as an unban issued before the temporary ban expires.
   */
  cancel(kind: string, match?: TaskPayload): Promise<number>;
}

export type TaskHandler<T = unknown> = (
  payload: TaskPayload,
  ctx: ModuleContext<T>,
) => Promise<void>;

export type CommandBuilder =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder;

export interface CommandDefinition<T = unknown> {
  /** Must be unique across all modules; used as the override key. */
  name: string;
  description: string;
  build(): CommandBuilder;
  run(interaction: ChatInputCommandInteraction, ctx: ModuleContext<T>): Promise<void>;
}

export interface EventHandlers<T = unknown> {
  messageCreate(message: Message, ctx: ModuleContext<T>): Promise<void>;
  memberJoin(member: GuildMember, ctx: ModuleContext<T>): Promise<void>;
  /**
   * Discord does not guarantee a full member object on departure - if the
   * member was not cached, fields such as `joinedAt` come back null.
   */
  memberLeave(member: GuildMember | PartialGuildMember, ctx: ModuleContext<T>): Promise<void>;
}

export interface ModuleDefinition<S extends Shape = Shape> {
  id: string;
  name: string;
  summary: string;
  settings: ObjectField<S>;
  commands?: CommandDefinition<ShapeValues<S>>[];
  events?: Partial<EventHandlers<ShapeValues<S>>>;
  /**
   * Handlers for work this module schedules. The kind a handler is keyed by is
   * namespaced to the module, so two modules may both use "expire" without
   * colliding.
   */
  tasks?: Record<string, TaskHandler<ShapeValues<S>>>;
  /** Discord permissions the module cannot work without. Surfaced in setup. */
  requires?: string[];
  onEnable?(ctx: ModuleContext<ShapeValues<S>>): Promise<void>;
  onDisable?(ctx: ModuleContext<ShapeValues<S>>): Promise<void>;
  onSettingsChange?(
    ctx: ModuleContext<ShapeValues<S>>,
    previous: ShapeValues<S>,
  ): Promise<void>;
}

/**
 * Identity function that pins the generic parameter, so a module's handlers get
 * a fully typed settings object without anyone writing the type out by hand.
 */
export function defineModule<S extends Shape>(
  definition: ModuleDefinition<S>,
): ModuleDefinition<S> {
  return definition;
}
