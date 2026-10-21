import { prisma } from "@tier0/db";
import type { ModuleContext } from "@tier0/core";
import type { Message, TextBasedChannel } from "discord.js";
import type { Sticky, StickySettings } from "./settings.js";

type Ctx = ModuleContext<StickySettings>;

/** Posts for one channel run one at a time, so two quick triggers can't leave two stickies behind. */
const queues = new Map<string, Promise<unknown>>();

function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
  queues.set(key, run);
  void run.finally(() => {
    if (queues.get(key) === run) queues.delete(key);
  }).catch(() => {});
  return run;
}

const keyOf = (guildId: string, channelId: string) => `${guildId}:${channelId}`;

function textChannel(ctx: Ctx, channelId: string): (TextBasedChannel & { id: string }) | null {
  const channel = ctx.guild.channels.cache.get(channelId);
  return channel?.isTextBased() ? (channel as TextBasedChannel & { id: string }) : null;
}

async function takeAway(channel: TextBasedChannel, messageId: string): Promise<void> {
  await channel.messages.delete(messageId).catch(() => {});
}

/**
 * Puts the sticky at the bottom of its channel: the new message goes out first
 * and the old one is deleted after, so the channel is never without it.
 */
export function repost(ctx: Ctx, row: Sticky): Promise<boolean> {
  const channelId = row.channel;
  if (!channelId) return Promise.resolve(false);
  return serial(keyOf(ctx.guild.id, channelId), async () => {
    const channel = textChannel(ctx, channelId);
    if (!channel) return false;
    const before = await prisma.stickyPost.findUnique({ where: { guildId_channelId: { guildId: ctx.guild.id, channelId } } });
    const sent: Message | null = await ctx.send(channel, row.message, { channel: `<#${channelId}>` }, { mentions: { users: [], roles: [] } });
    if (!sent) return false;
    await prisma.stickyPost.upsert({
      where: { guildId_channelId: { guildId: ctx.guild.id, channelId } },
      create: { guildId: ctx.guild.id, channelId, messageId: sent.id },
      update: { messageId: sent.id },
    });
    if (before && before.messageId !== sent.id) await takeAway(channel, before.messageId);
    return true;
  });
}

/** Deletes the sticky in a channel, if there is one. Resolves to whether there was. */
export function remove(ctx: Ctx, channelId: string): Promise<boolean> {
  return serial(keyOf(ctx.guild.id, channelId), async () => {
    const before = await prisma.stickyPost.findUnique({ where: { guildId_channelId: { guildId: ctx.guild.id, channelId } } });
    if (!before) return false;
    await prisma.stickyPost.delete({ where: { guildId_channelId: { guildId: ctx.guild.id, channelId } } }).catch(() => {});
    const channel = textChannel(ctx, channelId);
    if (channel) await takeAway(channel, before.messageId);
    return true;
  });
}

/** Whether a channel currently has a sticky the bot posted. */
export async function isPosted(guildId: string, channelId: string): Promise<boolean> {
  return (await prisma.stickyPost.findUnique({ where: { guildId_channelId: { guildId, channelId } } })) !== null;
}

/** The channels in this server with a sticky posted. */
export async function postedChannels(guildId: string): Promise<string[]> {
  return (await prisma.stickyPost.findMany({ where: { guildId }, select: { channelId: true } })).map((post) => post.channelId);
}

export const live = (settings: StickySettings): Sticky[] => settings.stickies.filter((row) => row.enabled && row.channel);
