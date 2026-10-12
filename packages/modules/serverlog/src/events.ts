import {
  ChannelType,
  type GuildChannel,
  type GuildMember,
  type PartialGuildMember,
  type Role,
  type ThreadChannel,
  type User,
} from "discord.js";
import type { EventHandlers, ServerLogChange } from "@tier0/core";
import { AuditLogEvent, clip, executorOf, record, type Who } from "./record.js";
import { logCreated, logDeleted, logEdited } from "./message-log.js";
import type { ServerLogSettings } from "./settings.js";

type Handlers = Partial<EventHandlers<ServerLogSettings>>;

const whoUser = (user: Pick<User, "id" | "username" | "globalName">): Who => ({ id: user.id, name: user.globalName ?? user.username });
const whoMember = (member: GuildMember | PartialGuildMember): Who => ({
  id: member.id,
  name: member.displayName ?? member.user?.globalName ?? member.user?.username ?? member.id,
});

const date = (value: Date | number | null | undefined): string => (value ? new Date(value).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "unknown");

const channelKind = (type: ChannelType): string => {
  switch (type) {
    case ChannelType.GuildText:
      return "text channel";
    case ChannelType.GuildVoice:
      return "voice channel";
    case ChannelType.GuildCategory:
      return "category";
    case ChannelType.GuildAnnouncement:
      return "announcement channel";
    case ChannelType.GuildStageVoice:
      return "stage channel";
    case ChannelType.GuildForum:
      return "forum";
    case ChannelType.GuildMedia:
      return "media channel";
    default:
      return "channel";
  }
};

const hex = (color: number): string => (color === 0 ? "none" : `#${color.toString(16).padStart(6, "0")}`);
const yesNo = (value: boolean): string => (value ? "on" : "off");

/** A change is only worth a line when the value is different. */
function change(label: string, before: string | null | undefined, after: string | null | undefined): ServerLogChange[] {
  const b = before ?? null;
  const a = after ?? null;
  return b === a ? [] : [{ label, before: b, after: a }];
}

const overwritesOf = (channel: GuildChannel): string =>
  JSON.stringify([...channel.permissionOverwrites.cache.values()].map((o) => [o.id, o.allow.bitfield.toString(), o.deny.bitfield.toString()]).sort());

export const serverLogEvents: Handlers = {
  async memberJoin(member, ctx) {
    await record(ctx.guild, ctx.settings, {
      type: "member.join",
      target: whoMember(member),
      summary: `${whoMember(member).name} joined the server`,
      details: { notes: [`Account created ${date(member.user.createdAt)}`] },
    });
  },

  async memberLeave(member, ctx) {
    const who = whoMember(member);
    const roles = member.partial ? [] : [...member.roles.cache.values()].filter((r) => r.id !== ctx.guild.id).map((r) => r.name);
    // A kick and a departure look the same to the gateway. The server's audit log tells them apart.
    const kicker = ctx.settings.categories.moderation ? await executorOf(ctx.guild, AuditLogEvent.MemberKick, member.id, 6_000) : null;
    if (kicker) {
      await record(ctx.guild, ctx.settings, {
        type: "member.kick",
        actor: kicker,
        target: who,
        summary: `${who.name} was kicked by ${kicker.name}`,
        details: roles.length > 0 ? { notes: [`Roles: ${roles.join(", ")}`] } : {},
      });
      return;
    }
    await record(ctx.guild, ctx.settings, {
      type: "member.leave",
      target: who,
      summary: `${who.name} left the server`,
      details: {
        notes: [
          ...(member.joinedAt ? [`Joined ${date(member.joinedAt)}`] : []),
          ...(roles.length > 0 ? [`Roles: ${roles.join(", ")}`] : []),
        ],
      },
    });
  },

  async memberUpdate(before, after, ctx) {
    if (before.partial) return;
    const target = whoMember(after);

    if (before.nickname !== after.nickname) {
      const actor = await executorOf(ctx.guild, AuditLogEvent.MemberUpdate, after.id, 6_000);
      await record(ctx.guild, ctx.settings, {
        type: "member.nickname",
        actor: actor && actor.id !== after.id ? actor : null,
        target,
        summary: `${target.name} had their nickname changed`,
        details: { changes: change("Nickname", before.nickname ?? "(none)", after.nickname ?? "(none)") },
      });
    }

    const had = new Set(before.roles.cache.keys());
    const has = new Set(after.roles.cache.keys());
    const added = [...has].filter((id) => !had.has(id));
    const removed = [...had].filter((id) => !has.has(id));
    if (added.length > 0 || removed.length > 0) {
      const names = (ids: string[]) => ids.map((id) => ctx.guild.roles.cache.get(id)?.name ?? id).join(", ");
      const actor = await executorOf(ctx.guild, AuditLogEvent.MemberRoleUpdate, after.id, 6_000);
      await record(ctx.guild, ctx.settings, {
        type: "member.roles",
        actor,
        target,
        summary: `${target.name}'s roles changed`,
        details: {
          changes: [
            ...(added.length > 0 ? [{ label: "Roles added", before: null, after: names(added) }] : []),
            ...(removed.length > 0 ? [{ label: "Roles removed", before: names(removed), after: null }] : []),
          ],
        },
      });
    }

    const wasUntil = before.communicationDisabledUntilTimestamp;
    const nowUntil = after.communicationDisabledUntilTimestamp;
    if (wasUntil !== nowUntil) {
      const stillOn = nowUntil !== null && nowUntil > Date.now();
      const wasOn = wasUntil !== null && wasUntil > Date.now();
      if (stillOn || wasOn) {
        const actor = await executorOf(ctx.guild, AuditLogEvent.MemberUpdate, after.id, 6_000);
        await record(ctx.guild, ctx.settings, {
          type: stillOn ? "member.timeout" : "member.timeout.end",
          actor,
          target,
          summary: stillOn ? `${target.name} was timed out` : `${target.name}'s timeout was removed`,
          details: stillOn ? { notes: [`Until ${date(nowUntil)}`] } : {},
        });
      }
    }
  },

  async messageCreate(message, ctx) {
    await logCreated(message, ctx.settings);
  },

  async messageUpdate(before, after, ctx) {
    const saved = await logEdited(before, after, ctx.settings);
    if (!saved) return;
    await record(ctx.guild, ctx.settings, {
      type: "message.edit",
      target: { id: saved.authorId, name: saved.authorName },
      channel: { id: after.channelId, name: saved.channelName },
      summary: `${saved.authorName} edited a message in #${saved.channelName}`,
      details: { messageId: after.id, changes: [{ label: "Message", before: saved.before ?? "(earlier text was not saved)", after: saved.after }] },
    });
  },

  async messageDelete(message, ctx) {
    const saved = await logDeleted(message, ctx.settings);
    const channelName = saved?.channelName ?? ("name" in message.channel && typeof message.channel.name === "string" ? message.channel.name : "");
    await record(ctx.guild, ctx.settings, {
      type: "message.delete",
      target: saved ? { id: saved.authorId, name: saved.authorName } : null,
      channel: { id: message.channelId, name: channelName },
      summary: saved ? `A message by ${saved.authorName} was deleted in #${channelName}` : `A message was deleted in #${channelName}`,
      details: {
        // Only a message the log has can be opened in the Messages view.
        messageId: saved?.edited ? message.id : undefined,
        edited: saved?.edited ? true : undefined,
        changes: saved ? [{ label: "Message", before: saved.content || "(no text)", after: null }] : [],
        notes: saved && saved.attachments.length > 0 ? [`Files: ${saved.attachments.map((a) => a.name).join(", ")}`] : saved ? [] : ["What it said was not saved."],
      },
    });
  },

  async messageDeleteBulk(messages, channel, ctx) {
    const authors = new Set<string>();
    for (const message of messages.values()) {
      const saved = await logDeleted(message, ctx.settings);
      if (saved) authors.add(saved.authorId);
    }
    await record(ctx.guild, ctx.settings, {
      type: "message.purge",
      channel: { id: channel.id, name: channel.name },
      summary: `${messages.size} ${messages.size === 1 ? "message was" : "messages were"} deleted at once in #${channel.name}`,
      details: { notes: authors.size > 0 ? [`From ${authors.size} ${authors.size === 1 ? "member" : "members"} the log knew about`] : [] },
    });
  },

  async channelCreate(channel, ctx) {
    const actor = await executorOf(ctx.guild, AuditLogEvent.ChannelCreate, channel.id, 6_000);
    await record(ctx.guild, ctx.settings, {
      type: "channel.create",
      actor,
      channel: { id: channel.id, name: channel.name },
      summary: `The ${channelKind(channel.type)} #${channel.name} was created`,
      details: { notes: channel.parent ? [`In the category ${channel.parent.name}`] : [] },
    });
  },

  async channelDelete(channel, ctx) {
    const actor = await executorOf(ctx.guild, AuditLogEvent.ChannelDelete, channel.id, 6_000);
    await record(ctx.guild, ctx.settings, {
      type: "channel.delete",
      actor,
      channel: { id: channel.id, name: channel.name },
      summary: `The ${channelKind(channel.type)} #${channel.name} was deleted`,
    });
  },

  async channelUpdate(before, after, ctx) {
    const topic = (c: GuildChannel) => ("topic" in c && typeof c.topic === "string" ? c.topic : null);
    const slow = (c: GuildChannel) => ("rateLimitPerUser" in c && typeof c.rateLimitPerUser === "number" ? `${c.rateLimitPerUser}s` : null);
    const nsfw = (c: GuildChannel) => ("nsfw" in c && typeof c.nsfw === "boolean" ? yesNo(c.nsfw) : null);
    const changes: ServerLogChange[] = [
      ...change("Name", before.name, after.name),
      ...change("Topic", topic(before), topic(after)),
      ...change("Category", before.parent?.name ?? "(none)", after.parent?.name ?? "(none)"),
      ...change("Slowmode", slow(before), slow(after)),
      ...change("Age-restricted", nsfw(before), nsfw(after)),
      ...(overwritesOf(before) !== overwritesOf(after)
        ? [{ label: "Permissions", before: `${before.permissionOverwrites.cache.size} overrides`, after: `${after.permissionOverwrites.cache.size} overrides` }]
        : []),
    ];
    if (changes.length === 0) return;
    const actor = await executorOf(ctx.guild, AuditLogEvent.ChannelUpdate, after.id, 6_000)
      ?? (changes.some((c) => c.label === "Permissions") ? await executorOf(ctx.guild, AuditLogEvent.ChannelOverwriteUpdate, after.id, 6_000) : null);
    await record(ctx.guild, ctx.settings, {
      type: "channel.update",
      actor,
      channel: { id: after.id, name: after.name },
      summary: `The ${channelKind(after.type)} #${after.name} was changed`,
      details: { changes },
    });
  },

  async threadCreate(thread: ThreadChannel, ctx) {
    const owner = thread.ownerId ? ctx.guild.members.cache.get(thread.ownerId) : undefined;
    await record(ctx.guild, ctx.settings, {
      type: "thread.create",
      actor: owner ? whoMember(owner) : null,
      channel: { id: thread.id, name: thread.name },
      summary: `The thread ${thread.name} was created${thread.parent ? ` in #${thread.parent.name}` : ""}`,
    });
  },

  async threadDelete(thread: ThreadChannel, ctx) {
    await record(ctx.guild, ctx.settings, {
      type: "thread.delete",
      channel: { id: thread.id, name: thread.name },
      summary: `The thread ${thread.name} was deleted${thread.parent ? ` in #${thread.parent.name}` : ""}`,
    });
  },

  async roleCreate(role, ctx) {
    const actor = await executorOf(ctx.guild, AuditLogEvent.RoleCreate, role.id, 6_000);
    await record(ctx.guild, ctx.settings, { type: "role.create", actor, summary: `The role ${role.name} was created` });
  },

  async roleDelete(role, ctx) {
    const actor = await executorOf(ctx.guild, AuditLogEvent.RoleDelete, role.id, 6_000);
    await record(ctx.guild, ctx.settings, { type: "role.delete", actor, summary: `The role ${role.name} was deleted` });
  },

  async roleUpdate(before: Role, after: Role, ctx) {
    const gained = before.permissions.missing(after.permissions);
    const lost = after.permissions.missing(before.permissions);
    const changes: ServerLogChange[] = [
      ...change("Name", before.name, after.name),
      ...change("Colour", hex(before.color), hex(after.color)),
      ...change("Shown separately", yesNo(before.hoist), yesNo(after.hoist)),
      ...change("Anyone can mention", yesNo(before.mentionable), yesNo(after.mentionable)),
      ...(gained.length > 0 ? [{ label: "Permissions added", before: null, after: gained.join(", ") }] : []),
      ...(lost.length > 0 ? [{ label: "Permissions removed", before: lost.join(", "), after: null }] : []),
    ];
    if (changes.length === 0) return;
    const actor = await executorOf(ctx.guild, AuditLogEvent.RoleUpdate, after.id, 6_000);
    await record(ctx.guild, ctx.settings, { type: "role.update", actor, summary: `The role ${after.name} was changed`, details: { changes } });
  },

  async guildUpdate(before, after, ctx) {
    const changes: ServerLogChange[] = [
      ...change("Name", before.name, after.name),
      ...change("Description", before.description, after.description),
      ...change("Icon", before.icon, after.icon).map((c) => ({ ...c, before: c.before ? "(an icon)" : "(none)", after: c.after ? "(a new icon)" : "(none)" })),
      ...change("Banner", before.banner, after.banner).map((c) => ({ ...c, before: c.before ? "(a banner)" : "(none)", after: c.after ? "(a new banner)" : "(none)" })),
      ...change("Verification level", String(before.verificationLevel), String(after.verificationLevel)),
      ...change("Owner", before.ownerId, after.ownerId),
      ...change("AFK channel", before.afkChannelId, after.afkChannelId),
      ...change("System messages channel", before.systemChannelId, after.systemChannelId),
    ];
    if (changes.length === 0) return;
    const actor = await executorOf(ctx.guild, AuditLogEvent.GuildUpdate, after.id, 6_000);
    await record(ctx.guild, ctx.settings, { type: "server.update", actor, summary: "The server's settings were changed", details: { changes } });
  },

  async voiceStateUpdate(before, after, ctx) {
    const member = after.member ?? before.member;
    if (!member) return;
    const target = whoMember(member);
    const from = before.channel;
    const to = after.channel;
    if (!from && to) {
      await record(ctx.guild, ctx.settings, { type: "voice.join", target, channel: { id: to.id, name: to.name }, summary: `${target.name} joined the voice channel ${to.name}` });
    } else if (from && !to) {
      await record(ctx.guild, ctx.settings, { type: "voice.leave", target, channel: { id: from.id, name: from.name }, summary: `${target.name} left the voice channel ${from.name}` });
    } else if (from && to && from.id !== to.id) {
      await record(ctx.guild, ctx.settings, {
        type: "voice.move",
        target,
        channel: { id: to.id, name: to.name },
        summary: `${target.name} moved from ${from.name} to ${to.name}`,
      });
    }
    // Only what a moderator did to them. Muting yourself is not the server's business.
    const changes: ServerLogChange[] = [
      ...change("Server muted", yesNo(before.serverMute === true), yesNo(after.serverMute === true)),
      ...change("Server deafened", yesNo(before.serverDeaf === true), yesNo(after.serverDeaf === true)),
    ];
    if (changes.length > 0 && to) {
      await record(ctx.guild, ctx.settings, {
        type: "voice.moderate",
        target,
        channel: { id: to.id, name: to.name },
        summary: `${target.name} was ${after.serverMute && !before.serverMute ? "muted" : after.serverDeaf && !before.serverDeaf ? "deafened" : "changed"} by the server`,
        details: { changes },
      });
    }
  },

  async inviteCreate(invite, ctx) {
    await record(ctx.guild, ctx.settings, {
      type: "invite.create",
      actor: invite.inviter ? whoUser(invite.inviter) : null,
      channel: invite.channel ? { id: invite.channel.id, name: invite.channel.name ?? "" } : null,
      summary: `The invite ${invite.code} was created${invite.channel ? ` for #${invite.channel.name}` : ""}`,
      details: {
        notes: [
          invite.maxUses ? `Up to ${invite.maxUses} uses` : "Unlimited uses",
          invite.maxAge ? `Expires after ${Math.round(invite.maxAge / 3600)} hours` : "Never expires",
        ],
      },
    });
  },

  async inviteDelete(invite, ctx) {
    await record(ctx.guild, ctx.settings, {
      type: "invite.delete",
      channel: invite.channel ? { id: invite.channel.id, name: invite.channel.name ?? "" } : null,
      summary: `The invite ${invite.code} was deleted`,
    });
  },

  async emojiCreate(emoji, ctx) {
    const actor = await executorOf(ctx.guild, AuditLogEvent.EmojiCreate, emoji.id, 6_000);
    await record(ctx.guild, ctx.settings, { type: "emoji.create", actor, summary: `The emoji :${emoji.name}: was added` });
  },

  async emojiUpdate(before, after, ctx) {
    if (before.name === after.name) return;
    const actor = await executorOf(ctx.guild, AuditLogEvent.EmojiUpdate, after.id, 6_000);
    await record(ctx.guild, ctx.settings, {
      type: "emoji.update",
      actor,
      summary: `The emoji :${before.name}: was renamed to :${after.name}:`,
      details: { changes: change("Name", before.name, after.name) },
    });
  },

  async emojiDelete(emoji, ctx) {
    const actor = await executorOf(ctx.guild, AuditLogEvent.EmojiDelete, emoji.id, 6_000);
    await record(ctx.guild, ctx.settings, { type: "emoji.delete", actor, summary: `The emoji :${emoji.name}: was removed` });
  },

  async banAdd(ban, ctx) {
    const actor = await executorOf(ctx.guild, AuditLogEvent.MemberBanAdd, ban.user.id, 6_000);
    const reason = ban.reason ?? (ban.partial ? ((await ban.fetch().catch(() => null))?.reason ?? null) : null);
    const who = whoUser(ban.user);
    await record(ctx.guild, ctx.settings, {
      type: "member.ban",
      actor,
      target: who,
      summary: `${who.name} was banned${actor ? ` by ${actor.name}` : ""}`,
      details: { notes: reason ? [`Reason: ${clip(reason, 300)}`] : [] },
    });
  },

  async banRemove(ban, ctx) {
    const actor = await executorOf(ctx.guild, AuditLogEvent.MemberBanRemove, ban.user.id, 6_000);
    const who = whoUser(ban.user);
    await record(ctx.guild, ctx.settings, { type: "member.unban", actor, target: who, summary: `${who.name} was unbanned${actor ? ` by ${actor.name}` : ""}` });
  },
};
