import {
  ChannelType,
  PermissionFlagsBits,
  type APIInteractionGuildMember,
  type GuildMember,
  type MessageComponentInteraction,
  type PermissionsBitField,
  type PrivateThreadChannel,
  type PublicThreadChannel,
  type RepliableInteraction,
  type TextChannel,
  type User,
} from "discord.js";
import {
  type MessageBody,
  type ModuleContext,
  type ReplyValues,
} from "@tier0/core";
import {
  canTicket,
  ticketAccess,
  type TicketAccess,
  type TicketAccessTarget,
  type TicketActor,
  type TicketPermission,
} from "@tier0/shared-tickets";
import type { Ticket } from "@tier0/db";
import { REPLIES, type ReplyKey } from "./messages.js";
import { accessSettingsOf } from "./resolve.js";
import type { TicketSettings } from "./settings.js";

export type TicketCtx = ModuleContext<TicketSettings>;

/** The channel or private thread a ticket lives in. */
export type TicketChannel = TextChannel | PublicThreadChannel | PrivateThreadChannel;

export type Answerable = RepliableInteraction | MessageComponentInteraction;

export function memberRoleIds(member: GuildMember | APIInteractionGuildMember | null | undefined): string[] {
  if (!member) return [];
  return "cache" in member.roles ? [...member.roles.cache.keys()] : member.roles;
}

/** Someone acting in Discord, as an interaction or a message presents them. */
export interface DiscordPerson {
  user: User;
  member: GuildMember | APIInteractionGuildMember | null;
  memberPermissions: Readonly<PermissionsBitField> | null;
}

/**
 * Where a member stands with a server's tickets in Discord, by the same rule
 * the dashboard uses: Manage Server makes a manager, and Manage Channels, which
 * has always been enough to work any ticket, works every type like an admin
 * role.
 */
export function accessOf(settings: TicketSettings, person: DiscordPerson): TicketAccess {
  const permissions = person.memberPermissions;
  const isManager = permissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
  const worksEveryType = permissions?.has(PermissionFlagsBits.ManageChannels) ?? false;
  return ticketAccess({ userId: person.user.id, isManager, worksEveryType, roleIds: memberRoleIds(person.member) }, accessSettingsOf(settings));
}

export function targetOf(ticket: Ticket): TicketAccessTarget {
  return { typeId: ticket.typeId, status: ticket.status, archived: ticket.archived, claimedById: ticket.claimedById };
}

export function may(settings: TicketSettings, person: DiscordPerson, permission: TicketPermission, ticket: Ticket): boolean {
  return canTicket(accessOf(settings, person), permission, targetOf(ticket));
}

/** Staff of this ticket's type: a handler, an admin role or someone with Manage Channels. */
export function isStaffOf(settings: TicketSettings, person: DiscordPerson, ticket: Ticket): boolean {
  return may(settings, person, "view", ticket);
}

/** Staff of any type, for what is not about one ticket. */
export function isAnyStaff(settings: TicketSettings, person: DiscordPerson): boolean {
  return accessOf(settings, person).level !== null;
}

export function displayName(user: User, member?: GuildMember | APIInteractionGuildMember | null): string {
  const nick = member && "displayName" in member ? member.displayName : (member?.nick ?? null);
  return nick || user.globalName || user.username;
}

export function actorOf(user: User, member?: GuildMember | APIInteractionGuildMember | null): TicketActor {
  return { userId: user.id, name: displayName(user, member), avatarUrl: user.displayAvatarURL() };
}

export function repliesOf(settings: TicketSettings): Record<ReplyKey, MessageBody> {
  const { refusals, opening, working, panel } = settings.messages;
  return { ...refusals, ...opening, ...working, ...panel, blocked: settings.general.blocklist.message };
}

/** Tells one person why something did not happen, in the server's own words. */
export async function refuse(ctx: TicketCtx, interaction: Answerable, key: ReplyKey, values: ReplyValues = {}): Promise<void> {
  await ctx.reply(interaction, repliesOf(ctx.settings)[key], values, { fallback: REPLIES[key].starting });
}

/** The ticket's channel or thread, fetched when it is not cached, as an archived thread usually is not. */
export async function channelOf(ctx: TicketCtx, channelId: string): Promise<TicketChannel | null> {
  const cached = ctx.guild.channels.cache.get(channelId);
  const channel = cached ?? (await ctx.guild.channels.fetch(channelId).catch(() => null));
  if (!channel) return null;
  if (channel.type === ChannelType.GuildText) return channel;
  if (channel.type === ChannelType.PrivateThread || channel.type === ChannelType.PublicThread) return channel;
  return null;
}

export function isThread(channel: TicketChannel): channel is PublicThreadChannel | PrivateThreadChannel {
  return channel.type !== ChannelType.GuildText;
}
