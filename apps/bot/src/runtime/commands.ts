import { REST, Routes } from "discord.js";
import type { MessageBody, ModuleRegistry } from "@tier0/core";
import { prisma } from "@tier0/db";
import type { GuildState } from "./guild-state.js";
import { EVERYONE, parseChannelRules, serializeChannelRules } from "./command-policy.js";

const RESYNC_DELAY_MS = 5_000;

/** Fields left out are unchanged; null clears an override. */
export interface CommandPatch {
  enabled?: boolean;
  allowRoles?: string[];
  denyChannels?: string[];
  allowChannels?: string[];
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
/** What the last registration for a guild did, for the dashboard's count. */
export interface SyncStatus {
  /** How many commands Discord accepted, or null before the first registration finished. */
  registered: number | null;
  /** True while a change is waiting out the debounce. */
  pending: boolean;
  /** Why the last registration failed, or null when it worked. */
  failed: string | null;
}

export class CommandSync {
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private readonly results = new Map<string, { registered: number | null; failed: string | null }>();

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
    try {
      await this.rest.put(
        Routes.applicationGuildCommands(this.applicationId, guildId),
        { body: payload },
      );
    } catch (error) {
      const previous = this.results.get(guildId)?.registered ?? null;
      this.results.set(guildId, { registered: previous, failed: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    this.results.set(guildId, { registered: payload.length, failed: null });
  }

  status(guildId: string): SyncStatus {
    const result = this.results.get(guildId);
    return { registered: result?.registered ?? null, pending: this.pending.has(guildId), failed: result?.failed ?? null };
  }

  /** Upserts a command override and schedules the resync it implies. */
  async setOverride(
    guildId: string,
    command: string,
    patch: CommandPatch,
    { resync = true }: { resync?: boolean } = {},
  ): Promise<void> {
    // Both channel lists live in one column, so changing one keeps the other.
    let channels: string | undefined;
    if (patch.denyChannels !== undefined || patch.allowChannels !== undefined) {
      const existing = await prisma.commandOverride.findUnique({ where: { guildId_command: { guildId, command } } });
      const before = existing ? parseChannelRules(existing.denyChannels) : { deny: [], allow: [] };
      channels = serializeChannelRules({
        deny: patch.denyChannels ?? before.deny,
        allow: patch.allowChannels ?? before.allow,
      });
    }
    await prisma.commandOverride.upsert({
      where: { guildId_command: { guildId, command } },
      create: {
        guildId,
        command,
        enabled: patch.enabled ?? true,
        allowRoles: JSON.stringify(patch.allowRoles ?? []),
        denyChannels: channels ?? "[]",
        permissions: patch.permissions ?? null,
        ephemeral: patch.ephemeral ?? null,
        responseBody: patch.customReply ? JSON.stringify(patch.customReply) : null,
      },
      update: {
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.allowRoles !== undefined
          ? { allowRoles: JSON.stringify(patch.allowRoles) }
          : {}),
        ...(channels !== undefined ? { denyChannels: channels } : {}),
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
    // One part of a command changes nothing Discord holds: the bot alone enforces it.
    if (resync) this.schedule(guildId);
  }

  /** visible = commands of enabled modules, minus anything switched off. */
  private async resolve(guildId: string): Promise<unknown[]> {
    const modules = await this.state.enabledModules(guildId);
    const overrides = await prisma.commandOverride.findMany({ where: { guildId } });
    const byCommand = new Map(overrides.map((o) => [o.command, o]));

    const own = (await this.state.guildCommands(guildId)).map((entry) => entry.command);
    return [
      ...modules.flatMap((module) => [...(module.commands ?? []), ...(module.contextCommands ?? [])]),
      ...own,
    ]
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
