import { prisma, type VoiceRoom } from "@tier0/db";
import { lowestFree } from "./naming.js";

/**
 * The record of the voice rooms the bot made. A room exists in Discord and
 * here together, and the sweep reconciles the two when one outlives the other.
 */

/** The hub id a party's room carries, since it came from a post and not from a hub. */
export const PARTY_HUB = "lfg";

export async function roomByChannel(guildId: string, channelId: string): Promise<VoiceRoom | null> {
  const room = await prisma.voiceRoom.findUnique({ where: { channelId } });
  return room?.guildId === guildId ? room : null;
}

export function roomsOf(guildId: string): Promise<VoiceRoom[]> {
  return prisma.voiceRoom.findMany({ where: { guildId }, orderBy: { id: "asc" } });
}

export function roomOwnedBy(guildId: string, ownerId: string, hubId: string): Promise<VoiceRoom | null> {
  return prisma.voiceRoom.findFirst({ where: { guildId, ownerId, hubId }, orderBy: { id: "desc" } });
}

/** The number the next room of a hub takes: the lowest one no live room of that hub is using. */
export async function nextNumber(guildId: string, hubId: string): Promise<number> {
  const rooms = await prisma.voiceRoom.findMany({ where: { guildId, hubId }, select: { number: true } });
  return lowestFree(rooms.map((room) => room.number));
}

export function recordRoom(room: { guildId: string; channelId: string; hubId: string; ownerId: string; number: number }): Promise<VoiceRoom> {
  return prisma.voiceRoom.create({ data: room });
}

export function setOwner(channelId: string, ownerId: string): Promise<VoiceRoom> {
  return prisma.voiceRoom.update({ where: { channelId }, data: { ownerId } });
}

export async function forgetRoom(channelId: string): Promise<void> {
  await prisma.voiceRoom.deleteMany({ where: { channelId } });
}
