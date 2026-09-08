import type { Client } from "discord.js";
import type { ModuleRegistry } from "@tier0/core";
import { prisma } from "@tier0/db";
import type { GuildState } from "./guild-state.js";
import { parsePayload, splitKind } from "./task-payload.js";

const TICK_MS = 15_000;

/**
 * Runs work that was scheduled for later: lifting a temporary ban, closing an
 * idle ticket.
 *
 * Due work is read from the database on a fixed tick rather than held in
 * timers, so anything scheduled before a restart still runs after one. The
 * tick is coarse because nothing here is time critical to the second, and a
 * quiet instance should not be waking up constantly to find nothing to do.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly client: Client,
    private readonly registry: ModuleRegistry,
    private readonly state: GuildState,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    // Nothing else keeps the process alive on this handle's account.
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * Claims and runs everything that is due. Overlapping ticks are skipped
   * rather than queued, because a slow batch would otherwise be started again
   * underneath itself.
   */
  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const due = await prisma.scheduledTask.findMany({
        where: { runAt: { lte: now } },
        orderBy: { runAt: "asc" },
        take: 50,
      });

      for (const task of due) {
        // Delete first. A handler that throws must not leave the row behind to
        // be retried forever on every tick.
        await prisma.scheduledTask.delete({ where: { id: task.id } }).catch(() => undefined);
        await this.run(task.guildId, task.kind, task.payload);
      }
    } catch (error) {
      console.error("Scheduler tick failed:", error);
    } finally {
      this.running = false;
    }
  }

  private async run(guildId: string, namespacedKind: string, payload: string): Promise<void> {
    const split = splitKind(namespacedKind);
    if (!split) return;
    const { moduleId, kind } = split;

    const module = this.registry.get(moduleId);
    const handler = module?.tasks?.[kind];
    if (!handler) return;

    if (!(await this.state.isEnabled(guildId, moduleId))) return;

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;

    const ctx = await this.state.context(guild, moduleId);
    if (!ctx) return;

    try {
      await handler(parsePayload(payload), ctx);
    } catch (error) {
      console.error(`[${moduleId}] scheduled ${kind} failed:`, error);
    }
  }
}
