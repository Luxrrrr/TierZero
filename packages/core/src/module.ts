import type {
  ChatInputCommandInteraction,
  Client,
  Guild,
  GuildBan,
  GuildChannel,
  GuildMember,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  Message,
  PartialGuildMember,
  PartialMessage,
  Role,
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
  /** Deleted messages are often uncached, so most fields may be null. */
  messageDelete(message: Message | PartialMessage, ctx: ModuleContext<T>): Promise<void>;
  messageUpdate(
    before: Message | PartialMessage,
    after: Message | PartialMessage,
    ctx: ModuleContext<T>,
  ): Promise<void>;
  memberJoin(member: GuildMember, ctx: ModuleContext<T>): Promise<void>;
  /**
   * Discord does not guarantee a full member object on departure - if the
   * member was not cached, fields such as `joinedAt` come back null.
   */
  memberLeave(member: GuildMember | PartialGuildMember, ctx: ModuleContext<T>): Promise<void>;
  memberUpdate(
    before: GuildMember | PartialGuildMember,
    after: GuildMember,
    ctx: ModuleContext<T>,
  ): Promise<void>;
  channelCreate(channel: GuildChannel, ctx: ModuleContext<T>): Promise<void>;
  channelDelete(channel: GuildChannel, ctx: ModuleContext<T>): Promise<void>;
  roleCreate(role: Role, ctx: ModuleContext<T>): Promise<void>;
  roleDelete(role: Role, ctx: ModuleContext<T>): Promise<void>;
  banAdd(ban: GuildBan, ctx: ModuleContext<T>): Promise<void>;
  banRemove(ban: GuildBan, ctx: ModuleContext<T>): Promise<void>;
}

/**
 * Buttons, select menus and modals are addressed by custom id. The router
 * splits an id as `moduleId:action:rest`, the same namespacing scheduled work
 * uses, so a module only ever sees interactions it created and two modules can
 * both use an action called "confirm".
 *
 * Build ids with `customId()` rather than by hand.
 */
export function customId(moduleId: string, action: string, rest = ""): string {
  return rest ? `${moduleId}:${action}:${rest}` : `${moduleId}:${action}`;
}

/** Reads back an id built by `customId`. Returns null for anything else. */
export function parseCustomId(
  raw: string,
): { moduleId: string; action: string; rest: string } | null {
  const first = raw.indexOf(":");
  if (first <= 0) return null;
  const second = raw.indexOf(":", first + 1);
  const moduleId = raw.slice(0, first);
  const action = second === -1 ? raw.slice(first + 1) : raw.slice(first + 1, second);
  if (!action) return null;
  return { moduleId, action, rest: second === -1 ? "" : raw.slice(second + 1) };
}

export interface ComponentEvent<T = unknown> {
  /** Everything after `moduleId:action:`, empty when there was none. */
  rest: string;
  ctx: ModuleContext<T>;
}

export type ComponentHandler<T = unknown> = (
  interaction: MessageComponentInteraction,
  event: ComponentEvent<T>,
) => Promise<void>;

export type ModalHandler<T = unknown> = (
  interaction: ModalSubmitInteraction,
  event: ComponentEvent<T>,
) => Promise<void>;

/**
 * Which section of the dashboard a module is configured under. The list is
 * closed on purpose: a module picking its own section name would leave the
 * navigation growing a new entry every time somebody wrote a module, and the
 * point of grouping is that related settings sit together.
 */
export type ModuleCategory =
  | "moderation"
  | "members"
  | "engagement"
  | "support"
  | "logging"
  | "utility";

export interface ModuleDefinition<S extends Shape = Shape> {
  id: string;
  name: string;
  summary: string;
  /** Defaults to "utility" for a module that does not say. */
  category?: ModuleCategory;
  settings: ObjectField<S>;
  commands?: CommandDefinition<ShapeValues<S>>[];
  events?: Partial<EventHandlers<ShapeValues<S>>>;
  /**
   * Handlers for work this module schedules. The kind a handler is keyed by is
   * namespaced to the module, so two modules may both use "expire" without
   * colliding.
   */
  tasks?: Record<string, TaskHandler<ShapeValues<S>>>;
  /** Button and select menu handlers, keyed by the action in their custom id. */
  components?: Record<string, ComponentHandler<ShapeValues<S>>>;
  /** Modal submission handlers, keyed by the action in their custom id. */
  modals?: Record<string, ModalHandler<ShapeValues<S>>>;
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
