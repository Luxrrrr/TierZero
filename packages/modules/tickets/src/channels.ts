import {
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
  PermissionsBitField,
  type OverwriteResolvable,
  type PrivateThreadChannel,
  type PublicThreadChannel,
  type TextChannel,
} from "discord.js";
import type { Ticket } from "@tier0/db";
import { isThread, type TicketChannel, type TicketCtx } from "./context.js";
import { priorityLabel, topicOf } from "./labels.js";
import type { TicketType } from "./panels.js";
import { chooseCategory, type CategoryChoice, type CategoryFacts } from "./records.js";
import { channelRolesOf, staffRolesOf } from "./resolve.js";

/**
 * What the module changes on a ticket's channel or thread: who may see and
 * write in it, which category it sits in, and its topic. Discord refusing one
 * of these is logged, not thrown, because the ticket itself has already
 * changed by the time the channel catches up.
 */

const MEMBER_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];
const STAFF_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ManageMessages,
];
const OBSERVER_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];
/**
 * What the bot gives itself in the channel. Discord refuses to create a
 * channel whose overwrites grant a permission the bot does not hold, so only
 * the ones it has are asked for.
 */
const BOT_WANTS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.ManageMessages,
];

const warn = (what: string) => (error: unknown) => console.warn(`[tickets] could not ${what}:`, error);

/**
 * Roles whose members work every ticket by permission: Manage Server or
 * Manage Channels. Discord would still hide a ticket channel from them, since
 * neither permission sees past a denied View Channel, so they are let in like
 * staff. Administrator sees everything anyway, and a bot's own role is left out.
 */
export function managerRoleIds(ctx: TicketCtx): string[] {
  const everyone = ctx.guild.roles.everyone.id;
  return [...ctx.guild.roles.cache.values()]
    .filter(
      (role) =>
        role.id !== everyone &&
        !role.managed &&
        !role.permissions.has(PermissionFlagsBits.Administrator) &&
        (role.permissions.has(PermissionFlagsBits.ManageGuild) || role.permissions.has(PermissionFlagsBits.ManageChannels)),
    )
    .map((role) => role.id);
}

/** Everyone denied; the opener, the type's staff and observers, members who manage the server, and the bot let back in. */
export function overwritesFor(ctx: TicketCtx, type: TicketType, openerId: string): OverwriteResolvable[] {
  const staff = new Set(staffRolesOf(ctx.settings, type));
  const roles = channelRolesOf(ctx.settings, type);
  const managers = managerRoleIds(ctx).filter((roleId) => !roles.includes(roleId));
  const overwrites: OverwriteResolvable[] = [
    { id: ctx.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: openerId, type: OverwriteType.Member, allow: MEMBER_ALLOW },
    ...roles.map((roleId) => ({
      id: roleId,
      type: OverwriteType.Role,
      allow: staff.has(roleId) ? STAFF_ALLOW : OBSERVER_ALLOW,
    })),
    ...managers.map((roleId) => ({ id: roleId, type: OverwriteType.Role, allow: STAFF_ALLOW })),
  ];
  const me = ctx.guild.members.me;
  if (me) {
    const allow = BOT_WANTS.filter((flag) => me.permissions.has(flag));
    overwrites.push({ id: me.id, type: OverwriteType.Member, allow });
  }
  return overwrites;
}

const MANAGE_PERMISSIONS =
  PermissionFlagsBits.ManageMessages |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.ManageWebhooks;
const EXTRA_PERMISSIONS = PermissionFlagsBits.AttachFiles | PermissionFlagsBits.EmbedLinks;

function stripped(overwrites: OverwriteResolvable[], bits: bigint): OverwriteResolvable[] {
  return overwrites.map((entry) =>
    entry.allow === undefined ? entry : { ...entry, allow: new PermissionsBitField(entry.allow).remove(bits).bitfield },
  );
}

/**
 * The overwrites to try when creating a ticket channel, most generous first.
 * Discord answers Missing Permissions when an overwrite grants something it
 * will not let the bot hand out, and which permission trips it depends on the
 * server, so a refusal is retried with the management permissions left out and
 * then with only what is needed to see and write in the channel.
 */
export function overwriteSteps(ctx: TicketCtx, type: TicketType, openerId: string): OverwriteResolvable[][] {
  const full = overwritesFor(ctx, type, openerId);
  const withoutManage = stripped(full, MANAGE_PERMISSIONS);
  return [full, withoutManage, stripped(withoutManage, EXTRA_PERMISSIONS)];
}

function categoryFacts(ctx: TicketCtx, id: string | undefined): CategoryFacts | null {
  if (!id) return null;
  const channel = ctx.guild.channels.cache.get(id);
  const exists = channel?.type === ChannelType.GuildCategory;
  return { id, exists, children: exists ? ctx.guild.channels.cache.filter((c) => c.parentId === id).size : 0 };
}

/** The category a channel of this type goes in now. */
export function categoryFor(ctx: TicketCtx, type: TicketType): CategoryChoice {
  return chooseCategory(categoryFacts(ctx, type.opening.category), categoryFacts(ctx, type.opening.overflowCategory));
}

/** The channel topic, which shows who opened it, the subject, the type and the priority. */
export function topicFor(
  ctx: TicketCtx,
  ticket: Pick<Ticket, "openerName" | "openerId" | "subject" | "typeName" | "priority">,
  tag?: string,
): string {
  const name = ticket.openerName || ticket.openerId;
  return topicOf(ctx.settings.labels, tag ?? name, name, ticket.subject, {
    type: ticket.typeName,
    priority: priorityLabel(ctx.settings.labels, ticket.priority),
  });
}

/**
 * Discord allows a channel's name and topic to change twice in ten minutes and
 * makes the third change wait, so the topic is updated without waiting on it.
 */
export function refreshTopic(ctx: TicketCtx, channel: TicketChannel, ticket: Ticket): void {
  if (isThread(channel)) return;
  void channel.setTopic(topicFor(ctx, ticket)).catch(warn(`update the topic of ${channel.id}`));
}

export async function addMember(channel: TicketChannel, userId: string): Promise<boolean> {
  if (isThread(channel)) {
    return channel.members.add(userId).then(
      () => true,
      () => false,
    );
  }
  return channel.permissionOverwrites
    .edit(userId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true }, { type: OverwriteType.Member })
    .then(
      () => true,
      () => false,
    );
}

export async function removeMember(channel: TicketChannel, userId: string): Promise<void> {
  if (isThread(channel)) await channel.members.remove(userId).catch(warn(`remove ${userId} from ${channel.id}`));
  else await channel.permissionOverwrites.delete(userId).catch(warn(`remove ${userId} from ${channel.id}`));
}

/** Members given their own access to the channel: the opener and anyone added. The bot is left out. */
export function memberIdsIn(ctx: TicketCtx, channel: TicketChannel): string[] {
  const me = ctx.client.user?.id;
  if (isThread(channel)) return [...channel.members.cache.keys()].filter((id) => id !== me);
  return [...channel.permissionOverwrites.cache.values()].filter((o) => o.type === OverwriteType.Member && o.id !== me).map((o) => o.id);
}

/** Swaps the roles of one type's staff and observers for another's. */
export async function swapRoles(ctx: TicketCtx, channel: TextChannel, from: TicketType | undefined, to: TicketType): Promise<void> {
  const next = new Set(channelRolesOf(ctx.settings, to));
  const staff = new Set(staffRolesOf(ctx.settings, to));
  const previous = from ? channelRolesOf(ctx.settings, from) : [];
  for (const roleId of previous) {
    if (!next.has(roleId)) await channel.permissionOverwrites.delete(roleId).catch(warn(`remove role ${roleId} from ${channel.id}`));
  }
  for (const roleId of next) {
    const allow = staff.has(roleId) ? STAFF_ALLOW : OBSERVER_ALLOW;
    const options = Object.fromEntries(allow.map((flag) => [permissionName(flag), true]));
    await channel.permissionOverwrites.edit(roleId, options, { type: OverwriteType.Role }).catch(warn(`add role ${roleId} to ${channel.id}`));
  }
}

const NAMES: [bigint, string][] = [
  [PermissionFlagsBits.ViewChannel, "ViewChannel"],
  [PermissionFlagsBits.SendMessages, "SendMessages"],
  [PermissionFlagsBits.ReadMessageHistory, "ReadMessageHistory"],
  [PermissionFlagsBits.AttachFiles, "AttachFiles"],
  [PermissionFlagsBits.EmbedLinks, "EmbedLinks"],
  [PermissionFlagsBits.ManageMessages, "ManageMessages"],
];
const permissionName = (flag: bigint) => NAMES.find(([value]) => value === flag)?.[1] ?? "ViewChannel";

/** Members the bot adds to a private thread itself, beyond the pinged roles. Each is one call to Discord. */
export const THREAD_MEMBER_CAP = 50;

type Thread = PublicThreadChannel | PrivateThreadChannel;

/** Cached members holding any of these roles, bots left out. */
function membersWith(ctx: TicketCtx, roleIds: readonly string[]): string[] {
  const roles = new Set(roleIds);
  if (roles.size === 0) return [];
  return [...ctx.guild.members.cache.filter((member) => !member.user.bot && member.roles.cache.some((role) => roles.has(role.id))).keys()];
}

/** How long a full member list stays good enough before a thread asks Discord for it again. */
const MEMBER_LIST_MS = 10 * 60_000;
const MEMBER_FETCH_WAIT_MS = 5_000;
const fetchedAt = new Map<string, number>();

/**
 * Makes sure the member cache holds everyone, so the role holders a thread
 * needs are found. Discord only sends members as they become active, so after
 * a restart the cache is partial; one full fetch fills it, at most every ten
 * minutes per server and never for longer than a few seconds.
 */
async function withMembers(ctx: TicketCtx): Promise<void> {
  const guild = ctx.guild;
  if (typeof guild.memberCount === "number" && guild.members.cache.size >= guild.memberCount) return;
  const last = fetchedAt.get(guild.id) ?? 0;
  if (Date.now() - last < MEMBER_LIST_MS) return;
  fetchedAt.set(guild.id, Date.now());
  const wait = new Promise<void>((resolve) => setTimeout(resolve, MEMBER_FETCH_WAIT_MS).unref());
  await Promise.race([guild.members.fetch().then(() => undefined, warn("load the server's members")), wait]);
}

/** Roles whose members a type's private thread lets in: its handlers, its observers and the admin roles. */
function threadRolesOf(ctx: TicketCtx, type: TicketType | undefined): string[] {
  return type ? channelRolesOf(ctx.settings, type) : [...ctx.settings.general.adminRoles];
}

/**
 * Adds a type's handlers, observers and admin roles to a private thread, which
 * only lets in whoever is added or mentioned. Handlers come first, so a cap
 * reached on a big server leaves out observers rather than the people who
 * answer.
 */
export async function addThreadStaff(ctx: TicketCtx, thread: Thread, type: TicketType): Promise<void> {
  await withMembers(ctx);
  const ordered = [...new Set([...membersWith(ctx, type.handlers), ...membersWith(ctx, threadRolesOf(ctx, type))])];
  for (const id of ordered.slice(0, THREAD_MEMBER_CAP)) {
    if (!thread.members.cache.has(id)) await thread.members.add(id).catch(() => undefined);
  }
}

/**
 * Moves a thread from one type's people to another's: members of the old
 * type's roles who hold none of the new type's leave, the new ones join. The
 * opener and anyone added who holds none of those roles stay.
 */
export async function swapThreadHandlers(ctx: TicketCtx, thread: Thread, from: TicketType | undefined, to: TicketType, openerId: string): Promise<void> {
  await withMembers(ctx);
  const keep = new Set(membersWith(ctx, threadRolesOf(ctx, to)));
  for (const id of membersWith(ctx, threadRolesOf(ctx, from))) {
    if (id !== openerId && !keep.has(id)) await thread.members.remove(id).catch(warn(`remove ${id} from ${thread.id}`));
  }
  await addThreadStaff(ctx, thread, to);
}

/**
 * With the claim lock on, a claimed ticket's handlers can read it but only the
 * one who claimed it can write. Admin roles keep writing. Threads have no
 * per-role permissions, so the lock only applies to channels.
 */
export async function applyClaimLock(ctx: TicketCtx, channel: TicketChannel, type: TicketType | undefined, claimerId: string): Promise<void> {
  if (!ctx.settings.general.claimLock || isThread(channel) || !type) return;
  await setHandlersWriting(ctx, channel, type, false);
  await channel.permissionOverwrites
    .edit(claimerId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }, { type: OverwriteType.Member })
    .catch(warn(`let ${claimerId} write in ${channel.id}`));
}

/**
 * Lifts the claim lock: the handlers can write again and the claimer's own
 * overwrite, which only the lock gave them, goes. Run on unclaim and before a
 * transfer, so nobody keeps a way into a ticket they no longer handle.
 */
export async function releaseClaimLock(ctx: TicketCtx, channel: TicketChannel, type: TicketType | undefined, claimerId: string | null, openerId: string): Promise<void> {
  if (!ctx.settings.general.claimLock || isThread(channel)) return;
  if (type) await setHandlersWriting(ctx, channel, type, true);
  if (claimerId && claimerId !== openerId) await channel.permissionOverwrites.delete(claimerId).catch(warn(`remove ${claimerId} from ${channel.id}`));
}

async function setHandlersWriting(ctx: TicketCtx, channel: TextChannel, type: TicketType, writing: boolean): Promise<void> {
  const admins = new Set(ctx.settings.general.adminRoles);
  for (const roleId of type.handlers) {
    if (admins.has(roleId)) continue;
    await channel.permissionOverwrites
      .edit(roleId, { SendMessages: writing }, { type: OverwriteType.Role })
      .catch(warn(`change who can write in ${channel.id}`));
  }
}

/** Staff of the type by their roles, who have access without being added. */
export function staffMemberIds(ctx: TicketCtx, type: TicketType | undefined): Set<string> {
  return new Set(membersWith(ctx, staffRolesOf(ctx.settings, type)));
}

/**
 * Locks a closed ticket that is kept: members can still read it but not write,
 * and it moves to the closed category when one is set. A thread is locked and
 * archived instead.
 */
export async function lockClosed(ctx: TicketCtx, channel: TicketChannel, openerId: string): Promise<void> {
  if (isThread(channel)) {
    await channel.setLocked(true).catch(warn(`lock ${channel.id}`));
    await channel.setArchived(true).catch(warn(`archive ${channel.id}`));
    return;
  }
  const me = ctx.client.user?.id;
  const members = new Set([openerId, ...memberIdsIn(ctx, channel)]);
  for (const userId of members) {
    if (userId === me) continue;
    await channel.permissionOverwrites.edit(userId, { SendMessages: false }, { type: OverwriteType.Member }).catch(warn(`lock ${channel.id}`));
  }
  const closed = ctx.settings.general.closedCategory;
  if (closed && ctx.guild.channels.cache.get(closed)?.type === ChannelType.GuildCategory && channel.parentId !== closed) {
    await channel.setParent(closed, { lockPermissions: false }).catch(warn(`move ${channel.id} to the closed category`));
  }
}

/** Undoes `lockClosed` for a reopened ticket, moving it back to its type's category when there is room. */
export async function unlockReopened(ctx: TicketCtx, channel: TicketChannel, openerId: string, type: TicketType | undefined): Promise<void> {
  if (isThread(channel)) {
    await channel.setArchived(false).catch(warn(`unarchive ${channel.id}`));
    await channel.setLocked(false).catch(warn(`unlock ${channel.id}`));
    return;
  }
  const me = ctx.client.user?.id;
  const members = new Set([openerId, ...memberIdsIn(ctx, channel)]);
  for (const userId of members) {
    if (userId === me) continue;
    await channel.permissionOverwrites.edit(userId, { SendMessages: true }, { type: OverwriteType.Member }).catch(warn(`unlock ${channel.id}`));
  }
  if (!type) return;
  const category = categoryFor(ctx, type);
  if (category.ok && channel.parentId !== category.id) {
    await channel.setParent(category.id, { lockPermissions: false }).catch(warn(`move ${channel.id} back to its category`));
  }
}
