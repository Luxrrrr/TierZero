import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type GuildMember,
  type ModalSubmitInteraction,
  type VoiceBasedChannel,
} from "discord.js";
import { customId, type ComponentHandler, type ModalHandler, type ReplyValues } from "@tier0/core";
import type { PlayGroup } from "@tier0/db";
import { answer, memberOf, mention, warn, type Answerable, type GamingCtx } from "./context.js";
import { GAME_MAX, cleanGame, mayManageGroup, renamedForGame } from "./group-logic.js";
import { groupById, setGame, setGroupOwner, setPrivate } from "./group-store.js";
import { endGroup, lockVoice, optionOf, placesLeft, refreshControls, refuse, say, unlockVoice } from "./groups.js";
import { ROOM_REFUSALS, ROOM_REPLIES, type RoomRefusalKey, type RoomReplyKey } from "./messages.js";
import { ROOM_NAME_MAX, sanitiseRoomName } from "./naming.js";
import { roomByChannel } from "./room-store.js";
import type { GamingSettings } from "./settings.js";
import { giveOwnership } from "./voice.js";

/**
 * The buttons, menus and forms in a group's thread. They do what /room does,
 * for the group's voice channel, and keep the thread in step: people invited
 * are added to both, people removed leave both. Only the person who started the
 * group and the people the server chose to manage groups may use them.
 */

/** How long a rename may take before the member is told it is waiting, since Discord limits renames to two in ten minutes. */
const RENAME_WAIT_MS = 2500;

const roomSay = (ctx: GamingCtx, interaction: Answerable, key: RoomReplyKey, values: ReplyValues = {}) =>
  answer(ctx, interaction, ctx.settings.messages.rooms[key], ROOM_REPLIES[key], values);

const roomRefuse = (ctx: GamingCtx, interaction: Answerable, key: RoomRefusalKey, values: ReplyValues = {}) =>
  answer(ctx, interaction, ctx.settings.messages.roomRefusals[key], ROOM_REFUSALS[key], values);

interface Scope {
  group: PlayGroup;
  voice: VoiceBasedChannel;
  member: GuildMember;
}

const idOf = (rest: string): number | null => {
  const id = Number(rest);
  return Number.isInteger(id) ? id : null;
};

const MANAGEMENT = PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageGuild | PermissionFlagsBits.Administrator;

/**
 * The group a control belongs to, its voice channel and the member using it,
 * once they are allowed to. Tells the member and answers null when not.
 */
async function scopeOf(ctx: GamingCtx, interaction: Answerable, rest: string): Promise<Scope | null> {
  const id = idOf(rest);
  const group = id === null ? null : await groupById(ctx.guild.id, id);
  if (!group || group.status !== "active") {
    await refuse(ctx, interaction, "groupGone");
    return null;
  }
  const voice = ctx.guild.channels.cache.get(group.voiceChannelId);
  if (!voice?.isVoiceBased()) {
    await refuse(ctx, interaction, "groupGone");
    return null;
  }
  const member = await memberOf(ctx, interaction);
  const allowed =
    member !== null &&
    mayManageGroup(group.ownerId, { id: member.id, roleIds: member.roles.cache.keys(), hasManagementPermission: member.permissions.has(MANAGEMENT) }, ctx.settings.groups.managerRoles);
  if (!member || !allowed) {
    await refuse(ctx, interaction, "notManager");
    return null;
  }
  return { group, voice, member };
}

const threadOfGroup = (ctx: GamingCtx, group: PlayGroup) => (group.threadId ? ctx.guild.channels.cache.get(group.threadId) : undefined);

/** A form with one short answer, read back as `value`. `rest` is carried in its id for the handler. */
export const modal = (name: string, rest: string, title: string, label: string, options: { value?: string; max: number; placeholder?: string; required?: boolean }) =>
  new ModalBuilder()
    .setCustomId(customId("gaming", name, rest))
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("value")
          .setLabel(label)
          .setStyle(TextInputStyle.Short)
          .setRequired(options.required ?? true)
          .setMaxLength(options.max)
          .setValue(options.value ?? "")
          .setPlaceholder(options.placeholder ?? ""),
      ),
    );

/**
 * Gives the voice channel and the thread a new name and rewrites the controls.
 * False when Discord's limit of two renames in ten minutes left the voice
 * channel's rename waiting, so the caller can say so instead of leaving the member hanging.
 */
async function renameGroup(ctx: GamingCtx, group: PlayGroup, voice: VoiceBasedChannel, name: string): Promise<boolean> {
  let done = true;
  if (name !== voice.name) {
    const renamed = voice.setName(name).then(() => true);
    done = await Promise.race([renamed, new Promise<false>((resolve) => setTimeout(() => resolve(false), RENAME_WAIT_MS))]);
    renamed.catch(warn(`rename group ${group.id}`));
    const thread = threadOfGroup(ctx, group);
    if (thread?.isThread()) void thread.setName(name).catch(warn(`rename the thread of group ${group.id}`));
  }
  await refreshControls(ctx, group, voice).catch(warn(`refresh the controls of group ${group.id}`));
  return done;
}

/** The active group an announcement belongs to, and its voice channel, or null after telling the member it is gone. */
async function announcedGroup(ctx: GamingCtx, interaction: Answerable, rest: string): Promise<{ group: PlayGroup; voice: VoiceBasedChannel } | null> {
  const id = idOf(rest);
  const group = id === null ? null : await groupById(ctx.guild.id, id);
  const voice = group ? ctx.guild.channels.cache.get(group.voiceChannelId) : undefined;
  if (!group || group.status !== "active" || !voice?.isVoiceBased()) {
    await refuse(ctx, interaction, "groupGone");
    return null;
  }
  return { group, voice };
}

export const groupComponents: Record<string, ComponentHandler<GamingSettings>> = {
  /** Adds the member to the thread and, if they are in a voice channel, moves them into the group's. */
  async groupJoin(interaction, { rest, ctx }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const found = await announcedGroup(ctx, interaction, rest);
    if (!found) return;
    const { group, voice } = found;
    const member = await memberOf(ctx, interaction);
    if (!member) return refuse(ctx, interaction, "groupGone");
    if (group.isPrivate) {
      const owner = ctx.guild.members.cache.get(group.ownerId);
      return refuse(ctx, interaction, "groupPrivate", { owner: owner?.displayName ?? mention(group.ownerId) });
    }
    const inside = voice.members.has(member.id);
    const left = placesLeft(voice);
    if (!inside && left === 0) return refuse(ctx, interaction, "groupFull", { group: voice.name });
    const thread = threadOfGroup(ctx, group);
    try {
      if (thread?.isThread()) await thread.members.add(member.id);
      if (member.voice.channelId && !inside) await member.voice.setChannel(voice).catch(warn(`move ${member.id} into group ${group.id}`));
    } catch (error) {
      warn(`add ${member.id} to group ${group.id}`)(error);
      return refuse(ctx, interaction, "createFailed");
    }
    const option = optionOf(ctx.settings, group.panelId, group.optionId)?.option;
    await say(ctx, interaction, "joinedGroup", {
      room: `<#${voice.id}>`,
      thread: thread ? `<#${thread.id}>` : "",
      group: voice.name,
      option: option?.label ?? "",
      game: group.game,
    });
  },

  /** Takes the member out of the thread, and out of the voice channel if they are in it. The owner stays. */
  async groupLeave(interaction, { rest, ctx }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const found = await announcedGroup(ctx, interaction, rest);
    if (!found) return;
    const { group, voice } = found;
    if (interaction.user.id === group.ownerId) return refuse(ctx, interaction, "ownerCannotLeave");
    const thread = threadOfGroup(ctx, group);
    if (thread?.isThread()) await thread.members.remove(interaction.user.id).catch(() => undefined);
    await voice.members.get(interaction.user.id)?.voice.disconnect().catch(() => undefined);
    await say(ctx, interaction, "leftGroup", { group: voice.name });
  },

  /** Locks the voice channel to the people in it and those invited, or opens it again. */
  async groupMode(interaction, { rest, ctx }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const scope = await scopeOf(ctx, interaction, rest);
    if (!scope) return;
    const { group, voice } = scope;
    try {
      if (group.isPrivate) await unlockVoice(ctx, voice);
      else await lockVoice(ctx, voice);
      const changed = await setPrivate(group.id, !group.isPrivate);
      await refreshControls(ctx, changed, voice);
      await roomSay(ctx, interaction, changed.isPrivate ? "locked" : "unlocked");
    } catch (error) {
      warn(`change who can join group ${group.id}`)(error);
      await roomRefuse(ctx, interaction, "changeFailed");
    }
  },

  async groupRename(interaction, { rest, ctx }) {
    const id = idOf(rest);
    const group = id === null ? null : await groupById(ctx.guild.id, id);
    const member = group ? await memberOf(ctx, interaction) : null;
    const voice = group ? ctx.guild.channels.cache.get(group.voiceChannelId) : undefined;
    const allowed =
      !!group &&
      member !== null &&
      mayManageGroup(group.ownerId, { id: member.id, roleIds: member.roles.cache.keys(), hasManagementPermission: member.permissions.has(MANAGEMENT) }, ctx.settings.groups.managerRoles);
    if (!group || !voice?.isVoiceBased() || !allowed) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return refuse(ctx, interaction, group ? "notManager" : "groupGone");
    }
    const { labels } = ctx.settings.groups;
    await interaction.showModal(modal("groupRename", String(group.id), labels.groupRenameTitle, labels.groupRenameLabel, { value: voice.name, max: ROOM_NAME_MAX }));
  },

  async groupGame(interaction, { rest, ctx }) {
    const id = idOf(rest);
    const group = id === null ? null : await groupById(ctx.guild.id, id);
    const member = group ? await memberOf(ctx, interaction) : null;
    const voice = group ? ctx.guild.channels.cache.get(group.voiceChannelId) : undefined;
    const allowed =
      !!group &&
      member !== null &&
      mayManageGroup(group.ownerId, { id: member.id, roleIds: member.roles.cache.keys(), hasManagementPermission: member.permissions.has(MANAGEMENT) }, ctx.settings.groups.managerRoles);
    if (!group || !voice?.isVoiceBased() || !allowed) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return refuse(ctx, interaction, group ? "notManager" : "groupGone");
    }
    const { labels } = ctx.settings.groups;
    await interaction.showModal(modal("groupGame", String(group.id), labels.groupGameTitle, labels.groupGameLabel, { value: group.game, max: GAME_MAX }));
  },

  async groupLimit(interaction, { rest, ctx }) {
    const id = idOf(rest);
    const group = id === null ? null : await groupById(ctx.guild.id, id);
    const member = group ? await memberOf(ctx, interaction) : null;
    const voice = group ? ctx.guild.channels.cache.get(group.voiceChannelId) : undefined;
    const allowed =
      !!group &&
      member !== null &&
      mayManageGroup(group.ownerId, { id: member.id, roleIds: member.roles.cache.keys(), hasManagementPermission: member.permissions.has(MANAGEMENT) }, ctx.settings.groups.managerRoles);
    if (!group || !voice?.isVoiceBased() || !allowed) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return refuse(ctx, interaction, group ? "notManager" : "groupGone");
    }
    const { labels } = ctx.settings.groups;
    await interaction.showModal(modal("groupLimit", String(group.id), labels.groupLimitTitle, labels.groupLimitLabel, { value: String(voice.userLimit), max: 2, placeholder: "0" }));
  },

  async groupClose(interaction, { rest, ctx }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const scope = await scopeOf(ctx, interaction, rest);
    if (!scope) return;
    await say(ctx, interaction, "ended", { group: scope.voice.name });
    await endGroup(ctx, scope.group, ctx.settings.groups.labels.groupEndReason);
  },

  /** Lets the picked people into the voice channel and the thread. */
  async groupInvite(interaction, { rest, ctx }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.isUserSelectMenu()) return;
    const scope = await scopeOf(ctx, interaction, rest);
    if (!scope) return;
    const { group, voice } = scope;
    const thread = threadOfGroup(ctx, group);
    const invited: string[] = [];
    for (const user of interaction.users.values()) {
      if (user.bot) continue;
      try {
        await voice.permissionOverwrites.edit(user.id, { ViewChannel: true, Connect: true }, { type: OverwriteType.Member });
        if (thread?.isThread()) await thread.members.add(user.id);
        invited.push(mention(user.id));
      } catch (error) {
        warn(`invite ${user.id} to group ${group.id}`)(error);
      }
    }
    if (invited.length === 0) return roomRefuse(ctx, interaction, "changeFailed");
    await roomSay(ctx, interaction, "permitted", { member: invited.join(" ") });
  },

  /** Takes the picked people out of the voice channel and the thread, and stops them coming back. */
  async groupRemove(interaction, { rest, ctx }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.isUserSelectMenu()) return;
    const scope = await scopeOf(ctx, interaction, rest);
    if (!scope) return;
    const { group, voice } = scope;
    const thread = threadOfGroup(ctx, group);
    const removed: string[] = [];
    for (const user of interaction.users.values()) {
      if (user.bot) continue;
      if (user.id === interaction.user.id || user.id === group.ownerId) {
        await roomRefuse(ctx, interaction, "notYourself");
        return;
      }
      try {
        await voice.permissionOverwrites.edit(user.id, { Connect: false }, { type: OverwriteType.Member });
        await voice.members.get(user.id)?.voice.disconnect();
        if (thread?.isThread()) await thread.members.remove(user.id).catch(() => undefined);
        removed.push(mention(user.id));
      } catch (error) {
        warn(`remove ${user.id} from group ${group.id}`)(error);
      }
    }
    if (removed.length === 0) return roomRefuse(ctx, interaction, "changeFailed");
    await roomSay(ctx, interaction, "kicked", { member: removed.join(" ") });
  },

  /** Gives the group to someone else. */
  async groupHandOver(interaction, { rest, ctx }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.isUserSelectMenu()) return;
    const scope = await scopeOf(ctx, interaction, rest);
    if (!scope) return;
    const { group, voice } = scope;
    const user = interaction.users.first();
    if (!user || user.bot || user.id === group.ownerId) return roomRefuse(ctx, interaction, "notYourself");
    const target = await ctx.guild.members.fetch(user.id).catch(() => null);
    const room = await roomByChannel(ctx.guild.id, voice.id);
    if (!target || !room) return roomRefuse(ctx, interaction, "changeFailed");
    try {
      await giveOwnership(ctx, voice, room, target);
      const thread = threadOfGroup(ctx, group);
      if (thread?.isThread()) await thread.members.add(target.id).catch(() => undefined);
      const changed = await setGroupOwner(group.id, target.id);
      await refreshControls(ctx, changed, voice);
      await roomSay(ctx, interaction, "transferred", { member: mention(target.id) });
    } catch (error) {
      warn(`hand group ${group.id} to ${target.id}`)(error);
      await roomRefuse(ctx, interaction, "changeFailed");
    }
  },
};

const textOf = (interaction: ModalSubmitInteraction): string => interaction.fields.getTextInputValue("value").trim();

export const groupModals: Record<string, ModalHandler<GamingSettings>> = {
  async groupRename(interaction, { rest, ctx }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const scope = await scopeOf(ctx, interaction, rest);
    if (!scope) return;
    const { group, voice } = scope;
    const name = sanitiseRoomName(textOf(interaction));
    const done = await renameGroup(ctx, group, voice, name);
    await roomSay(ctx, interaction, done ? "renamed" : "renameQueued", { name });
  },

  /** Changes what the group is playing, and the game in its name with it. */
  async groupGame(interaction, { rest, ctx }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const scope = await scopeOf(ctx, interaction, rest);
    if (!scope) return;
    const { group, voice } = scope;
    const game = cleanGame(textOf(interaction));
    if (game === "") return roomRefuse(ctx, interaction, "changeFailed");
    try {
      const changed = await setGame(group.id, game);
      const name = renamedForGame(voice.name, group.game, game);
      const done = await renameGroup(ctx, changed, voice, name);
      if (done) await say(ctx, interaction, "gameChanged", { game, group: name });
      else await roomSay(ctx, interaction, "renameQueued", { name });
    } catch (error) {
      warn(`change the game of group ${group.id}`)(error);
      await roomRefuse(ctx, interaction, "changeFailed");
    }
  },

  async groupLimit(interaction, { rest, ctx }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const scope = await scopeOf(ctx, interaction, rest);
    if (!scope) return;
    const { group, voice } = scope;
    const text = textOf(interaction);
    const count = Number(text);
    if (!/^\d{1,2}$/.test(text) || !Number.isInteger(count)) return roomRefuse(ctx, interaction, "changeFailed");
    try {
      await voice.setUserLimit(count);
      await refreshControls(ctx, group, voice);
      await (count === 0 ? roomSay(ctx, interaction, "limitCleared") : roomSay(ctx, interaction, "limitSet", { limit: count }));
    } catch (error) {
      warn(`set the limit of group ${group.id}`)(error);
      await roomRefuse(ctx, interaction, "changeFailed");
    }
  },
};
