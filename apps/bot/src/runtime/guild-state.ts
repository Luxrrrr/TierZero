import type { Client, Guild } from "discord.js";
import type { ModuleContext, ModuleDefinition, ModuleRegistry } from "@tier0/core";
import { prisma } from "@tier0/db";

/**
 * Resolves and caches per-guild module state.
 *
 * Everything here is invalidated by the control API when the dashboard writes a
 * change, which is how a settings edit takes effect without a restart.
 */
export class GuildState {
  private readonly cache = new Map<string, Map<string, unknown>>();

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
  async context(guild: Guild, moduleId: string): Promise<ModuleContext | null> {
    const module = this.registry.get(moduleId);
    if (!module) return null;

    const settings = await this.settings(guild.id, moduleId);
    if (settings === null) return null;

    return {
      client: this.client,
      guild,
      settings,
      update: async (patch) => {
        const merged = { ...(settings as object), ...patch };
        const parsed = module.settings.parse(merged);
        if (!parsed.ok) {
          const detail = parsed.errors.map((e) => `${e.path} ${e.message}`).join("; ");
          throw new Error(`Rejected settings for ${moduleId}: ${detail}`);
        }
        await prisma.guildModule.update({
          where: { guildId_moduleId: { guildId: guild.id, moduleId } },
          data: { settings: JSON.stringify(parsed.value) },
        });
        this.invalidate(guild.id);
      },
    };
  }

  private async settings(guildId: string, moduleId: string): Promise<unknown | null> {
    let guildCache = this.cache.get(guildId);
    if (guildCache?.has(moduleId)) return guildCache.get(moduleId);

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
    guildCache.set(moduleId, resolved.value);
    return resolved.value;
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
