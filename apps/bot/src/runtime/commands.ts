import { REST, Routes } from "discord.js";
import type { MessageBody, ModuleRegistry } from "@tier0/core";
import { prisma } from "@tier0/db";
import type { GuildState } from "./guild-state.js";
import { EVERYONE } from "./command-policy.js";

const RESYNC_DELAY_MS = 5_000;

/** Fields left out are unchanged; null clears an override. */
export interface CommandPatch {
  enabled?: boolean;
  allowRoles?: string[];
  denyChannels?: string[];
  permissions?: string | null;
  ephemeral?: boolean | null;
  /** A full reply, or null to go back to what the command says. */
  customReply?: MessageBody | null;
}

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
    patch: CommandPatch,
  ): Promise<void> {
    await prisma.commandOverride.upsert({
      where: { guildId_command: { guildId, command } },
      create: {
        guildId,
        command,
        enabled: patch.enabled ?? true,
        allowRoles: JSON.stringify(patch.allowRoles ?? []),
        denyChannels: JSON.stringify(patch.denyChannels ?? []),
        permissions: patch.permissions ?? null,
        ephemeral: patch.ephemeral ?? null,
        responseBody: patch.customReply ? JSON.stringify(patch.customReply) : null,
      },
      update: {
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.allowRoles !== undefined
          ? { allowRoles: JSON.stringify(patch.allowRoles) }
          : {}),
        ...(patch.denyChannels !== undefined
          ? { denyChannels: JSON.stringify(patch.denyChannels) }
          : {}),
        // Null clears an override back to the command's own behaviour, so
        // these are written whenever they are present at all.
        ...(patch.permissions !== undefined ? { permissions: patch.permissions } : {}),
        ...(patch.ephemeral !== undefined ? { ephemeral: patch.ephemeral } : {}),
        // Saving a reply also retires the plain text an older version kept.
        ...(patch.customReply !== undefined
          ? { responseBody: patch.customReply ? JSON.stringify(patch.customReply) : null, response: null }
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
    const overrides = await prisma.commandOverride.findMany({ where: { guildId } });
    const byCommand = new Map(overrides.map((o) => [o.command, o]));

    return modules
      .flatMap((module) => [...(module.commands ?? []), ...(module.contextCommands ?? [])])
      .filter((command) => byCommand.get(command.name)?.enabled !== false)
      .map((command) => {
        const json: { default_member_permissions?: string | null } = command.build().toJSON();
        const permissions = byCommand.get(command.name)?.permissions;
        // Hiding a command from members who cannot run it is Discord's job, and
        // this field is the only way a bot token can ask for it.
        if (permissions) {
          json.default_member_permissions = permissions === EVERYONE ? null : permissions;
        }
        return json;
      });
  }
}
