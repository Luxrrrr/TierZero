import { ChannelType, PermissionFlagsBits, type Guild, type GuildBasedChannel } from "discord.js";
import type { ModuleContext, TaskPayload } from "@tier0/core";
import { prisma } from "@tier0/db";
import type { ModerationSettings } from "./settings.js";
import { describeDiscordError } from "./action-rules.js";
import { LOCKDOWN_NOTICE, UNLOCK_NOTICE } from "./messages.js";
import { fillLabel } from "./texts.js";

/**
 * Locking channels during a raid. A lock denies @everyone the right to talk in
 * a channel; what the @everyone overwrite said about each of those permissions
 * before is stored first, so unlocking puts exactly that back, whatever staff
 * changed in the meantime about anything else, and a restart in between loses
 * nothing. The overwrite arithmetic is kept apart from Discord to be tested.
 */

type Ctx = ModuleContext<ModerationSettings>;

/** What a lock takes away from @everyone. Reading and joining voice are left alone, so the channel still shows. */
export const LOCK_PERMISSIONS = ["SendMessages", "SendMessagesInThreads", "CreatePublicThreads", "CreatePrivateThreads", "AddReactions", "Speak"] as const;
export type LockPermission = (typeof LOCK_PERMISSIONS)[number];

export type BitState = "allow" | "deny" | "unset";

export interface PreviousOverwrite {
  /** Whether @everyone had an overwrite on the channel at all. */
  had: boolean;
  bits: Record<LockPermission, BitState>;
}

/** What the @everyone overwrite said about each locked permission, from its allow and deny bits. */
export function previousOf(overwrite: { allow: bigint; deny: bigint } | null): PreviousOverwrite {
  const bits = {} as Record<LockPermission, BitState>;
  for (const name of LOCK_PERMISSIONS) {
    const flag = PermissionFlagsBits[name];
    bits[name] = overwrite && (overwrite.allow & flag) !== 0n ? "allow" : overwrite && (overwrite.deny & flag) !== 0n ? "deny" : "unset";
  }
  return { had: overwrite !== null, bits };
}

/** The edit that locks: every locked permission denied. Discord merges it into the overwrite there is. */
export function lockPatch(): Record<LockPermission, false> {
  return Object.fromEntries(LOCK_PERMISSIONS.map((name) => [name, false])) as Record<LockPermission, false>;
}

/** The edit that puts each locked permission back as it was: allowed, denied, or left to the roles. */
export function restorePatch(previous: PreviousOverwrite): Record<LockPermission, boolean | null> {
  return Object.fromEntries(
    LOCK_PERMISSIONS.map((name) => [name, previous.bits[name] === "allow" ? true : previous.bits[name] === "deny" ? false : null]),
  ) as Record<LockPermission, boolean | null>;
}

/**
 * After restoring: an overwrite the lock created, which now allows and denies
 * nothing, is removed, so the channel looks as it did. One that existed before,
 * or that staff have since given other permissions, stays.
 */
export function shouldRemoveAfterRestore(previous: PreviousOverwrite, after: { allow: bigint; deny: bigint } | null): boolean {
  return !previous.had && after !== null && after.allow === 0n && after.deny === 0n;
}

export function readPrevious(stored: string): PreviousOverwrite | null {
  try {
    const value = JSON.parse(stored) as Partial<PreviousOverwrite>;
    if (typeof value?.had !== "boolean" || typeof value.bits !== "object" || value.bits === null) return null;
    const bits = {} as Record<LockPermission, BitState>;
    for (const name of LOCK_PERMISSIONS) {
      const state = (value.bits as Record<string, unknown>)[name];
      bits[name] = state === "allow" || state === "deny" ? state : "unset";
    }
    return { had: value.had, bits };
  } catch {
    return null;
  }
}

const LOCKABLE_TYPES = new Set<ChannelType>([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
]);

export interface LockableChannel {
  id: string;
  name: string;
  parent: string | null;
  exempt: boolean;
}

/** Whether a channel is one a lockdown covers: a place members can see and talk in. */
export function isLockable(channel: GuildBasedChannel, guild: Guild): boolean {
  if (!LOCKABLE_TYPES.has(channel.type)) return false;
  return channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel) ?? false;
}

/** Every channel a lockdown could cover, in the server's order, marking the ones the settings leave alone. */
export function lockableChannels(guild: Guild, exempt: readonly string[]): LockableChannel[] {
  return [...guild.channels.cache.values()]
    .filter((channel) => isLockable(channel, guild))
    .sort((a, b) => ("rawPosition" in a && "rawPosition" in b ? (a.rawPosition as number) - (b.rawPosition as number) : 0))
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      parent: channel.parent?.name ?? null,
      exempt: exempt.includes(channel.id) || (channel.parentId !== null && exempt.includes(channel.parentId)),
    }));
}

/** Whether the bot may change channel permissions here, which locking needs. */
export function botCanLock(guild: Guild): boolean {
  return guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles) ?? false;
}

export interface LockRequest {
  /** "all" covers every lockable channel the settings do not exempt. */
  channels: "all" | string[];
  actorId: string;
  reason: string | null;
  endsAt: Date | null;
}

export interface LockResult {
  changed: string[];
  failed: string[];
  /** Asked for but already locked, exempt, hidden from members or not a channel a lock covers. */
  skipped: string[];
}



function auditReason(ctx: Ctx, reason: string | null): string {
  const base = ctx.settings.labels.reasons.lockdown;
  return (reason ? `${base}: ${reason}` : base).slice(0, 512);
}

async function postNotice(ctx: Ctx, channel: GuildBasedChannel, locked: boolean, reason: string | null): Promise<void> {
  const { lockdown } = ctx.settings;
  if (!lockdown.notify || !channel.isTextBased()) return;
  const reasonNote = reason ? ` ${fillLabel(ctx.settings.labels.notes.reasonNote, { reason })}` : "";
  await ctx.send(channel, locked ? lockdown.lockedNotice : lockdown.unlockedNotice, { reason: reason ?? ctx.settings.labels.actions.noReason, reasonNote }, {
    fallback: locked ? LOCKDOWN_NOTICE : UNLOCK_NOTICE,
    mentions: { users: [], roles: [] },
  });
}

// One lock or unlock at a time per server. Overlapping ones (the join alert, a staff member, a command)
// would otherwise read an overwrite another had just denied and store that as the state to go back to.
const queues = new Map<string, Promise<unknown>>();

function serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(work, work);
  const settled = next.catch(() => undefined);
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return next;
}

/** Locks channels and remembers how to unlock them. Never throws for one channel; it is counted as failed. */
export function lockChannels(ctx: Ctx, request: LockRequest): Promise<LockResult> {
  return serialized(ctx.guild.id, () => lockChannelsNow(ctx, request));
}

async function lockChannelsNow(ctx: Ctx, request: LockRequest): Promise<LockResult> {
  const { guild } = ctx;
  const result: LockResult = { changed: [], failed: [], skipped: [] };
  const exempt = ctx.settings.lockdown.exemptChannels;
  const already = new Set((await prisma.lockedChannel.findMany({ where: { guildId: guild.id }, select: { channelId: true } })).map((row) => row.channelId));
  const lockable = lockableChannels(guild, exempt);
  const wanted =
    request.channels === "all"
      ? lockable.filter((channel) => !channel.exempt).map((channel) => channel.id)
      : [...new Set(request.channels)];
  const known = new Set(lockable.map((channel) => channel.id));
  const everyone = guild.roles.everyone.id;

  for (const id of wanted) {
    const channel = guild.channels.cache.get(id);
    if (!channel || !known.has(id) || already.has(id) || !("permissionOverwrites" in channel)) {
      result.skipped.push(id);
      continue;
    }
    const current = channel.permissionOverwrites.cache.get(everyone);
    const previous = previousOf(current ? { allow: current.allow.bitfield, deny: current.deny.bitfield } : null);
    // Stored before the change, so a crash between the two leaves a row that unlocking can still act on.
    // Only ever created: a row that exists holds the earliest state, and the overwrite now may already be the lock.
    try {
      await prisma.lockedChannel.create({
        data: { guildId: guild.id, channelId: id, previous: JSON.stringify(previous), lockedBy: request.actorId, reason: request.reason, endsAt: request.endsAt },
      });
    } catch {
      result.skipped.push(id);
      continue;
    }
    // Said before the lock, which also stops the bot posting there unless its role is allowed to.
    await postNotice(ctx, channel, true, request.reason);
    try {
      await channel.permissionOverwrites.edit(everyone, lockPatch(), { reason: auditReason(ctx, request.reason) });
      result.changed.push(id);
    } catch (error) {
      console.warn(`moderation: could not lock channel ${id} in guild ${guild.id}: ${describeDiscordError(error)}`);
      await prisma.lockedChannel.deleteMany({ where: { guildId: guild.id, channelId: id } });
      result.failed.push(id);
    }
  }

  if (request.endsAt && result.changed.length > 0) {
    await ctx.tasks.schedule("unlock", request.endsAt, { channels: result.changed, endsAt: request.endsAt.toISOString() });
  }
  return result;
}

/** Unlocks channels the bot locked, putting back what each said before. "all" is every channel it has locked. */
export function unlockChannels(ctx: Ctx, channels: "all" | string[], reason: string | null = null, onlyEndingAt: Date | null = null): Promise<LockResult> {
  return serialized(ctx.guild.id, () => unlockChannelsNow(ctx, channels, reason, onlyEndingAt));
}

async function unlockChannelsNow(ctx: Ctx, channels: "all" | string[], reason: string | null, onlyEndingAt: Date | null): Promise<LockResult> {
  const { guild } = ctx;
  const result: LockResult = { changed: [], failed: [], skipped: [] };
  const rows = await prisma.lockedChannel.findMany({
    where: { guildId: guild.id, ...(channels === "all" ? {} : { channelId: { in: channels } }), ...(onlyEndingAt ? { endsAt: onlyEndingAt } : {}) },
  });
  if (channels !== "all") {
    const found = new Set(rows.map((row) => row.channelId));
    result.skipped.push(...channels.filter((id) => !found.has(id)));
  }
  const everyone = guild.roles.everyone.id;

  for (const row of rows) {
    const channel = guild.channels.cache.get(row.channelId);
    const previous = readPrevious(row.previous);
    // A channel deleted while locked has nothing left to put back.
    if (!channel || !("permissionOverwrites" in channel) || !previous) {
      await prisma.lockedChannel.deleteMany({ where: { guildId: guild.id, channelId: row.channelId } });
      result.changed.push(row.channelId);
      continue;
    }
    try {
      const text = auditReason(ctx, reason);
      await channel.permissionOverwrites.edit(everyone, restorePatch(previous), { reason: text });
      const after = channel.permissionOverwrites.cache.get(everyone);
      if (shouldRemoveAfterRestore(previous, after ? { allow: after.allow.bitfield, deny: after.deny.bitfield } : null)) {
        await channel.permissionOverwrites.delete(everyone, text);
      }
      await prisma.lockedChannel.deleteMany({ where: { guildId: guild.id, channelId: row.channelId } });
      result.changed.push(row.channelId);
      await postNotice(ctx, channel, false, null);
    } catch (error) {
      console.warn(`moderation: could not unlock channel ${row.channelId} in guild ${guild.id}: ${describeDiscordError(error)}`);
      result.failed.push(row.channelId);
    }
  }
  return result;
}

/**
 * The scheduled end of a lockdown that was given a length. Only channels still
 * locked by that same lockdown are unlocked: one locked again since, with its
 * own length or none, is left as it is.
 */
export async function endScheduledLockdown(payload: TaskPayload, ctx: Ctx): Promise<void> {
  const channels = Array.isArray(payload.channels) ? payload.channels.filter((id): id is string => typeof id === "string") : [];
  const endsAt = typeof payload.endsAt === "string" ? new Date(payload.endsAt) : null;
  if (channels.length === 0 || !endsAt || Number.isNaN(endsAt.getTime())) return;
  await unlockChannels(ctx, channels, null, endsAt);
}
