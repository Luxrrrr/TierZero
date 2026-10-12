import type {
  ChatInputCommandInteraction,
  Client,
  ReadonlyCollection,
  ContextMenuCommandBuilder,
  ContextMenuCommandInteraction,
  Guild,
  GuildBan,
  GuildChannel,
  GuildEmoji,
  GuildMember,
  InteractionReplyOptions,
  Invite,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  Message,
  PartialGuildMember,
  PartialMessage,
  Role,
  Snowflake,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  ThreadChannel,
  VoiceState,
} from "discord.js";
import type { ReplyValues, ResponseTemplate } from "./response.js";
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
  /**
   * Set by the router while a command runs. Called with the values a command
   * knows (the member it acted on, a case number), it returns the reply the
   * owner wrote for this command with those filled in, or null when the owner
   * has not written one and the command should say what it always says.
   */
  customReply?(values: ReplyValues): InteractionReplyOptions | null;
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
  /**
   * True when the command answers in the channel for everyone to see. Most
   * answer privately, so that is the default. The dashboard uses this to show
   * which choice an owner has not changed.
   */
  publicReply?: boolean;
  /**
   * True when whether a reply is private depends on what happens: a refusal is
   * shown to one person and a confirmation to the channel. The dashboard does
   * not offer a single private or public choice for such a command.
   */
  variedReply?: boolean;
  /** Present when the owner may rewrite the reply from the dashboard. */
  response?: ResponseTemplate;
  run(interaction: ChatInputCommandInteraction, ctx: ModuleContext<T>): Promise<void>;
}

/**
 * An entry in Discord's right-click menu, on a member or on a message. These
 * share the command namespace and the Commands page with slash commands, so one
 * can be switched off or limited to roles the same way.
 */
export interface ContextCommandDefinition<T = unknown> {
  /** Must be unique across every command of every module; spaces and capitals are allowed. */
  name: string;
  description: string;
  /** Whether it appears when right-clicking a member or a message. */
  kind: "user" | "message";
  build(): ContextMenuCommandBuilder;
  /**
   * True when the command answers in the channel for everyone to see. Most
   * answer privately, so that is the default. The dashboard uses this to show
   * which choice an owner has not changed.
   */
  publicReply?: boolean;
  run(interaction: ContextMenuCommandInteraction, ctx: ModuleContext<T>): Promise<void>;
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
  /** A purge: one event for the whole batch, instead of one messageDelete for each message in it. */
  messageDeleteBulk(
    messages: ReadonlyCollection<Snowflake, Message | PartialMessage>,
    channel: GuildChannel | ThreadChannel,
    ctx: ModuleContext<T>,
  ): Promise<void>;
  channelUpdate(before: GuildChannel, after: GuildChannel, ctx: ModuleContext<T>): Promise<void>;
  threadCreate(thread: ThreadChannel, ctx: ModuleContext<T>): Promise<void>;
  threadDelete(thread: ThreadChannel, ctx: ModuleContext<T>): Promise<void>;
  roleUpdate(before: Role, after: Role, ctx: ModuleContext<T>): Promise<void>;
  guildUpdate(before: Guild, after: Guild, ctx: ModuleContext<T>): Promise<void>;
  voiceStateUpdate(before: VoiceState, after: VoiceState, ctx: ModuleContext<T>): Promise<void>;
  inviteCreate(invite: Invite, ctx: ModuleContext<T>): Promise<void>;
  inviteDelete(invite: Invite, ctx: ModuleContext<T>): Promise<void>;
  emojiCreate(emoji: GuildEmoji, ctx: ModuleContext<T>): Promise<void>;
  emojiUpdate(before: GuildEmoji, after: GuildEmoji, ctx: ModuleContext<T>): Promise<void>;
  emojiDelete(emoji: GuildEmoji, ctx: ModuleContext<T>): Promise<void>;
  banAdd(ban: GuildBan, ctx: ModuleContext<T>): Promise<void>;
  banRemove(ban: GuildBan, ctx: ModuleContext<T>): Promise<void>;
}

/**
 * Buttons, select menus and modals are addressed by custom id. The router
 * splits an id as `moduleId:action:rest`, the same namespacing scheduled work
 * uses, so a module only ever sees interactions it created and two modules can
 * both use an action called "confirm".
 *
 * Build ids with `customId()` instead of writing the string by hand.
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
 * A short line shown beside one row of a list setting, such as whether a feed
 * was read successfully the last time it was checked.
 */
export interface RowStatus {
  tone: "ok" | "problem" | "idle";
  text: string;
}

/** Where a row sits, handed to the hooks that act on rows. */
export interface RowRef {
  /** Dotted and indexed, as validation errors are: `patchNotes.destinations[0].games[1]`. */
  path: string;
  row: Record<string, unknown>;
  /** The object that holds the list, so a row can be read in the context it sits in. */
  parent: Record<string, unknown>;
}

export interface RowActionResult {
  ok: boolean;
  /** Shown to the person who pressed the button, so it should say what happened. */
  message: string;
}

/**
 * Something a person can do to one row of a list from the dashboard, without
 * it being a setting: send a feed's latest posts now, say. The dashboard draws
 * the button and the inputs from this description, so a module never ships UI.
 */
export interface RowAction<T = unknown> {
  label: string;
  /** Shown above the inputs, when there are any. */
  help?: string;
  /** What the action asks for before it runs. Left out, the button just runs. */
  input?: ObjectField<Shape>;
  run(args: {
    ctx: ModuleContext<T>;
    row: RowRef;
    input: Record<string, unknown>;
  }): Promise<RowActionResult>;
}

export interface RowHooks<T = unknown> {
  /** One entry per row, in order. A null leaves that row without a status line. */
  status?(args: {
    ctx: ModuleContext<T>;
    path: string;
    rows: RowRef[];
  }): Promise<(RowStatus | null)[]>;
  actions?: Record<string, RowAction<T>>;
}

/**
 * Which section of the dashboard a module is configured under. The list is
 * closed: a module picking its own section name would leave the navigation
 * growing a new entry every time somebody wrote a module, and the point of
 * grouping is that related settings sit together.
 */
export type ModuleCategory =
  | "moderation"
  | "members"
  | "engagement"
  | "support"
  | "logging"
  | "utility"
  | "more";

export interface ModuleDefinition<S extends Shape = Shape> {
  id: string;
  name: string;
  summary: string;
  /** Defaults to "utility" for a module that does not say. */
  category?: ModuleCategory;
  /**
   * A part of the dashboard that hosts this module's settings, for a feature
   * that has a section of its own. The settings form is still drawn from the
   * schema; only where it sits changes. Left out, the settings live on the
   * module's own page.
   */
  area?: "moderation";
  settings: ObjectField<S>;
  commands?: CommandDefinition<ShapeValues<S>>[];
  /** Entries for Discord's right-click menu on members and messages. */
  contextCommands?: ContextCommandDefinition<ShapeValues<S>>[];
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
  /**
   * Status lines and actions for the rows of a list setting, keyed by the
   * list's path in the schema without indices, such as `news.feeds`.
   */
  rows?: Record<string, RowHooks<ShapeValues<S>>>;
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
