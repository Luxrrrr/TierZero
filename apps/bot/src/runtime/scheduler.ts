import type { Client } from "discord.js";
import type { ModuleRegistry } from "@tier0/core";
import { prisma } from "@tier0/db";
import type { GuildState } from "./guild-state.js";
import { parsePayload, splitKind } from "./task-payload.js";

const TICK_MS = 15_000;
const DEFER_MS = 60_000;
const KEEP_UNRUNNABLE_MS = 7 * 24 * 60 * 60_000;

/**
 * Runs work that was scheduled for later: lifting a temporary ban, closing an
 * idle ticket.
 *
 * Due work is read from the database on a fixed tick. Timers would be lost
 * on restart, and anything scheduled before one still needs to run after it.
 * The tick is coarse because nothing here is time critical to the second, and
 * a quiet instance should not be waking up constantly to find nothing to do.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  /** When each stuck task was first found unable to run. Lost on restart, which only gives it another week. */
  private readonly stuckSince = new Map<number, number>();

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
   * Claims and runs everything that is due. Overlapping ticks are skipped,
   * not queued. A slow batch would otherwise get started again underneath
   * itself.
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
        const split = splitKind(task.kind);
        const handler = split ? this.registry.get(split.moduleId)?.tasks?.[split.kind] : undefined;
        if (!split || !handler) {
          await prisma.scheduledTask.delete({ where: { id: task.id } }).catch(() => undefined);
          continue;
        }

        const ctx = await this.contextFor(task.guildId, split.moduleId);
        if (!ctx) {
          await this.defer(task, now);
          continue;
        }

        // Delete first. A handler that throws must not leave the row behind to
        // be retried forever on every tick. A handler that wants another go
        // schedules it itself.
        this.stuckSince.delete(task.id);
        await prisma.scheduledTask.delete({ where: { id: task.id } }).catch(() => undefined);
        try {
          await handler(parsePayload(task.payload), ctx);
        } catch (error) {
          console.error(`[${split.moduleId}] scheduled ${split.kind} failed:`, error);
        }
      }
    } catch (error) {
      console.error("Scheduler tick failed:", error);
    } finally {
      this.running = false;
    }
  }

  /** The context to run a task in, or null when the module is off, the guild is not loaded yet or its settings are unreadable. */
  private async contextFor(guildId: string, moduleId: string) {
    if (!(await this.state.isEnabled(guildId, moduleId))) return null;
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return null;
    return this.state.context(guild, moduleId);
  }

  /**
   * Work that cannot run right now is kept, not dropped: at startup the guilds
   * are not cached for a moment, and a module switched off for an afternoon
   * should still lift the ban it queued. It is pushed back a minute so a pile
   * of such rows cannot crowd out work that can run, and dropped once it has
   * been stuck for a week, which is a guild the bot has left or a module
   * nobody is coming back to.
   */
  private async defer(task: { id: number; kind: string; guildId: string }, now: Date): Promise<void> {
    const first = this.stuckSince.get(task.id) ?? now.getTime();
    if (now.getTime() - first >= KEEP_UNRUNNABLE_MS) {
      this.stuckSince.delete(task.id);
      console.warn(`Scheduler dropped ${task.kind} for guild ${task.guildId}: it could not run for a week.`);
      await prisma.scheduledTask.delete({ where: { id: task.id } }).catch(() => undefined);
      return;
    }
    this.stuckSince.set(task.id, first);
    await prisma.scheduledTask
      .update({ where: { id: task.id }, data: { runAt: new Date(now.getTime() + DEFER_MS) } })
      .catch(() => undefined);
  }
}
