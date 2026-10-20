import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type Message,
  type MessageActionRowComponentBuilder,
  type TextBasedChannel,
} from "discord.js";
import { applyVariables, customId, type ComponentHandler, type MessageBody, type ReplyValues } from "@tier0/core";
import { answer, memberOf, warn, type GamingCtx } from "./context.js";
import { endPost, joinPost, leavePost, overduePosts, postById, setPartyVoice, type PostWithMembers } from "./lfg-store.js";
import {
  LFG_CLOSED,
  LFG_EXPIRED,
  LFG_FULL,
  LFG_GO,
  LFG_STARTED,
  LFG_POST,
  LFG_READY,
  LFG_REFUSALS,
  LFG_REPLIES,
  type LfgRefusalKey,
  type LfgReplyKey,
} from "./messages.js";
import { ROOM_NAME_MAX, sanitiseRoomName } from "./naming.js";
import { PARTY_HUB, recordRoom } from "./room-store.js";
import type { GameSetting, GamingSettings } from "./settings.js";
import { lfgValues } from "./values.js";
import { createRoomChannel } from "./voice.js";

/**
 * Looking-for-group posts as they live in Discord: the message and its
 * buttons, what it becomes when the party fills, is closed or runs out of
 * time, and the voice channel a full party can be given.
 */

export function findGame(settings: GamingSettings, key: string): GameSetting | undefined {
  const games = settings.lfg.games;
  const wanted = key.trim().toLowerCase();
  return games.find((game) => game.id === key) ?? games.find((game) => game.name.toLowerCase() === wanted);
}

const gameKey = (game: GameSetting) => game.id ?? game.name;

export { gameKey };

export const postRows = (ctx: GamingCtx, post: PostWithMembers): ActionRowBuilder<MessageActionRowComponentBuilder>[] => {
  const { lfgJoin, lfgLeave, lfgStart, lfgClose } = ctx.settings.lfg.labels;
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(customId("gaming", "lfgJoin", String(post.id))).setLabel(lfgJoin).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(customId("gaming", "lfgLeave", String(post.id))).setLabel(lfgLeave).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(customId("gaming", "lfgStart", String(post.id))).setLabel(lfgStart).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(customId("gaming", "lfgClose", String(post.id))).setLabel(lfgClose).setStyle(ButtonStyle.Danger),
    ),
  ];
};

export function valuesOf(ctx: GamingCtx, post: PostWithMembers): ReplyValues {
  return lfgValues(post, findGame(ctx.settings, post.gameId), post.voiceChannelId);
}

/** What a post says for the state it is in, and whether it still carries buttons. */
function bodyFor(ctx: GamingCtx, status: string): { body: MessageBody; fallback: MessageBody; buttons: boolean } {
  const { messages } = ctx.settings;
  switch (status) {
    case "full":
      return { body: messages.lfgFull, fallback: LFG_FULL, buttons: false };
    case "started":
      return { body: messages.lfgStarted, fallback: LFG_STARTED, buttons: false };
    case "closed":
      return { body: messages.lfgClosed, fallback: LFG_CLOSED, buttons: false };
    case "expired":
      return { body: messages.lfgExpired, fallback: LFG_EXPIRED, buttons: false };
    default:
      return { body: messages.lfgPost, fallback: LFG_POST, buttons: true };
  }
}

export async function sendPost(ctx: GamingCtx, channel: TextBasedChannel, post: PostWithMembers): Promise<Message | null> {
  const game = findGame(ctx.settings, post.gameId);
  const { body, fallback } = bodyFor(ctx, "open");
  return ctx.send(channel, body, valuesOf(ctx, post), {
    fallback,
    rows: postRows(ctx, post),
    mentions: { users: [], roles: game?.role ? [game.role] : [] },
  });
}

async function messageOf(ctx: GamingCtx, post: PostWithMembers): Promise<Message | null> {
  if (!post.messageId) return null;
  const channel = ctx.guild.channels.cache.get(post.channelId) ?? (await ctx.guild.channels.fetch(post.channelId).catch(() => null));
  if (!channel?.isTextBased()) return null;
  return channel.messages.fetch(post.messageId).catch(() => null);
}

/** Rewrites a post's message to match the post: the party as it stands, or the state it ended in. */
export async function refreshPost(ctx: GamingCtx, post: PostWithMembers, known?: Message | null): Promise<void> {
  const message = known ?? (await messageOf(ctx, post));
  if (!message) return;
  const { body, fallback, buttons } = bodyFor(ctx, post.status);
  await ctx.edit(message, body, valuesOf(ctx, post), { fallback, rows: buttons ? postRows(ctx, post) : [] });
}

export async function scheduleExpiry(ctx: GamingCtx, post: PostWithMembers): Promise<void> {
  await ctx.tasks.schedule("lfgExpire", post.expiresAt, { postId: post.id });
}

/** Makes the full party a voice channel of its own, owned by the author. */
async function makePartyVoice(ctx: GamingCtx, post: PostWithMembers): Promise<string | null> {
  const { voiceCategory } = ctx.settings.lfg;
  const category = voiceCategory ? ctx.guild.channels.cache.get(voiceCategory) : undefined;
  const parent = category?.type === ChannelType.GuildCategory ? category : null;
  const name = sanitiseRoomName(applyVariables(ctx.settings.lfg.labels.partyRoomName, { game: post.gameName, author: post.authorName }).slice(0, ROOM_NAME_MAX));
  try {
    const channel = await createRoomChannel(ctx, { name, parent, ownerId: post.authorId, userLimit: post.needed + 1, reason: name });
    await recordRoom({ guildId: ctx.guild.id, channelId: channel.id, hubId: PARTY_HUB, ownerId: post.authorId, number: 0 });
    await setPartyVoice(post.id, channel.id);
    return channel.id;
  } catch (error) {
    warn(`make a voice channel for post ${post.id}`)(error);
    return null;
  }
}

/**
 * What follows the party being ready: the voice channel, the post's new state,
 * and the announcement. That is the last place being taken, or the author
 * starting the group early, which the post's status says.
 */
export async function partyFilled(ctx: GamingCtx, post: PostWithMembers, known?: Message | null): Promise<void> {
  await ctx.tasks.cancel("lfgExpire", { postId: post.id });
  let full = post;
  if (ctx.settings.lfg.createVoice) {
    const voice = await makePartyVoice(ctx, post);
    if (voice) full = { ...post, voiceChannelId: voice };
  }
  await refreshPost(ctx, full, known);
  if (!ctx.settings.lfg.pingParty) return;
  const channel = ctx.guild.channels.cache.get(post.channelId);
  if (!channel?.isTextBased()) return;
  const users = [post.authorId, ...post.members.map((member) => member.userId)];
  const started = post.status === "started";
  await ctx.send(channel, started ? ctx.settings.messages.lfgGo : ctx.settings.messages.lfgReady, valuesOf(ctx, full), { fallback: started ? LFG_GO : LFG_READY, mentions: { users, roles: [] } });
}

/** Ends a post nobody joined in time, or that is past its time. */
export async function expirePost(ctx: GamingCtx, id: number): Promise<void> {
  const post = await postById(ctx.guild.id, id);
  if (!post || !(await endPost(id, "expired"))) return;
  await refreshPost(ctx, { ...post, status: "expired" });
}

/** The sweep's share: posts whose scheduled expiry was lost still end. */
export async function expireOverdue(ctx: GamingCtx): Promise<void> {
  for (const post of await overduePosts(ctx.guild.id, new Date())) {
    if (await endPost(post.id, "expired")) await refreshPost(ctx, { ...post, status: "expired" }).catch(warn(`expire post ${post.id}`));
  }
}

const say = (ctx: GamingCtx, interaction: Parameters<ComponentHandler<GamingSettings>>[0], key: LfgReplyKey, values: ReplyValues = {}) =>
  answer(ctx, interaction, ctx.settings.messages.lfgReplies[key], LFG_REPLIES[key], values);

const refuse = (ctx: GamingCtx, interaction: Parameters<ComponentHandler<GamingSettings>>[0], key: LfgRefusalKey) =>
  answer(ctx, interaction, ctx.settings.messages.lfgRefusals[key], LFG_REFUSALS[key]);

const postIdOf = (rest: string) => {
  const id = Number(rest);
  return Number.isInteger(id) ? id : null;
};

const REFUSED: Record<string, LfgRefusalKey> = {
  gone: "ended",
  ended: "ended",
  full: "full",
  author: "isAuthor",
  already: "alreadyIn",
};

export const lfgComponents: Record<string, ComponentHandler<GamingSettings>> = {
  async lfgJoin(interaction, { rest, ctx }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const id = postIdOf(rest);
    const member = await memberOf(ctx, interaction);
    if (id === null || !member) return refuse(ctx, interaction, "ended");
    const joined = await joinPost(ctx.guild.id, id, { id: member.id, name: member.displayName });
    if (!joined.ok) return refuse(ctx, interaction, REFUSED[joined.code] ?? "ended");

    const { post } = joined;
    if (joined.filled) await partyFilled(ctx, post, interaction.message);
    else await refreshPost(ctx, post, interaction.message);
    await say(ctx, interaction, "joined", { author: `<@${post.authorId}>`, game: post.gameName, open: Math.max(0, post.needed - post.members.length) });
  },

  async lfgLeave(interaction, { rest, ctx }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const id = postIdOf(rest);
    if (id === null) return refuse(ctx, interaction, "ended");
    const left = await leavePost(ctx.guild.id, id, interaction.user.id);
    if (!left.ok) return refuse(ctx, interaction, left.code === "author" ? "authorCannotLeave" : left.code === "notIn" ? "notIn" : "ended");
    await refreshPost(ctx, left.post, interaction.message);
    await say(ctx, interaction, "left", { game: left.post.gameName });
  },

  /** Starts the group now, with whoever has joined, as if the party had filled. */
  async lfgStart(interaction, { rest, ctx }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const id = postIdOf(rest);
    const post = id === null ? null : await postById(ctx.guild.id, id);
    if (!post) return refuse(ctx, interaction, "ended");
    const moderator = interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) ?? false;
    if (interaction.user.id !== post.authorId && !moderator) return refuse(ctx, interaction, "notAuthor");
    if (!(await endPost(post.id, "started"))) return refuse(ctx, interaction, "ended");
    await partyFilled(ctx, { ...post, status: "started" }, interaction.message);
    await say(ctx, interaction, "startedByYou");
  },

  async lfgClose(interaction, { rest, ctx }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const id = postIdOf(rest);
    const post = id === null ? null : await postById(ctx.guild.id, id);
    if (!post) return refuse(ctx, interaction, "ended");
    const moderator = interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) ?? false;
    if (interaction.user.id !== post.authorId && !moderator) return refuse(ctx, interaction, "notAuthor");
    if (!(await endPost(post.id, "closed"))) return refuse(ctx, interaction, "ended");
    await ctx.tasks.cancel("lfgExpire", { postId: post.id });
    await refreshPost(ctx, { ...post, status: "closed" }, interaction.message);
    await say(ctx, interaction, "closedByYou");
  },
};
