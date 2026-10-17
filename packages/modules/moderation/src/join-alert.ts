import type { GuildMember } from "discord.js";
import type { ModuleContext } from "@tier0/core";
import type { ModerationSettings } from "./settings.js";
import { RAID_ALERT } from "./messages.js";
import { botCanLock, lockChannels } from "./lockdown.js";
import { auditLockdown } from "./raid-audit.js";
import { fillLabel } from "./texts.js";

/**
 * Counts joins per server to spot a raid. Kept in memory: a burst of joins is a
 * matter of seconds, and a restart in the middle of one only costs the count
 * so far. The last ten minutes are kept, which is also what the Raid tools tab
 * shows as recent joins.
 */

const KEEP_MS = 10 * 60_000;
/** A busy server's burst is still a burst at this size; older joins are dropped first. */
const KEEP_MAX = 2000;

export interface AlertRule {
  joins: number;
  windowMs: number;
}

export class JoinTracker {
  private readonly joins = new Map<string, number[]>();
  private readonly alerted = new Map<string, number>();

  /** Records a join and says whether it sets the alert off. It goes off once, then waits for the burst to pass. */
  record(guildId: string, now: number, rule: AlertRule | null): boolean {
    const times = (this.joins.get(guildId) ?? []).filter((at) => now - at < KEEP_MS);
    times.push(now);
    if (times.length > KEEP_MAX) times.splice(0, times.length - KEEP_MAX);
    this.joins.set(guildId, times);
    if (!rule) return false;

    const inWindow = times.filter((at) => now - at < rule.windowMs).length;
    if (inWindow < rule.joins) return false;
    // Quiet until a whole window has gone by without enough joins to set it off again, and for at least five minutes.
    const last = this.alerted.get(guildId);
    if (last !== undefined && now - last < Math.max(rule.windowMs, 5 * 60_000)) {
      this.alerted.set(guildId, now);
      return false;
    }
    this.alerted.set(guildId, now);
    return true;
  }

  /** How many joined in the last ten minutes. */
  recent(guildId: string, now: number): number {
    return this.windowCount(guildId, now, KEEP_MS);
  }

  windowCount(guildId: string, now: number, windowMs: number): number {
    return (this.joins.get(guildId) ?? []).filter((at) => now - at < windowMs).length;
  }

  forget(guildId: string): void {
    this.joins.delete(guildId);
    this.alerted.delete(guildId);
  }
}

export const joinTracker = new JoinTracker();

type Ctx = ModuleContext<ModerationSettings>;

/** The moderation module's join handler: counts the join, and on a burst alerts staff and maybe locks down. */
export async function onMemberJoin(_member: GuildMember, ctx: Ctx, now = Date.now()): Promise<void> {
  const alert = ctx.settings.joinAlert;
  const rule = alert.enabled ? { joins: alert.joins, windowMs: alert.window } : null;
  if (!joinTracker.record(ctx.guild.id, now, rule) || !rule) return;

  let lockdownNote = "";
  if (alert.lockdown && botCanLock(ctx.guild)) {
    const botId = ctx.client.user?.id ?? "0";
    const reason = ctx.settings.labels.reasons.joinAlert;
    const endsAt = alert.lockdownLength ? new Date(now + alert.lockdownLength) : null;
    const result = await lockChannels(ctx, { channels: "all", actorId: botId, reason, endsAt });
    await auditLockdown(ctx, { actorId: botId, actorName: "", automatic: true, locked: true, result, reason });
    if (result.changed.length > 0) {
      const { counts, notes } = ctx.settings.labels;
      const count = fillLabel(result.changed.length === 1 ? counts.channelOne : counts.channelMany, { count: result.changed.length });
      lockdownNote = ` ${fillLabel(notes.raidLocked, { count })}`;
    }
  }

  const channelId = ctx.settings.modLogChannel;
  const channel = channelId ? ctx.guild.channels.cache.get(channelId) : undefined;
  if (!channel?.isTextBased()) return;
  const base = await ctx.dashboardUrl();
  await ctx.send(
    channel,
    alert.message,
    {
      joins: joinTracker.windowCount(ctx.guild.id, now, rule.windowMs),
      seconds: Math.round(rule.windowMs / 1000),
      lockdownNote,
      dashboardUrl: base ? `${base}/guilds/${ctx.guild.id}/mod/raid` : "",
    },
    { fallback: RAID_ALERT, mentions: { users: [], roles: [] } },
  );
}
