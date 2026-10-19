import {
  MessageFlags,
  InteractionContextType,
  OverwriteType,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type VoiceBasedChannel,
} from "discord.js";
import type { CommandDefinition, ReplyValues } from "@tier0/core";
import type { VoiceRoom } from "@tier0/db";
import { answer, hasAnyRole, memberOf, mention, warn, type GamingCtx } from "./context.js";
import { ROOM_REFUSALS, ROOM_REPLIES, type RoomRefusalKey, type RoomReplyKey } from "./messages.js";
import { ROOM_NAME_MAX, sanitiseRoomName } from "./naming.js";
import { roomByChannel } from "./room-store.js";
import type { GamingSettings } from "./settings.js";
import { giveOwnership } from "./voice.js";

/**
 * `/room`: the owner of a join-to-create room changes it from Discord. The
 * owner is whoever the database says, not whoever holds the permissions on the
 * channel, so a room keeps working when the bot could not grant them.
 */

/** How long a rename may take before the member is told it is waiting, since Discord limits renames to two in ten minutes. */
const RENAME_WAIT_MS = 2500;

function build(): SlashCommandBuilder {
  const builder = new SlashCommandBuilder().setName("room").setDescription("Manage your voice room.").setContexts(InteractionContextType.Guild);
  builder
    .addSubcommand((sub) =>
      sub
        .setName("rename")
        .setDescription("Rename your room.")
        .addStringOption((option) => option.setName("name").setDescription("The new name.").setRequired(true).setMaxLength(ROOM_NAME_MAX)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("limit")
        .setDescription("Set how many people can be in your room.")
        .addIntegerOption((option) => option.setName("count").setDescription("The most people. 0 removes the limit.").setRequired(true).setMinValue(0).setMaxValue(99)),
    )
    .addSubcommand((sub) => sub.setName("lock").setDescription("Stop new people joining your room."))
    .addSubcommand((sub) => sub.setName("unlock").setDescription("Let anyone join your room again."))
    .addSubcommand((sub) =>
      sub
        .setName("permit")
        .setDescription("Let someone join your room, even when it is locked.")
        .addUserOption((option) => option.setName("member").setDescription("Who to let in.").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("kick")
        .setDescription("Remove someone from your room and stop them rejoining.")
        .addUserOption((option) => option.setName("member").setDescription("Who to remove.").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("transfer")
        .setDescription("Hand your room to someone in it.")
        .addUserOption((option) => option.setName("member").setDescription("The new owner.").setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName("claim").setDescription("Take over a room whose owner has left."));
  return builder;
}

interface Place {
  room: VoiceRoom;
  channel: VoiceBasedChannel;
}

const say = (ctx: GamingCtx, interaction: ChatInputCommandInteraction, key: RoomReplyKey, values: ReplyValues = {}) =>
  answer(ctx, interaction, ctx.settings.messages.rooms[key], ROOM_REPLIES[key], values);

const refuse = (ctx: GamingCtx, interaction: ChatInputCommandInteraction, key: RoomRefusalKey, values: ReplyValues = {}) =>
  answer(ctx, interaction, ctx.settings.messages.roomRefusals[key], ROOM_REFUSALS[key], values);

/** The room the command is about: the one the member is in, else the one whose text chat it was typed in. */
async function placeOf(ctx: GamingCtx, member: GuildMember, interaction: ChatInputCommandInteraction): Promise<Place | null> {
  for (const id of [member.voice.channelId, interaction.channelId]) {
    if (!id) continue;
    const room = await roomByChannel(ctx.guild.id, id);
    const channel = room ? ctx.guild.channels.cache.get(room.channelId) : undefined;
    if (room && channel?.isVoiceBased()) return { room, channel };
  }
  return null;
}

const mayManage = (ctx: GamingCtx, member: GuildMember, room: VoiceRoom) =>
  room.ownerId === member.id || hasAnyRole(member, ctx.settings.voice.managerRoles);

async function target(ctx: GamingCtx, interaction: ChatInputCommandInteraction, place: Place): Promise<GuildMember | null> {
  const user = interaction.options.getUser("member", true);
  if (user.bot || user.id === interaction.user.id) {
    await refuse(ctx, interaction, "notYourself");
    return null;
  }
  const member = place.channel.members.get(user.id);
  if (!member) {
    await refuse(ctx, interaction, "memberNotInRoom", { member: mention(user.id) });
    return null;
  }
  return member;
}

async function run(interaction: ChatInputCommandInteraction, ctx: GamingCtx): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const member = await memberOf(ctx, interaction);
  const place = member ? await placeOf(ctx, member, interaction) : null;
  if (!member || !place) return refuse(ctx, interaction, "notInRoom");
  const { room, channel } = place;
  const sub = interaction.options.getSubcommand();
  const failed = () => refuse(ctx, interaction, "changeFailed");

  if (sub === "claim") {
    if (member.voice.channelId !== channel.id) return refuse(ctx, interaction, "notInRoom");
    const hub = ctx.settings.voice.hubs.find((entry) => (entry.id ?? entry.channel) === room.hubId);
    const owner = { owner: mention(room.ownerId) };
    if (channel.members.has(room.ownerId)) return refuse(ctx, interaction, "ownerStillHere", owner);
    // A party's room has no hub, and the author of its post is gone like any other owner.
    if (hub?.ownerLeaves === "keep") return refuse(ctx, interaction, "claimOff", owner);
    await giveOwnership(ctx, channel, room, member);
    return say(ctx, interaction, "claimed");
  }

  if (!mayManage(ctx, member, room)) return refuse(ctx, interaction, "notOwner", { owner: mention(room.ownerId) });

  try {
    switch (sub) {
      case "rename": {
        const name = sanitiseRoomName(interaction.options.getString("name", true));
        const renamed = channel.setName(name).then(() => true);
        // A rename past Discord's limit waits in the library's queue, so the member is told rather than left hanging.
        const done = await Promise.race([renamed, new Promise<false>((resolve) => setTimeout(() => resolve(false), RENAME_WAIT_MS))]);
        renamed.catch(warn(`rename room ${channel.id}`));
        return say(ctx, interaction, done ? "renamed" : "renameQueued", { name });
      }
      case "limit": {
        const count = interaction.options.getInteger("count", true);
        await channel.setUserLimit(count);
        return count === 0 ? say(ctx, interaction, "limitCleared") : say(ctx, interaction, "limitSet", { limit: count });
      }
      case "lock": {
        await channel.permissionOverwrites.edit(ctx.guild.roles.everyone, { Connect: false });
        // Whoever is in the room now can come back after a dropped connection.
        await Promise.all([...channel.members.values()].map((inside) => channel.permissionOverwrites.edit(inside, { Connect: true }, { type: OverwriteType.Member })));
        return say(ctx, interaction, "locked");
      }
      case "unlock":
        await channel.permissionOverwrites.edit(ctx.guild.roles.everyone, { Connect: null });
        return say(ctx, interaction, "unlocked");
      case "permit": {
        const user = interaction.options.getUser("member", true);
        await channel.permissionOverwrites.edit(user.id, { ViewChannel: true, Connect: true }, { type: OverwriteType.Member });
        return say(ctx, interaction, "permitted", { member: mention(user.id) });
      }
      case "kick": {
        const who = await target(ctx, interaction, place);
        if (!who) return;
        await channel.permissionOverwrites.edit(who.id, { Connect: false }, { type: OverwriteType.Member });
        await who.voice.disconnect();
        return say(ctx, interaction, "kicked", { member: mention(who.id) });
      }
      case "transfer": {
        const who = await target(ctx, interaction, place);
        if (!who) return;
        await giveOwnership(ctx, channel, room, who);
        return say(ctx, interaction, "transferred", { member: mention(who.id) });
      }
    }
  } catch (error) {
    warn(`change room ${channel.id}`)(error);
    return failed();
  }
}

export const roomCommand: CommandDefinition<GamingSettings> = {
  name: "room",
  description: "Manage your voice room.",
  build,
  run,
};
