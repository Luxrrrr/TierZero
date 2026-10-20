import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  OverwriteType,
  ThreadAutoArchiveDuration,
  UserSelectMenuBuilder,
  type CategoryChannel,
  type Guild,
  type GuildMember,
  type MessageActionRowComponentBuilder,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
  type PrivateThreadChannel,
  type VoiceBasedChannel,
} from "discord.js";
import { applyVariables, customId, type ReplyValues } from "@tier0/core";
import type { PlayGroup } from "@tier0/db";
import { answer, memberOf, warn, type Answerable, type GamingCtx } from "./context.js";
import { announces, cleanGame, countdown, pingRoleOf, groupName, joinDeadline, shouldEnd } from "./group-logic.js";
import {
  GROUP_HUB,
  attachThread,
  claimActive,
  createGroup,
  deleteGroup,
  groupById,
  groupByVoice,
  groupOfOwner,
  groupsOf,
  setAnnouncement,
} from "./group-store.js";
import { GROUP_ANNOUNCEMENT, GROUP_CLOSED, GROUP_CONTROLS, GROUP_REFUSALS, GROUP_REPLIES, type GroupRefusalKey, type GroupReplyKey } from "./messages.js";
import { bitrateFor } from "./naming.js";
import { forgetRoom, nextNumber, recordRoom } from "./room-store.js";
import type { GamingSettings, GroupOptionSetting, GroupPanelSetting } from "./settings.js";
import { createRoomChannel, removeRoom } from "./voice.js";

/**
 * Groups started from a panel. A member presses an option and the bot makes a
 * voice channel for them. Once they are in it, which they can reach by being
 * moved or by joining it within the time the owner set, a private thread is made
 * with the controls in it. When the voice channel has been empty for a minute
 * the group ends: the channel goes and the thread is archived.
 */

/** How long an empty group's voice channel is left before the group ends, so a dropped connection can come back. */
export const EMPTY_GRACE_MS = 60_000;

/** The reply a member was given while their voice channel waits for them, so it can be replaced when the group starts or lapses. */
const pending = new Map<number, Answerable>();

export const say = (ctx: GamingCtx, interaction: Answerable, key: GroupReplyKey, values: ReplyValues = {}) =>
  answer(ctx, interaction, ctx.settings.messages.groupReplies[key], GROUP_REPLIES[key], values);

export const refuse = (ctx: GamingCtx, interaction: Answerable, key: GroupRefusalKey, values: ReplyValues = {}) =>
  answer(ctx, interaction, ctx.settings.messages.groupRefusals[key], GROUP_REFUSALS[key], values);

const link = (channelId: string) => `<#${channelId}>`;

export function panelOf(settings: GamingSettings, panelId: string): GroupPanelSetting | undefined {
  return settings.groups.panels.find((panel) => panel.id === panelId);
}

export function optionOf(settings: GamingSettings, panelId: string, optionId: string): { panel: GroupPanelSetting; option: GroupOptionSetting } | null {
  const panel = panelOf(settings, panelId);
  const option = panel?.options.find((entry) => entry.id === optionId);
  return panel && option ? { panel, option } : null;
}

/** Where a group's voice channel goes: the option's category, else the panel's, else the panel channel's own. */
function parentFor(guild: Guild, panel: GroupPanelSetting, option: GroupOptionSetting): CategoryChannel | null {
  for (const id of [option.category, panel.category]) {
    const found = id ? guild.channels.cache.get(id) : undefined;
    if (found?.type === ChannelType.GuildCategory) return found;
  }
  const own = guild.channels.cache.get(panel.channel);
  return own?.parent?.type === ChannelType.GuildCategory ? own.parent : null;
}

/** Locks a voice channel to the people in it now and anyone permitted. */
export async function lockVoice(ctx: GamingCtx, channel: VoiceBasedChannel): Promise<void> {
  await channel.permissionOverwrites.edit(ctx.guild.roles.everyone, { Connect: false });
  await Promise.all([...channel.members.values()].map((inside) => channel.permissionOverwrites.edit(inside, { Connect: true }, { type: OverwriteType.Member })));
}

export async function unlockVoice(ctx: GamingCtx, channel: VoiceBasedChannel): Promise<void> {
  await channel.permissionOverwrites.edit(ctx.guild.roles.everyone, { Connect: null });
}

// -- the controls message ------------------------------------------------------------------------------------

export function controlValues(ctx: GamingCtx, group: PlayGroup, voice: VoiceBasedChannel, ownerName: string): ReplyValues {
  const found = optionOf(ctx.settings, group.panelId, group.optionId);
  const { labels } = ctx.settings.groups;
  return {
    group: voice.name,
    owner: ownerName,
    room: link(voice.id),
    mode: group.isPrivate ? labels.groupModePrivate : labels.groupModeOpen,
    limit: voice.userLimit > 0 ? String(voice.userLimit) : labels.groupNoLimit,
    option: found?.option.label ?? "",
    game: group.game,
  };
}

/** The buttons and menus under the controls message. Each one carries the group's id. */
export function controlRows(ctx: GamingCtx, group: PlayGroup): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const { labels } = ctx.settings.groups;
  const id = (name: string) => customId("gaming", name, String(group.id));
  const buttons = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(id("groupMode")).setLabel(group.isPrivate ? labels.groupMakeOpen : labels.groupMakePrivate).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(id("groupRename")).setLabel(labels.groupRename).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(id("groupGame")).setLabel(labels.groupGame).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(id("groupLimit")).setLabel(labels.groupLimit).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(id("groupClose")).setLabel(labels.groupClose).setStyle(ButtonStyle.Danger),
  );
  const menu = (name: string, placeholder: string) =>
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new UserSelectMenuBuilder().setCustomId(id(name)).setPlaceholder(placeholder).setMinValues(1).setMaxValues(name === "groupHandOver" ? 1 : 10),
    );
  return [buttons, menu("groupInvite", labels.groupInvite), menu("groupRemove", labels.groupRemove), menu("groupHandOver", labels.groupHandOver)];
}

async function threadOf(ctx: GamingCtx, group: PlayGroup): Promise<PrivateThreadChannel | null> {
  if (!group.threadId) return null;
  const found = ctx.guild.channels.cache.get(group.threadId) ?? (await ctx.guild.channels.fetch(group.threadId).catch(() => null));
  return found?.isThread() ? (found as PrivateThreadChannel) : null;
}

/** Rewrites the controls message and the announcement to match the group as it is now. */
export async function refreshControls(ctx: GamingCtx, group: PlayGroup, voice: VoiceBasedChannel): Promise<void> {
  await syncAnnouncement(ctx, group, voice);
  if (!group.threadId || !group.controlsMessageId) return;
  const thread = await threadOf(ctx, group);
  const message = thread ? await thread.messages.fetch(group.controlsMessageId).catch(() => null) : null;
  if (!message) return;
  const owner = ctx.guild.members.cache.get(group.ownerId) ?? (await ctx.guild.members.fetch(group.ownerId).catch(() => null));
  await ctx.edit(message, ctx.settings.messages.groupControls, controlValues(ctx, group, voice, owner?.displayName ?? group.ownerId), {
    fallback: GROUP_CONTROLS,
    rows: controlRows(ctx, group),
  });
}

// -- the announcement ----------------------------------------------------------------------------------------------

/** The Join and Leave buttons under an announcement. */
export function announcementRows(ctx: GamingCtx, group: PlayGroup): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const { labels } = ctx.settings.groups;
  const id = (name: string) => customId("gaming", name, String(group.id));
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(id("groupJoin")).setLabel(labels.groupJoin).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(id("groupLeave")).setLabel(labels.groupLeave).setStyle(ButtonStyle.Secondary),
    ),
  ];
}

/** How many places are left in a group's voice channel, or null when it has no limit. */
export const placesLeft = (voice: VoiceBasedChannel): number | null => (voice.userLimit > 0 ? Math.max(0, voice.userLimit - voice.members.size) : null);

function announcementValues(ctx: GamingCtx, group: PlayGroup, voice: VoiceBasedChannel, ownerName: string, ping: string): ReplyValues {
  const left = placesLeft(voice);
  return { ...controlValues(ctx, group, voice, ownerName), players: String(voice.members.size), spots: left === null ? ctx.settings.groups.labels.groupNoLimit : String(left), ping };
}

const announcing = new Map<number, Promise<void>>();

/**
 * Makes the announcement in the panel's channel match the group: posted while
 * the group is open and its option announces, kept up to date as people come and
 * go, and removed when the group is made private or ends. Runs one at a time
 * per group, since voice events arrive in bursts and a second post would
 * otherwise slip in beside the first.
 */
export function syncAnnouncement(ctx: GamingCtx, group: PlayGroup, voice: VoiceBasedChannel): Promise<void> {
  const previous = announcing.get(group.id) ?? Promise.resolve();
  const next: Promise<void> = previous
    .then(() => runAnnouncement(ctx, group.id, voice))
    .catch(warn(`announce group ${group.id}`))
    .finally(() => {
      if (announcing.get(group.id) === next) announcing.delete(group.id);
    });
  announcing.set(group.id, next);
  return next;
}

async function runAnnouncement(ctx: GamingCtx, groupId: number, voice: VoiceBasedChannel): Promise<void> {
  const group = await groupById(ctx.guild.id, groupId);
  if (!group) return;
  const found = optionOf(ctx.settings, group.panelId, group.optionId);
  const channel = found ? ctx.guild.channels.cache.get(found.panel.channel) : undefined;
  const existing = group.announcementMessageId && channel?.isTextBased() ? await channel.messages.fetch(group.announcementMessageId).catch(() => null) : null;

  if (!found || !channel?.isTextBased() || !announces(found.panel, found.option) || group.status !== "active" || group.isPrivate) {
    if (existing) await existing.delete().catch(() => undefined);
    if (group.announcementMessageId) await setAnnouncement(group.id, null);
    return;
  }

  const owner = ctx.guild.members.cache.get(group.ownerId) ?? (await ctx.guild.members.fetch(group.ownerId).catch(() => null));
  const ownerName = owner?.displayName ?? group.ownerId;
  const options = { fallback: GROUP_ANNOUNCEMENT, rows: announcementRows(ctx, group) };
  if (existing) {
    await ctx.edit(existing, ctx.settings.messages.groupAnnouncement, announcementValues(ctx, group, voice, ownerName, ""), options);
    return;
  }
  const role = pingRoleOf(found.panel, found.option);
  const posted = await ctx.send(channel, ctx.settings.messages.groupAnnouncement, announcementValues(ctx, group, voice, ownerName, role ? `<@&${role}>` : ""), {
    ...options,
    mentions: { users: [], roles: role ? [role] : [] },
  });
  await setAnnouncement(group.id, posted?.id ?? null);
}

async function removeAnnouncement(ctx: GamingCtx, group: PlayGroup): Promise<void> {
  if (!group.announcementMessageId) return;
  const found = optionOf(ctx.settings, group.panelId, group.optionId);
  const channel = found ? ctx.guild.channels.cache.get(found.panel.channel) : undefined;
  if (channel?.isTextBased()) await channel.messages.delete(group.announcementMessageId).catch(() => undefined);
}

// -- starting a group --------------------------------------------------------------------------------------------

/**
 * What a press on a panel's option does. `rest` is the panel's id and the
 * option's id. `typed` is the game the member gave in the form, when they were
 * asked, and otherwise the option's own game is used.
 */
export async function startGroup(ctx: GamingCtx, interaction: MessageComponentInteraction | ModalSubmitInteraction, rest: string, typed?: string): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const [panelId = "", optionId = ""] = rest.split(":");
  if (!ctx.settings.groups.enabled) return refuse(ctx, interaction, "disabled");
  const found = optionOf(ctx.settings, panelId, optionId);
  if (!found) return refuse(ctx, interaction, "optionGone");
  const { panel, option } = found;
  const member = await memberOf(ctx, interaction);
  if (!member) return refuse(ctx, interaction, "createFailed");

  const have = await groupOfOwner(ctx.guild.id, member.id);
  if (have) {
    if (ctx.guild.channels.cache.has(have.voiceChannelId)) return refuse(ctx, interaction, "alreadyHave", { room: link(have.voiceChannelId) });
    // Its voice channel is gone, so the record is a leftover.
    await deleteGroup(have.id);
    await forgetRoom(have.voiceChannelId);
  }

  const number = await nextNumber(ctx.guild.id, GROUP_HUB);
  const game = typed ?? cleanGame(option.game ?? "");
  const name = groupName(option.name, { user: member.displayName, username: member.user.username, game, number });
  const reason = applyVariables(ctx.settings.groups.labels.groupReason, { user: member.displayName }).slice(0, 512);

  let channel: VoiceBasedChannel;
  try {
    channel = await createRoomChannel(ctx, {
      name,
      parent: parentFor(ctx.guild, panel, option),
      ownerId: member.id,
      userLimit: option.userLimit,
      bitrate: bitrateFor(undefined, ctx.guild.maximumBitrate),
      reason,
    });
  } catch (error) {
    warn(`make a group's voice channel for ${member.id}`)(error);
    return refuse(ctx, interaction, "createFailed");
  }

  await recordRoom({ guildId: ctx.guild.id, channelId: channel.id, hubId: GROUP_HUB, ownerId: member.id, number });
  const group = await createGroup({
    guildId: ctx.guild.id,
    panelId: panel.id,
    optionId: option.id,
    ownerId: member.id,
    voiceChannelId: channel.id,
    number,
    game,
    isPrivate: option.privacy === "private",
    joinBy: joinDeadline(Date.now(), ctx.settings.groups.joinTime),
  });
  if (group.isPrivate) await lockVoice(ctx, channel).catch(warn(`lock group ${group.id}`));

  const values = { room: link(channel.id), group: name, option: option.label, game, deadline: countdown(group.joinBy) };

  if (member.voice.channelId) {
    const moved = await member.voice.setChannel(channel).then(
      () => true,
      (error: unknown) => {
        warn(`move ${member.id} into group ${group.id}`)(error);
        return false;
      },
    );
    if (moved) return activateGroup(ctx, group, member, interaction);
    await ctx.tasks.schedule("groupDeadline", group.joinBy, { groupId: group.id });
    pending.set(group.id, interaction);
    return refuse(ctx, interaction, "moveFailed", values);
  }

  await ctx.tasks.schedule("groupDeadline", group.joinBy, { groupId: group.id });
  pending.set(group.id, interaction);
  await say(ctx, interaction, "joinPrompt", values);
}

/** Tells whoever was waiting that their group is ready or lapsed. A reply they already have is removed first so the new one replaces it. */
async function replaceReply(group: PlayGroup, via: Answerable | undefined): Promise<Answerable | null> {
  const held = pending.get(group.id);
  pending.delete(group.id);
  const target = via ?? held ?? null;
  if (target && "replied" in target && target.replied) await target.deleteReply().catch(() => undefined);
  return target;
}

/**
 * Makes the group's thread and posts its controls, once the owner is in the
 * voice channel. Does nothing the second time it is called for a group.
 */
export async function activateGroup(ctx: GamingCtx, group: PlayGroup, owner: GuildMember, via?: Answerable): Promise<void> {
  if (!(await claimActive(group.id))) return;
  await ctx.tasks.cancel("groupDeadline", { groupId: group.id }).catch(warn("cancel the deadline"));
  const reply = await replaceReply(group, via);
  const found = optionOf(ctx.settings, group.panelId, group.optionId);
  const voice = ctx.guild.channels.cache.get(group.voiceChannelId);
  const parent = found ? ctx.guild.channels.cache.get(found.panel.channel) : undefined;

  const fail = async () => {
    await endGroup(ctx, group, ctx.settings.groups.labels.groupEndReason);
    if (reply) await refuse(ctx, reply, "threadFailed");
  };
  if (!voice?.isVoiceBased() || parent?.type !== ChannelType.GuildText) return fail();

  let thread: PrivateThreadChannel;
  try {
    thread = (await parent.threads.create({
      name: voice.name,
      type: ChannelType.PrivateThread,
      invitable: false,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: applyVariables(ctx.settings.groups.labels.groupReason, { user: owner.displayName }).slice(0, 512),
    })) as PrivateThreadChannel;
    await thread.members.add(owner.id);
  } catch (error) {
    warn(`make the thread of group ${group.id}`)(error);
    return fail();
  }

  const current = (await groupById(ctx.guild.id, group.id)) ?? group;
  const posted = await ctx.send(thread, ctx.settings.messages.groupControls, controlValues(ctx, current, voice, owner.displayName), {
    fallback: GROUP_CONTROLS,
    rows: controlRows(ctx, current),
  });
  const attached = await attachThread(group.id, thread.id, posted?.id ?? null);
  await syncAnnouncement(ctx, attached, voice);

  if (reply) await say(ctx, reply, "ready", { room: link(voice.id), thread: link(thread.id), group: voice.name, option: found?.option.label ?? "", game: group.game });
}

// -- the owner arriving, and the group ending -------------------------------------------------------------------------

/** A member joined a voice channel: if it is the one made for them, or they have one waiting, the group starts. */
export async function groupMemberJoined(ctx: GamingCtx, member: GuildMember, channelId: string): Promise<void> {
  const entered = await groupByVoice(ctx.guild.id, channelId);
  const room = entered?.status === "active" ? ctx.guild.channels.cache.get(channelId) : undefined;
  if (entered && room?.isVoiceBased()) {
    // A place was filled, or someone came back to an empty group, so its announcement and its end are looked at again.
    await ctx.tasks.cancel("groupTidy", { groupId: entered.id }).catch(warn("cancel the tidy"));
    await syncAnnouncement(ctx, entered, room);
  }
  const group = await groupOfOwner(ctx.guild.id, member.id);
  if (!group || group.status !== "waiting") return;
  if (channelId === group.voiceChannelId) return activateGroup(ctx, group, member);
  const voice = ctx.guild.channels.cache.get(group.voiceChannelId);
  if (voice?.isVoiceBased()) await member.voice.setChannel(voice).catch(warn(`move ${member.id} into group ${group.id}`));
}

/** Someone left a voice channel: if it was a group's and it is now empty, the end is queued after a minute. */
export async function groupMemberLeft(ctx: GamingCtx, channelId: string): Promise<void> {
  const group = await groupByVoice(ctx.guild.id, channelId);
  if (!group || group.status !== "active") return;
  const voice = ctx.guild.channels.cache.get(channelId);
  if (voice?.isVoiceBased()) await syncAnnouncement(ctx, group, voice);
  if (voice?.isVoiceBased() && voice.members.size > 0) return;
  await ctx.tasks.reschedule("groupTidy", new Date(Date.now() + EMPTY_GRACE_MS), { groupId: group.id });
}

/** Ends a group: its voice channel is deleted, its controls become the ended message and its thread is archived. */
export async function endGroup(ctx: GamingCtx, group: PlayGroup, reason: string): Promise<void> {
  const current = (await groupById(ctx.guild.id, group.id)) ?? group;
  await deleteGroup(current.id);
  await removeAnnouncement(ctx, current).catch(warn(`remove the announcement of group ${current.id}`));
  await ctx.tasks.cancel("groupDeadline", { groupId: current.id }).catch(warn("cancel the deadline"));
  await ctx.tasks.cancel("groupTidy", { groupId: current.id }).catch(warn("cancel the tidy"));
  pending.delete(current.id);

  const voice = ctx.guild.channels.cache.get(current.voiceChannelId) ?? (await ctx.guild.channels.fetch(current.voiceChannelId).catch(() => null));
  const name = voice?.name ?? "Group";
  if (voice?.isVoiceBased()) {
    // Whoever is still in the channel is taken out first, so deleting it never depends on it being empty.
    await Promise.all([...voice.members.values()].map((inside) => inside.voice.disconnect(reason).catch(warn(`disconnect ${inside.id} from group ${current.id}`))));
    await removeRoom(ctx, voice, reason);
  } else await forgetRoom(current.voiceChannelId);

  const thread = await threadOf(ctx, current);
  if (!thread) return;
  const owner = ctx.guild.members.cache.get(current.ownerId);
  if (current.controlsMessageId) {
    const message = await thread.messages.fetch(current.controlsMessageId).catch(() => null);
    if (message) {
      const values = { group: name, owner: owner?.displayName ?? current.ownerId, room: "", mode: "", limit: "", option: "", game: "" };
      await ctx.edit(message, ctx.settings.messages.groupClosed, values, { fallback: GROUP_CLOSED, rows: [] });
    }
  }
  await thread.setArchived(true, reason).catch(warn(`archive the thread of group ${current.id}`));
}

/** The owner did not arrive in time: the voice channel goes and they are told. */
export async function expireGroup(ctx: GamingCtx, group: PlayGroup): Promise<void> {
  const held = pending.get(group.id);
  const voice = ctx.guild.channels.cache.get(group.voiceChannelId);
  const name = voice?.name ?? "Group";
  const found = optionOf(ctx.settings, group.panelId, group.optionId);
  await endGroup(ctx, group, ctx.settings.groups.labels.groupEndReason);
  if (held) {
    if ("replied" in held && held.replied) await held.deleteReply().catch(() => undefined);
    await say(ctx, held, "expired", { group: name, option: found?.option.label ?? "", game: found?.option.game ?? "" });
  }
}

/** Looks at one group and ends it if it should be over: its owner never came, or its voice channel is empty or gone. */
export async function tidyGroup(ctx: GamingCtx, group: PlayGroup, now = Date.now()): Promise<void> {
  const fresh = await groupById(ctx.guild.id, group.id);
  if (!fresh) return;
  if (fresh.status === "waiting") {
    if (fresh.joinBy.getTime() <= now) await expireGroup(ctx, fresh);
    return;
  }
  const voice = ctx.guild.channels.cache.get(fresh.voiceChannelId) ?? (await ctx.guild.channels.fetch(fresh.voiceChannelId).catch(() => null));
  if (!voice?.isVoiceBased()) return endGroup(ctx, fresh, ctx.settings.groups.labels.groupEndReason);
  if (shouldEnd(fresh, voice.members.size, now, EMPTY_GRACE_MS)) await endGroup(ctx, fresh, ctx.settings.groups.labels.groupEndReason);
}

/** The sweep over every group of the server, for ones that ended while the bot was away. */
export async function sweepGroups(ctx: GamingCtx): Promise<void> {
  for (const group of await groupsOf(ctx.guild.id)) await tidyGroup(ctx, group).catch(warn(`tidy group ${group.id}`));
}
