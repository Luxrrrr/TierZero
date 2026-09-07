import type { Client, Guild } from "discord.js";
import type {
  ModuleContext,
  ModuleDefinition,
  ModuleRegistry,
  Shape,
  ShapeValues,
} from "@tier0/core";
import { prisma } from "@tier0/db";

// The router resolves a module by name at runtime, so the cache cannot be
// generic over one module's shape. This is the widest settings type that
// still satisfies what a command handler is declared to accept.
type Settings = ShapeValues<Shape>;

/**
 * Resolves and caches per-guild module state.
 *
 * Everything here is invalidated by the control API when the dashboard writes a
 * change, which is how a settings edit takes effect without a restart.
 */
export class GuildState {
  private readonly cache = new Map<string, Map<string, Settings>>();

  constructor(
    private readonly client: Client,
    private readonly registry: ModuleRegistry,
  ) {}

  invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }

  async enabledModules(guildId: string): Promise<ModuleDefinition[]> {
    const rows = await prisma.guildModule.findMany({
      where: { guildId, enabled: true },
    });
    return rows
      .map((row) => this.registry.get(row.moduleId))
      .filter((module): module is ModuleDefinition => module !== undefined);
  }

  async isEnabled(guildId: string, moduleId: string): Promise<boolean> {
    const row = await prisma.guildModule.findUnique({
      where: { guildId_moduleId: { guildId, moduleId } },
    });
    return row?.enabled ?? false;
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
      },
    };
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
      // as unconfigured rather than crashing the gateway connection.
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
