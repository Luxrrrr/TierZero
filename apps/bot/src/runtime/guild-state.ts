import type { Client, Guild } from "discord.js";
import type {
  CommandSummary,
  FieldError,
  MessageBody,
  ModuleContext,
  ModuleDefinition,
  ModuleRegistry,
  ModuleSummary,
  RaisedDuration,
  ScheduledWork,
  Shape,
  ShapeValues,
} from "@tier0/core";
import { raisedDurations } from "@tier0/core";
import { prisma } from "@tier0/db";
import { LABEL_DEFAULTS, SYSTEM_MODULE_ID, type SystemSettings } from "@tier0/module-system";
import { matchesPayload, namespaceKind } from "./task-payload.js";
import { parseChannelRules, parseIdList, type CommandSettings } from "./command-policy.js";
import { storedReply } from "./command-reply.js";
import { resolveDashboardUrl } from "./dashboard-url.js";
import { editMessage, replyMessage, sendMessage } from "./send-message.js";

// The router resolves a module by name at runtime, so the cache cannot be
// generic over one module's shape. This is the widest settings type that
// still satisfies what a command handler is declared to accept.
type Settings = ShapeValues<Shape>;

/** Anything that can be asked to re-register a guild's commands. */
export interface Resync {
  schedule(guildId: string): void;
}

/** One part of a command, with what the owner set for it alone. */
export interface SubcommandState {
  name: string;
  key: string;
  description: string;
  enabled: boolean;
  allowRoles: string[];
  denyChannels: string[];
  allowChannels: string[];
}

export interface CommandState extends Omit<CommandSummary, "subcommands"> {
  subcommands: SubcommandState[];
  enabled: boolean;
  allowRoles: string[];
  denyChannels: string[];
  allowChannels: string[];
  permissions: string | null;
  ephemeral: boolean | null;
  customReply: MessageBody | null;
}

export interface GuildModuleState extends Omit<ModuleSummary, "commands"> {
  enabled: boolean;
  settings: unknown;
  /** Stored durations below their schema minimum, which every read raises to it. */
  raised: RaisedDuration[];
  commands: CommandState[];
}

export type ApplyModuleUpdateResult = { ok: true } | { ok: false; errors: FieldError[] };

/**
 * Resolves and caches per-guild module state.
 *
 * Everything here is invalidated by the control API when the dashboard writes a
 * change, which is how a settings edit takes effect without a restart.
 */
export class GuildState {
  private readonly cache = new Map<string, Map<string, Settings>>();
  private readonly enabledCache = new Map<string, ModuleDefinition[]>();
  private readonly policyCache = new Map<string, Map<string, CommandSettings>>();

  constructor(
    private readonly client: Client,
    private readonly registry: ModuleRegistry,
  ) {}

  invalidate(guildId: string): void {
    this.cache.delete(guildId);
    this.enabledCache.delete(guildId);
    this.policyCache.delete(guildId);
  }

  async enabledModules(guildId: string): Promise<ModuleDefinition[]> {
    const cached = this.enabledCache.get(guildId);
    if (cached) return cached;

    const rows = await prisma.guildModule.findMany({
      where: { guildId, enabled: true },
    });
    const chosen = rows
      .map((row) => this.registry.get(row.moduleId))
      .filter((module): module is ModuleDefinition => module !== undefined);
    // Built-in modules have no switch and no row to say they are on.
    const modules = [
      ...this.registry.all().filter((module) => module.alwaysOn === true && !chosen.includes(module)),
      ...chosen,
    ];

    this.enabledCache.set(guildId, modules);
    return modules;
  }

  /**
   * Role and channel rules for one command. Read on every invocation, so the
   * result is cached alongside the rest of a guild's state and dropped by the
   * same invalidation.
   */
  async commandPolicy(guildId: string, command: string): Promise<CommandSettings> {
    let guildPolicies = this.policyCache.get(guildId);
    const cached = guildPolicies?.get(command);
    if (cached) return cached;

    const row = await prisma.commandOverride.findUnique({
      where: { guildId_command: { guildId, command } },
    });
    const channels = row ? parseChannelRules(row.denyChannels) : { deny: [], allow: [] };
    const policy: CommandSettings = {
      enabled: row?.enabled ?? true,
      allowRoles: row ? parseIdList(row.allowRoles) : [],
      denyChannels: channels.deny,
      allowChannels: channels.allow,
      ephemeral: row?.ephemeral ?? null,
      customReply: storedReply(row),
      permissions: row?.permissions ?? null,
    };

    if (!guildPolicies) {
      guildPolicies = new Map();
      this.policyCache.set(guildId, guildPolicies);
    }
    guildPolicies.set(command, policy);
    return policy;
  }

  /** Looks a module up without going through the registry directly. */
  moduleFor(moduleId: string): ModuleDefinition | undefined {
    return this.registry.get(moduleId);
  }

  async isEnabled(guildId: string, moduleId: string): Promise<boolean> {
    if (this.registry.get(moduleId)?.alwaysOn === true) return true;
    const row = await prisma.guildModule.findUnique({
      where: { guildId_moduleId: { guildId, moduleId } },
    });
    return row?.enabled ?? false;
  }

  /**
   * The settings of the built-in system module: the text the router and the
   * component handlers send. Null only when that module is not registered; a
   * server that never saved anything, or whose stored settings no longer
   * validate, gets the defaults, so the bot never goes quiet over it.
   */
  async systemSettings(guildId: string): Promise<SystemSettings | null> {
    if (!this.registry.get(SYSTEM_MODULE_ID)) return null;
    const stored = (await this.settings(guildId, SYSTEM_MODULE_ID)) as SystemSettings | null;
    return stored ?? (this.defaults(SYSTEM_MODULE_ID) as SystemSettings);
  }

  /** What a menu says for a role or channel that was deleted, from the owner's labels. */
  private async unknownLabels(guildId: string): Promise<{ role: string; channel: string }> {
    const labels = (await this.systemSettings(guildId))?.labels;
    return { role: labels?.unknownRole ?? LABEL_DEFAULTS.unknownRole, channel: labels?.unknownChannel ?? LABEL_DEFAULTS.unknownChannel };
  }

  /**
   * Builds the context handed to commands and event handlers. Settings come
   * back parsed and defaulted, so a handler never sees a raw JSON string.
   */
  async context(guild: Guild, moduleId: string): Promise<ModuleContext<Settings> | null> {
    const module = this.registry.get(moduleId);
    if (!module) return null;

    const settings = await this.settings(guild.id, moduleId);
    if (settings === null) return null;

    return {
      client: this.client,
      guild,
      settings,
      tasks: taskQueue(guild.id, moduleId),
      send: async (target, body, values, options) =>
        sendMessage(target, body, values, { guild, unknown: await this.unknownLabels(guild.id), ...options }),
      edit: async (message, body, values, options) =>
        editMessage(message, body, values, { guild, unknown: await this.unknownLabels(guild.id), ...options }),
      reply: async (interaction, body, values, options) =>
        replyMessage(interaction, body, values, { guild, unknown: await this.unknownLabels(guild.id), ...options }),
      dashboardUrl: async () => {
        // The address is one setting of the moderation module, which every module's links share.
        const moderation = await this.settings(guild.id, "moderation");
        return resolveDashboardUrl(moderation?.dashboardUrl);
      },
      peer: async (peerId) => (peerId !== moduleId && (await this.isEnabled(guild.id, peerId)) ? this.context(guild, peerId) : null),
      update: async (patch) => {
        const merged = { ...settings, ...patch };
        const parsed = module.settings.parse(merged);
        if (!parsed.ok) {
          const detail = parsed.errors.map((e) => `${e.path} ${e.message}`).join("; ");
          throw new Error(`Rejected settings for ${moduleId}: ${detail}`);
        }
        await prisma.guildModule.upsert({
          where: { guildId_moduleId: { guildId: guild.id, moduleId } },
          create: { guildId: guild.id, moduleId, settings: JSON.stringify(parsed.value) },
          update: { settings: JSON.stringify(parsed.value) },
        });
        this.invalidate(guild.id);

        if (module.onSettingsChange) {
          const nextCtx = await this.context(guild, moduleId);
          if (nextCtx) {
            await this.runHook(moduleId, "onSettingsChange", () =>
              module.onSettingsChange!(nextCtx, settings),
            );
          }
        }
      },
    };
  }

  /**
   * Every registered module with this guild's enabled flag and fully resolved
   * settings, for the dashboard's module list.
   */
  async describeForGuild(guildId: string): Promise<GuildModuleState[]> {
    const [rows, overrides] = await Promise.all([
      prisma.guildModule.findMany({ where: { guildId } }),
      prisma.commandOverride.findMany({ where: { guildId } }),
    ]);
    const byModule = new Map(rows.map((row) => [row.moduleId, row]));
    const byCommand = new Map(overrides.map((row) => [row.command, row]));

    return Promise.all(
      this.registry.describe().map(async (summary) => {
        const row = byModule.get(summary.id);
        const settings = (await this.settings(guildId, summary.id)) ?? this.defaults(summary.id);
        // A command with no override row is visible to everyone, everywhere,
        // which is the default the dashboard has to show as such.
        const commands = summary.commands.map((command) => {
          const override = byCommand.get(command.name);
          const channels = override ? parseChannelRules(override.denyChannels) : { deny: [], allow: [] };
          return {
            ...command,
            enabled: override?.enabled ?? true,
            allowRoles: override ? parseIdList(override.allowRoles) : [],
            denyChannels: channels.deny,
            allowChannels: channels.allow,
            permissions: override?.permissions ?? null,
            ephemeral: override?.ephemeral ?? null,
            customReply: storedReply(override ?? null),
            subcommands: command.subcommands.map((part) => {
              const own = byCommand.get(part.key);
              const rules = own ? parseChannelRules(own.denyChannels) : { deny: [], allow: [] };
              return {
                ...part,
                enabled: own?.enabled ?? true,
                allowRoles: own ? parseIdList(own.allowRoles) : [],
                denyChannels: rules.deny,
                allowChannels: rules.allow,
              };
            }),
          };
        });
        const raised = row ? raisedDurations(summary.schema, safeParse(row.settings)) : [];
        return { ...summary, enabled: summary.alwaysOn || (row?.enabled ?? false), settings, raised, commands };
      }),
    );
  }

  /**
   * Validates and persists an enabled flag, settings patch, or both, then
   * invalidates the cache, schedules a command resync, and fires whichever of
   * onEnable/onDisable/onSettingsChange applies. All of that happens before
   * this returns, so a caller never observes a saved change the running bot
   * has not yet applied.
   */
  async applyModuleUpdate(
    guild: Guild,
    moduleId: string,
    patch: { enabled?: boolean; settings?: unknown },
    resync: Resync,
  ): Promise<ApplyModuleUpdateResult> {
    const module = this.registry.get(moduleId);
    if (!module) {
      return { ok: false, errors: [{ path: "", message: `Unknown module ${moduleId}` }] };
    }

    const existing = await prisma.guildModule.findUnique({
      where: { guildId_moduleId: { guildId: guild.id, moduleId } },
    });
    // A built-in module is on whatever its row says, and cannot be switched off.
    const wasEnabled = module.alwaysOn === true || (existing?.enabled ?? false);
    const storedBefore = existing ? safeParse(existing.settings) : {};
    const resolvedBefore = this.registry.resolveSettings(moduleId, storedBefore);
    const settingsBefore = resolvedBefore.ok ? (resolvedBefore.value as Settings) : undefined;

    // Only settings actually being patched are validated. Re-validating what is
    // already stored would make a module whose schema has changed underneath it
    // impossible to disable, which is exactly when an operator needs to.
    let nextSettings: Settings | undefined;
    if (patch.settings !== undefined) {
      const resolved = this.registry.resolveSettings(moduleId, patch.settings);
      if (!resolved.ok) {
        return { ok: false, errors: resolved.errors };
      }
      nextSettings = resolved.value as Settings;
    }

    const isEnabled = module.alwaysOn === true || (patch.enabled ?? wasEnabled);
    const settingsJson = nextSettings === undefined ? undefined : JSON.stringify(nextSettings);

    await prisma.guildModule.upsert({
      where: { guildId_moduleId: { guildId: guild.id, moduleId } },
      create: {
        guildId: guild.id,
        moduleId,
        enabled: isEnabled,
        settings: settingsJson ?? "{}",
      },
      update: {
        enabled: isEnabled,
        ...(settingsJson === undefined ? {} : { settings: settingsJson }),
      },
    });

    this.invalidate(guild.id);
    resync.schedule(guild.id);

    const ctx = await this.context(guild, moduleId);
    if (!ctx) return { ok: true };

    if (!wasEnabled && isEnabled && module.onEnable) {
      await this.runHook(moduleId, "onEnable", () => module.onEnable!(ctx));
    }
    if (wasEnabled && !isEnabled && module.onDisable) {
      await this.runHook(moduleId, "onDisable", () => module.onDisable!(ctx));
    }

    // Settings that failed validation leave no usable previous value, so the
    // hook is handed the defaults the module was effectively running on. Not
    // firing at all would strand any module that rebuilds external state here.
    if (nextSettings !== undefined && module.onSettingsChange) {
      const previous = settingsBefore ?? (this.defaults(moduleId) as Settings);
      if (JSON.stringify(previous) !== JSON.stringify(nextSettings)) {
        await this.runHook(moduleId, "onSettingsChange", () =>
          module.onSettingsChange!(ctx, previous),
        );
      }
    }

    return { ok: true };
  }

  private async runHook(moduleId: string, hook: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      console.error(`[${moduleId}] ${hook} hook failed:`, error);
    }
  }

  private defaults(moduleId: string): unknown {
    const resolved = this.registry.resolveSettings(moduleId, {});
    return resolved.ok ? resolved.value : {};
  }

  private async settings(guildId: string, moduleId: string): Promise<Settings | null> {
    let guildCache = this.cache.get(guildId);
    const cached = guildCache?.get(moduleId);
    if (cached !== undefined) return cached;

    const row = await prisma.guildModule.findUnique({
      where: { guildId_moduleId: { guildId, moduleId } },
    });

    const stored = row ? safeParse(row.settings) : {};
    const resolved = this.registry.resolveSettings(moduleId, stored);

    if (!resolved.ok) {
      // Stored settings that no longer satisfy the schema mean the module was
      // updated without a settings migration. Log loudly and treat the module
      // as unconfigured. Crashing the gateway connection over it would be
      // much worse.
      console.error(
        `[${moduleId}] settings in guild ${guildId} failed validation:`,
        resolved.errors,
      );
      return null;
    }

    if (!guildCache) {
      guildCache = new Map();
      this.cache.set(guildId, guildCache);
    }
    const value = resolved.value as Settings;
    guildCache.set(moduleId, value);
    return value;
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/**
 * A module's view of the scheduled work table. Scheduling is only a row, so
 * this needs nothing from the runner that later picks the row up.
 *
 * Kinds are stored namespaced by module, so two modules can both schedule an
 * "expire" without reading each other's work.
 */
function taskQueue(guildId: string, moduleId: string): ScheduledWork {
  const namespaced = (kind: string) => namespaceKind(moduleId, kind);

  return {
    async schedule(kind, runAt, payload = {}) {
      await prisma.scheduledTask.create({
        data: {
          guildId,
          kind: namespaced(kind),
          runAt,
          payload: JSON.stringify(payload),
        },
      });
    },

    async cancel(kind, match) {
      const rows = await prisma.scheduledTask.findMany({
        where: { guildId, kind: namespaced(kind) },
      });
      const doomed = rows.filter((row) => matchesPayload(safeParse(row.payload), match));
      if (doomed.length === 0) return 0;
      await prisma.scheduledTask.deleteMany({
        where: { id: { in: doomed.map((row) => row.id) } },
      });
      return doomed.length;
    },

    async reschedule(kind, runAt, payload = {}) {
      const text = JSON.stringify(payload);
      const moved = await prisma.scheduledTask.updateMany({ where: { guildId, kind: namespaced(kind), payload: text }, data: { runAt } });
      if (moved.count === 0) await prisma.scheduledTask.create({ data: { guildId, kind: namespaced(kind), runAt, payload: text } });
    },
  };
}
