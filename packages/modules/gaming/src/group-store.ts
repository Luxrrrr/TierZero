import { prisma, type GroupPanelPost, type PlayGroup } from "@tier0/db";

/**
 * The record of the groups members started from a panel, and of where each
 * panel was posted. A group's voice channel is also a row in the voice room
 * table, under this hub id, so the channel permissions and the hand-over work
 * the same as for any other room. The group row is what ties it to a thread.
 */

/** The hub id a group's voice channel carries in the voice room table. */
export const GROUP_HUB = "group";

export interface NewGroup {
  guildId: string;
  panelId: string;
  optionId: string;
  ownerId: string;
  voiceChannelId: string;
  number: number;
  game?: string;
  isPrivate: boolean;
  joinBy: Date;
}

export function createGroup(group: NewGroup): Promise<PlayGroup> {
  return prisma.playGroup.create({ data: group });
}

export async function groupById(guildId: string, id: number): Promise<PlayGroup | null> {
  const group = await prisma.playGroup.findUnique({ where: { id } });
  return group?.guildId === guildId ? group : null;
}

export async function groupByVoice(guildId: string, voiceChannelId: string): Promise<PlayGroup | null> {
  const group = await prisma.playGroup.findUnique({ where: { voiceChannelId } });
  return group?.guildId === guildId ? group : null;
}

export function groupByThread(guildId: string, threadId: string): Promise<PlayGroup | null> {
  return prisma.playGroup.findFirst({ where: { guildId, threadId } });
}

/** The group a member runs, if any. A member runs one at a time. */
export function groupOfOwner(guildId: string, ownerId: string): Promise<PlayGroup | null> {
  return prisma.playGroup.findFirst({ where: { guildId, ownerId }, orderBy: { id: "desc" } });
}

export function groupsOf(guildId: string): Promise<PlayGroup[]> {
  return prisma.playGroup.findMany({ where: { guildId }, orderBy: { id: "asc" } });
}

/**
 * Moves a waiting group to active in one statement, so a member who is moved in
 * and seen joining at the same moment starts the thread once. True for the one
 * caller that made the change.
 */
export async function claimActive(id: number): Promise<boolean> {
  const changed = await prisma.playGroup.updateMany({ where: { id, status: "waiting" }, data: { status: "active" } });
  return changed.count === 1;
}

export function attachThread(id: number, threadId: string, controlsMessageId: string | null): Promise<PlayGroup> {
  return prisma.playGroup.update({ where: { id }, data: { threadId, controlsMessageId } });
}

export function setAnnouncement(id: number, announcementMessageId: string | null): Promise<PlayGroup> {
  return prisma.playGroup.update({ where: { id }, data: { announcementMessageId } });
}

export function setPrivate(id: number, isPrivate: boolean): Promise<PlayGroup> {
  return prisma.playGroup.update({ where: { id }, data: { isPrivate } });
}

export function setGame(id: number, game: string): Promise<PlayGroup> {
  return prisma.playGroup.update({ where: { id }, data: { game } });
}

export function setGroupOwner(id: number, ownerId: string): Promise<PlayGroup> {
  return prisma.playGroup.update({ where: { id }, data: { ownerId } });
}

export async function deleteGroup(id: number): Promise<void> {
  await prisma.playGroup.deleteMany({ where: { id } });
}

export function panelPostOf(guildId: string, panelId: string): Promise<GroupPanelPost | null> {
  return prisma.groupPanelPost.findUnique({ where: { guildId_panelId: { guildId, panelId } } });
}

export function savePanelPost(guildId: string, panelId: string, channelId: string, messageId: string): Promise<GroupPanelPost> {
  return prisma.groupPanelPost.upsert({
    where: { guildId_panelId: { guildId, panelId } },
    create: { guildId, panelId, channelId, messageId },
    update: { channelId, messageId },
  });
}

export async function forgetPanelPost(guildId: string, panelId: string): Promise<void> {
  await prisma.groupPanelPost.deleteMany({ where: { guildId, panelId } });
}
