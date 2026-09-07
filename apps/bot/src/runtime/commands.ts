import { REST, Routes } from "discord.js";
import type { ModuleRegistry } from "@tier0/core";
import { prisma } from "@tier0/db";
import type { GuildState } from "./guild-state";

const RESYNC_DELAY_MS = 5_000;

/**
 * Owns which slash commands exist in each guild.
 *
 * Commands are registered per guild rather than globally. Global commands are
 * cached by Discord for around an hour and are identical everywhere, which
 * makes the per-server visibility the dashboard promises impossible.
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

  /** visible = commands of enabled modules, minus anything switched off. */
  private async resolve(guildId: string): Promise<unknown[]> {
    const modules = await this.state.enabledModules(guildId);
    const overrides = await prisma.commandOverride.findMany({
      where: { guildId, enabled: false },
    });
    const disabled = new Set(overrides.map((o) => o.command));

    return modules
      .flatMap((module) => module.commands ?? [])
      .filter((command) => !disabled.has(command.name))
      .map((command) => command.build().toJSON());
  }
}
