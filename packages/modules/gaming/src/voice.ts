import {
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
  PermissionsBitField,
  type CategoryChannel,
  type Guild,
  type GuildChannelCreateOptions,
  type GuildMember,
  type OverwriteResolvable,
  type VoiceBasedChannel,
} from "discord.js";
import { applyVariables } from "@tier0/core";
import type { VoiceRoom } from "@tier0/db";
import { warn, type GamingCtx } from "./context.js";
import { bitrateFor, roomName } from "./naming.js";
import { grant, limitedTo, type Overwrite } from "./overwrites.js";
import { PARTY_HUB, forgetRoom, nextNumber, recordRoom, roomByChannel, roomOwnedBy, roomsOf, setOwner } from "./room-store.js";
import type { HubSetting } from "./settings.js";

/**
 * Join-to-create rooms: making one when a member joins a hub, handing it over,
 * and removing it once it is empty. The record in the database is what lets a
 * room be tidied up after the bot was offline while it emptied.
 */

/** A room younger than this is left alone by the sweep, since the member it was made for is still being moved in. */
export const GRACE_MS = 60_000;

/** A party's channel is made before anyone is in it, so it is given longer to fill. */
export const PARTY_GRACE_MS = 10 * 60_000;

const MANAGE = PermissionFlagsBits.ManageChannels | PermissionFlagsBits.MoveMembers | PermissionFlagsBits.MuteMembers | PermissionFlagsBits.DeafenMembers;
const OWNER_ALLOW = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect | PermissionFlagsBits.Speak | MANAGE;
const BOT_WANTS = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect | PermissionFlagsBits.ManageChannels | PermissionFlagsBits.MoveMembers;

const TYPE_ROLE = 0;
const TYPE_MEMBER = 1;

function inherited(parent: CategoryChannel | null): Overwrite[] {
  if (!parent) return [];
  return [...parent.permissionOverwrites.cache.values()].map((entry) => ({
    id: entry.id,
    type: entry.type === OverwriteType.Member ? TYPE_MEMBER : TYPE_ROLE,
    allow: entry.allow.bitfield,
    deny: entry.deny.bitfield,
  }));
}

const resolvable = (list: Overwrite[]): OverwriteResolvable[] =>
  list.map((entry) => ({ id: entry.id, type: entry.type === TYPE_MEMBER ? OverwriteType.Member : OverwriteType.Role, allow: entry.allow, deny: entry.deny }));

/**
 * The access to try when making a room, most generous first. Discord answers
 * Missing Permissions when an overwrite grants something the bot does not hold,
 * so the bot is only ever given what it has, and a refusal is retried with the
 * owner's management permissions left out and then with no extra access at all.
 */
export function overwriteSteps(guild: Guild, parent: CategoryChannel | null, ownerId: string): OverwriteResolvable[][] {
  const base = inherited(parent);
  const me = guild.members.me;
  const held = me?.permissions.bitfield ?? 0n;
  const build = (ownerAllow: bigint) => {
    const list = grant(base, ownerId, TYPE_MEMBER, limitedTo(ownerAllow, held));
    return me ? grant(list, me.id, TYPE_MEMBER, limitedTo(BOT_WANTS, held)) : list;
  };
  return [resolvable(build(OWNER_ALLOW)), resolvable(build(OWNER_ALLOW & ~MANAGE)), resolvable(base)];
}

function refusedForPermission(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: number }).code === 50013;
}

async function createChannel(ctx: GamingCtx, options: GuildChannelCreateOptions & { type: ChannelType.GuildVoice }, steps: OverwriteResolvable[][]) {
  let last: unknown;
  for (const permissionOverwrites of steps) {
    try {
      return await ctx.guild.channels.create({ ...options, permissionOverwrites });
    } catch (error) {
      last = error;
      if (!refusedForPermission(error)) break;
    }
  }
  throw last;
}

export interface NewRoomChannel {
  name: string;
  parent: CategoryChannel | null;
  ownerId: string;
  userLimit?: number;
  bitrate?: number | undefined;
  reason: string;
}

/** Makes the voice channel, giving its owner management of it as far as the bot is able to. */
export async function createRoomChannel(ctx: GamingCtx, room: NewRoomChannel): Promise<VoiceBasedChannel> {
  const channel = await createChannel(
    ctx,
    {
      name: room.name,
      type: ChannelType.GuildVoice,
      parent: room.parent?.id ?? null,
      ...(room.userLimit !== undefined ? { userLimit: room.userLimit } : {}),
      ...(room.bitrate ? { bitrate: room.bitrate } : {}),
      reason: room.reason,
    },
    overwriteSteps(ctx.guild, room.parent, room.ownerId),
  );
  return channel as VoiceBasedChannel;
}

const making = new Set<string>();

/** Makes a member a room from the hub they joined, and moves them in. Does nothing when they are no longer in the hub. */
export async function openRoom(ctx: GamingCtx, hub: HubSetting, member: GuildMember): Promise<void> {
  const key = `${ctx.guild.id}:${member.id}`;
  if (making.has(key)) return;
  making.add(key);
  try {
    const hubKey = hub.id ?? hub.channel;
    const existing = await roomOwnedBy(ctx.guild.id, member.id, hubKey);
    if (existing) {
      const room = ctx.guild.channels.cache.get(existing.channelId);
      if (room?.isVoiceBased()) {
        // One room each: joining the hub again takes the member back to theirs.
        await member.voice.setChannel(room).catch(warn(`move ${member.id} to their room`));
        return;
      }
      await forgetRoom(existing.channelId);
    }

    const hubChannel = ctx.guild.channels.cache.get(hub.channel);
    if (!hubChannel?.isVoiceBased() || member.voice.channelId !== hubChannel.id) return;
    const configured = hub.category ? ctx.guild.channels.cache.get(hub.category) : undefined;
    const parent = configured?.type === ChannelType.GuildCategory ? configured : hubChannel.parent;

    const number = await nextNumber(ctx.guild.id, hubKey);
    const name = roomName(hub.name, { user: member.displayName, username: member.user.username, number });
    const bitrate = bitrateFor(hub.bitrate, ctx.guild.maximumBitrate);
    const reason = applyVariables(ctx.settings.labels.roomReason, { user: member.displayName }).slice(0, 512);

    let channel: VoiceBasedChannel;
    try {
      channel = await createRoomChannel(ctx, { name, parent: parent ?? null, ownerId: member.id, userLimit: hub.userLimit, bitrate, reason });
    } catch (error) {
      warn(`make a room for ${member.id} in ${ctx.guild.name}`)(error);
      return;
    }

    await recordRoom({ guildId: ctx.guild.id, channelId: channel.id, hubId: hubKey, ownerId: member.id, number });
    try {
      await member.voice.setChannel(channel);
    } catch (error) {
      // The member left before they could be moved, or the bot cannot move them. Either way the room would sit empty.
      warn(`move ${member.id} into their room`)(error);
      await removeRoom(ctx, channel, ctx.settings.labels.emptyReason);
    }
  } finally {
    making.delete(key);
  }
}

/** Deletes a room's channel and forgets it. */
export async function removeRoom(ctx: GamingCtx, channel: VoiceBasedChannel, reason: string): Promise<void> {
  await channel.delete(reason).catch(warn(`delete room ${channel.id}`));
  await forgetRoom(channel.id);
}

const flagNames = (bits: bigint) => Object.fromEntries(new PermissionsBitField(bits).toArray().map((name) => [name, true]));

/**
 * Makes a member the room's owner. The record decides who may use the /room
 * commands, so a refusal from Discord when giving them the channel permissions
 * is logged and the handover still stands.
 */
export async function giveOwnership(ctx: GamingCtx, channel: VoiceBasedChannel, room: VoiceRoom, member: GuildMember): Promise<void> {
  const held = ctx.guild.members.me?.permissions.bitfield ?? 0n;
  const previous = room.ownerId;
  await setOwner(room.channelId, member.id);
  await channel.permissionOverwrites
    .edit(member, flagNames(limitedTo(OWNER_ALLOW, held)), { type: OverwriteType.Member })
    .catch(warn(`give ${member.id} the permissions of room ${channel.id}`));
  // The old owner can still join and talk, but no longer manages the room.
  if (previous !== member.id && previous !== ctx.client.user?.id) {
    await channel.permissionOverwrites
      .edit(previous, Object.fromEntries(new PermissionsBitField(MANAGE).toArray().map((name) => [name, null])), { type: OverwriteType.Member })
      .catch(warn(`reduce ${previous} in ${channel.id}`));
  }
}

/**
 * Looks at a room and does what it needs: deletes it when it is empty and has
 * been given time to fill, and, where the hub says so, passes it to someone
 * still in it when its owner has left.
 */
export async function tidyRoom(ctx: GamingCtx, room: VoiceRoom, graceMs: number): Promise<void> {
  const cached = ctx.guild.channels.cache.get(room.channelId);
  const channel = cached ?? (await ctx.guild.channels.fetch(room.channelId).catch(() => null));
  if (!channel?.isVoiceBased()) {
    await forgetRoom(room.channelId);
    return;
  }
  const people = [...channel.members.values()];
  if (people.length === 0) {
    if (Date.now() - room.createdAt.getTime() < graceMs) return;
    await removeRoom(ctx, channel, ctx.settings.labels.emptyReason);
    return;
  }
  if (channel.members.has(room.ownerId)) return;
  const hub = ctx.settings.voice.hubs.find((entry) => (entry.id ?? entry.channel) === room.hubId);
  if (hub?.ownerLeaves !== "transfer") return;
  const next = people.find((person) => !person.user.bot);
  if (next) await giveOwnership(ctx, channel, room, next);
}

/** The sweep over every room of the server, for rooms that emptied while the bot was away. */
export async function sweepRooms(ctx: GamingCtx): Promise<void> {
  for (const room of await roomsOf(ctx.guild.id)) {
    await tidyRoom(ctx, room, room.hubId === PARTY_HUB ? PARTY_GRACE_MS : GRACE_MS).catch(warn(`tidy room ${room.channelId}`));
  }
}

/** Whether a voice channel is one the bot made. */
export async function roomOf(ctx: GamingCtx, channelId: string): Promise<VoiceRoom | null> {
  return roomByChannel(ctx.guild.id, channelId);
}

export { PARTY_HUB };
