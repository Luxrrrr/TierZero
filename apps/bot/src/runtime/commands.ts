import { REST, Routes } from "discord.js";
import type { ModuleRegistry } from "@tier0/core";
import { prisma } from "@tier0/db";
import type { GuildState } from "./guild-state.js";

const RESYNC_DELAY_MS = 5_000;

/**
 * Owns which slash commands exist in each guild.
 *
 * Commands are registered per guild, never globally. A global command is
 * cached by Discord for around an hour and looks identical everywhere, which
 * would break the per-server visibility the dashboard promises.
 */
export class CommandSync {
  private readonly pending = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly rest: REST,
    private readonly applicationId: string,
    private readonly registry: ModuleRegistry,
    private readonly state: GuildState,
  ) {}

  /** Coalesces the burst of changes an operator makes while clicking around. */
  schedule(guildId: string): void {
    clearTimeout(this.pending.get(guildId));
    this.pending.set(
      guildId,
      setTimeout(() => {
        this.pending.delete(guildId);
        void this.run(guildId).catch((error) => {
          console.error(`Command sync failed for guild ${guildId}:`, error);
        });
      }, RESYNC_DELAY_MS),
    );
  }

  async run(guildId: string): Promise<void> {
    const payload = await this.resolve(guildId);
    await this.rest.put(
      Routes.applicationGuildCommands(this.applicationId, guildId),
      { body: payload },
    );
  }

  /** Upserts a command override and schedules the resync it implies. */
  async setOverride(
    guildId: string,
    command: string,
    patch: { enabled?: boolean; allowRoles?: string[]; denyChannels?: string[] },
  ): Promise<void> {
    await prisma.commandOverride.upsert({
      where: { guildId_command: { guildId, command } },
      create: {
        guildId,
        command,
        enabled: patch.enabled ?? true,
        allowRoles: JSON.stringify(patch.allowRoles ?? []),
        denyChannels: JSON.stringify(patch.denyChannels ?? []),
      },
      update: {
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.allowRoles !== undefined
          ? { allowRoles: JSON.stringify(patch.allowRoles) }
          : {}),
        ...(patch.denyChannels !== undefined
          ? { denyChannels: JSON.stringify(patch.denyChannels) }
          : {}),
      },
    });
    // The router reads these rules from a cache on every invocation, so the
    // write has to invalidate it here. Leaving that to the caller means it
    // eventually gets forgotten.
    this.state.invalidate(guildId);
    this.schedule(guildId);
  }

  /** visible = commands of enabled modules, minus anything switched off. */
  private async resolve(guildId: string): Promise<unknown[]> {
    const modules = await this.state.enabledModules(guildId);
    const overrides = await prisma.commandOverride.findMany({
      where: { guildId, enabled: false },
    });
    const disabled = new Set(overrides.map((o) => o.command));

    return modules
      .flatMap((module) => [...(module.commands ?? []), ...(module.contextCommands ?? [])])
      .filter((command) => !disabled.has(command.name))
      .map((command) => command.build().toJSON());
  }
}
