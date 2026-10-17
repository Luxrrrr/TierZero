import { AuditLogEvent } from "discord.js";
import { defineModule, s, type Infer, type ModuleContext, type ReplyValues } from "@tier0/core";
import { categoriesForMemberDiff, diffMember, serverChanges, timeoutChange, voiceChange } from "./diff.js";
import {
  ENTRIES,
  STARTING,
  banValues,
  changesValues,
  channelCreateValues,
  channelDeleteValues,
  deleteValues,
  editValues,
  emojiCreateValues,
  emojiDeleteValues,
  emojiUpdateValues,
  inviteDeleteValues,
  inviteValues,
  joinValues,
  kickValues,
  memberValues,
  roleCreateValues,
  roleDeleteValues,
  stickerChanges,
  stickerValues,
  threadDeleteValues,
  threadValues,
  timeoutValues,
  updateValues,
  voiceMoveValues,
  voiceValues,
  labelsGroup,
  type AuditEvent,
} from "./messages.js";
import { channelFor, shouldIgnoreChannel, shouldLogAuthor, shouldLogMessageEdit, shouldLogMessageEvent, type AuditSettings } from "./policy.js";

const entry = (event: AuditEvent) =>
  s.message({
    label: ENTRIES[event].label,
    help: ENTRIES[event].help,
    starting: STARTING[event],
    variables: ENTRIES[event].variables,
    components: false,
    compact: true,
  });

const settingsSchema = s.object({
  channel: s.channel({
    types: ["text"],
    optional: true,
    essential: true,
    label: "Log channel",
    help: "Where entries are posted, unless their kind has a channel of its own under Separate channels. Left unset, only those kinds are logged.",
  }),
  includeBots: s.boolean({
    label: "Log what bots do",
    help: "Messages from bots, and bots joining or leaving voice, are left out unless this is on.",
    default: false,
  }),
  ignoreChannels: s.array(s.channel({ types: ["text", "voice", "forum"] }), {
    label: "Channels to ignore",
    help: "Nothing that happens in these channels, or in threads inside them, is logged.",
  }),
  channels: s.object(
    {
      messages: s.channel({ types: ["text"], optional: true, label: "Message deletions and edits" }),
      members: s.channel({ types: ["text"], optional: true, label: "Joins, departures, nicknames and member roles" }),
      server: s.channel({ types: ["text"], optional: true, label: "Channels and roles created or deleted" }),
      bans: s.channel({ types: ["text"], optional: true, label: "Bans, kicks and timeouts" }),
      voice: s.channel({ types: ["text"], optional: true, label: "Voice channel activity" }),
      invites: s.channel({ types: ["text"], optional: true, label: "Invites" }),
      threads: s.channel({ types: ["text"], optional: true, label: "Threads" }),
      emojis: s.channel({ types: ["text"], optional: true, label: "Emoji and stickers" }),
      settings: s.channel({ types: ["text"], optional: true, label: "Server setting changes" }),
    },
    {
      label: "Separate channels",
      help: "Send a kind of entry to a channel of its own. A kind left empty goes to the log channel.",
      collapsible: true,
    },
  ),
  events: s.object(
    {
      messageDelete: s.boolean({ label: "Message deletions", default: true }),
      messageEdit: s.boolean({ label: "Message edits", default: true }),
      memberJoin: s.boolean({ label: "Joins", default: true }),
      memberLeave: s.boolean({ label: "Departures", default: true }),
      nicknameChange: s.boolean({ label: "Nickname changes", default: true }),
      roleChange: s.boolean({ label: "Member role changes", default: true }),
      channelCreate: s.boolean({ label: "Channel creation", default: true }),
      channelDelete: s.boolean({ label: "Channel deletion", default: true }),
      roleCreate: s.boolean({ label: "Role creation", default: false }),
      roleDelete: s.boolean({ label: "Role deletion", default: false }),
      banAdd: s.boolean({ label: "Bans", default: true }),
      banRemove: s.boolean({ label: "Unbans", default: true }),
      kick: s.boolean({
        label: "Kicks",
        help: "Read from the server's audit log, so the bot needs the View Audit Log permission.",
        default: true,
      }),
      timeoutAdd: s.boolean({ label: "Timeouts", default: true }),
      timeoutRemove: s.boolean({ label: "Timeouts lifted early", default: true }),
      voiceJoin: s.boolean({ label: "Joining voice", default: false }),
      voiceLeave: s.boolean({ label: "Leaving voice", default: false }),
      voiceMove: s.boolean({ label: "Moving between voice channels", default: false }),
      inviteCreate: s.boolean({ label: "Invites created", default: false }),
      inviteDelete: s.boolean({ label: "Invites deleted", default: false }),
      threadCreate: s.boolean({ label: "Threads created", default: false }),
      threadDelete: s.boolean({ label: "Threads deleted", default: false }),
      threadArchive: s.boolean({ label: "Threads archived", default: false }),
      emojiChange: s.boolean({ label: "Emoji added, renamed or removed", default: false }),
      stickerChange: s.boolean({ label: "Stickers added, changed or removed", default: false }),
      serverUpdate: s.boolean({ label: "Server setting changes", default: false }),
    },
    { label: "What to record" },
  ),
  messages: s.object(
    {
      messageDelete: entry("messageDelete"),
      messageEdit: entry("messageEdit"),
      memberJoin: entry("memberJoin"),
      memberLeave: entry("memberLeave"),
      memberUpdate: entry("memberUpdate"),
      channelCreate: entry("channelCreate"),
      channelDelete: entry("channelDelete"),
      roleCreate: entry("roleCreate"),
      roleDelete: entry("roleDelete"),
      banAdd: entry("banAdd"),
      banRemove: entry("banRemove"),
      memberKick: entry("memberKick"),
      memberTimeout: entry("memberTimeout"),
      memberTimeoutEnd: entry("memberTimeoutEnd"),
      voiceJoin: entry("voiceJoin"),
      voiceLeave: entry("voiceLeave"),
      voiceMove: entry("voiceMove"),
      inviteCreate: entry("inviteCreate"),
      inviteDelete: entry("inviteDelete"),
      threadCreate: entry("threadCreate"),
      threadDelete: entry("threadDelete"),
      threadArchive: entry("threadArchive"),
      emojiCreate: entry("emojiCreate"),
      emojiUpdate: entry("emojiUpdate"),
      emojiDelete: entry("emojiDelete"),
      stickerCreate: entry("stickerCreate"),
      stickerUpdate: entry("stickerUpdate"),
      stickerDelete: entry("stickerDelete"),
      serverUpdate: entry("serverUpdate"),
    },
    {
      label: "How each entry looks",
      help: "The wording of each kind of entry. A line with nothing to show is left out.",
      collapsible: true,
    },
  ),
  labels: labelsGroup,
});

type AuditModuleSettings = Infer<typeof settingsSchema>;
type Ctx = ModuleContext<AuditModuleSettings>;

function toAuditSettings(settings: AuditModuleSettings): AuditSettings {
  return {
    logChannelId: settings.channel ?? "",
    otherLogChannels: Object.values(settings.channels).filter((id): id is string => typeof id === "string"),
    ignoreChannels: settings.ignoreChannels,
    includeBots: settings.includeBots,
    categories: settings.events,
  };
}

/** The channel a thread sits in, so an ignored channel's threads are ignored too. */
const parentOf = (message: { channel?: { isThread?(): boolean; parentId?: string | null } | null }): string | null =>
  message.channel?.isThread?.() ? (message.channel.parentId ?? null) : null;

async function send(ctx: Ctx, event: AuditEvent, values: ReplyValues): Promise<void> {
  // No channel configured means the module is on but has nothing to write to.
  // That is a normal state, not a misconfiguration.
  const target = channelFor(event, ctx.settings.channel, ctx.settings.channels);
  if (!target) return;
  const channel = ctx.guild.channels.cache.get(target);
  if (!channel?.isTextBased()) return;
  await ctx.send(channel, ctx.settings.messages[event], values, { fallback: STARTING[event] });
}

export default defineModule({
  id: "auditlog",
  name: "Log channel",
  summary: "Posts what changes on the server into a Discord channel, for staff who stay in Discord. Server logs is the searchable record.",
  category: "more",

  settings: settingsSchema,

  events: {
    async messageDelete(message, ctx) {
      const settings = toAuditSettings(ctx.settings);
      const authorIsBot = message.author?.bot ?? false;
      if (!shouldLogMessageEvent("messageDelete", settings, { channelId: message.channelId, parentId: parentOf(message), authorIsBot })) {
        return;
      }
      await send(ctx, "messageDelete", deleteValues(message, ctx.settings.labels));
    },

    async messageUpdate(before, after, ctx) {
      const settings = toAuditSettings(ctx.settings);
      const authorIsBot = after.author?.bot ?? before.author?.bot ?? false;
      const contentBefore = before.content ?? null;
      const contentAfter = after.content ?? null;
      if (
        !shouldLogMessageEdit(settings, {
          channelId: after.channelId,
          parentId: parentOf(after),
          authorIsBot,
          contentBefore,
          contentAfter,
        })
      ) {
        return;
      }
      const link = !after.partial && after.url ? after.url : null;
      await send(ctx, "messageEdit", editValues(after, contentBefore, contentAfter, link, ctx.settings.labels));
    },

    async memberJoin(member, ctx) {
      if (!ctx.settings.events.memberJoin) return;
      await send(ctx, "memberJoin", joinValues(member.user));
    },

    async memberLeave(member, ctx) {
      if (!ctx.settings.events.memberLeave) return;
      await send(ctx, "memberLeave", memberValues(member.user));
    },

    async memberUpdate(before, after, ctx) {
      const timeout = timeoutChange(before.communicationDisabledUntilTimestamp ?? null, after.communicationDisabledUntilTimestamp, Date.now());
      if (timeout === "add" && ctx.settings.events.timeoutAdd && after.communicationDisabledUntilTimestamp !== null) {
        await send(ctx, "memberTimeout", timeoutValues(after.user, after.communicationDisabledUntilTimestamp));
      } else if (timeout === "remove" && ctx.settings.events.timeoutRemove) {
        await send(ctx, "memberTimeoutEnd", memberValues(after.user));
      }

      const diff = diffMember(
        { nickname: before.nickname ?? null, roleIds: [...before.roles.cache.keys()] },
        { nickname: after.nickname ?? null, roleIds: [...after.roles.cache.keys()] },
      );
      const categories = categoriesForMemberDiff(diff).filter((category) => ctx.settings.events[category]);
      if (categories.length === 0) return;

      await send(
        ctx,
        "memberUpdate",
        updateValues(
          after.user,
          diff,
          {
            nickname: categories.includes("nicknameChange"),
            roles: categories.includes("roleChange"),
          },
          ctx.settings.labels,
        ),
      );
    },

    async channelCreate(channel, ctx) {
      if (!ctx.settings.events.channelCreate) return;
      if (shouldIgnoreChannel(channel.id, toAuditSettings(ctx.settings))) return;
      await send(ctx, "channelCreate", channelCreateValues(channel));
    },

    async channelDelete(channel, ctx) {
      if (!ctx.settings.events.channelDelete) return;
      if (shouldIgnoreChannel(channel.id, toAuditSettings(ctx.settings))) return;
      await send(ctx, "channelDelete", channelDeleteValues(channel));
    },

    async roleCreate(role, ctx) {
      if (!ctx.settings.events.roleCreate) return;
      await send(ctx, "roleCreate", roleCreateValues(role));
    },

    async roleDelete(role, ctx) {
      if (!ctx.settings.events.roleDelete) return;
      await send(ctx, "roleDelete", roleDeleteValues(role));
    },

    async banAdd(ban, ctx) {
      if (!ctx.settings.events.banAdd) return;
      await send(ctx, "banAdd", banValues(ban.user, ban.partial ? null : ban.reason));
    },

    async banRemove(ban, ctx) {
      if (!ctx.settings.events.banRemove) return;
      await send(ctx, "banRemove", memberValues(ban.user));
    },

    async auditLogEntry(entry, ctx) {
      // A kick reaches the gateway as a plain departure; only the audit log says it was a kick.
      if (entry.action !== AuditLogEvent.MemberKick || !ctx.settings.events.kick || !entry.targetId) return;
      const known = entry.target && "tag" in entry.target && typeof entry.target.tag === "string" ? entry.target : null;
      const target = known ?? (await ctx.client.users.fetch(entry.targetId).catch(() => null));
      if (!target || typeof target.tag !== "string") return;
      const tagged = { id: target.id ?? entry.targetId, tag: target.tag };
      await send(ctx, "memberKick", kickValues(tagged, entry.executor && typeof entry.executor.tag === "string" ? { id: entry.executor.id, tag: entry.executor.tag } : null, entry.reason));
    },

    async voiceStateUpdate(before, after, ctx) {
      const member = after.member ?? before.member;
      if (!member || !shouldLogAuthor(member.user.bot, ctx.settings.includeBots)) return;
      const settings = toAuditSettings(ctx.settings);
      const from = before.channel;
      const to = after.channel;
      const kind = voiceChange(from?.id ?? null, to?.id ?? null);
      if (kind === "join" && to && ctx.settings.events.voiceJoin && !shouldIgnoreChannel(to.id, settings, to.parentId)) {
        await send(ctx, "voiceJoin", voiceValues(member.user, to));
      } else if (kind === "leave" && from && ctx.settings.events.voiceLeave && !shouldIgnoreChannel(from.id, settings, from.parentId)) {
        await send(ctx, "voiceLeave", voiceValues(member.user, from));
      } else if (kind === "move" && from && to && ctx.settings.events.voiceMove) {
        // A move between an ignored channel and another is still worth knowing about, unless both are ignored.
        if (shouldIgnoreChannel(from.id, settings, from.parentId) && shouldIgnoreChannel(to.id, settings, to.parentId)) return;
        await send(ctx, "voiceMove", voiceMoveValues(member.user, from, to));
      }
    },

    async inviteCreate(invite, ctx) {
      if (!ctx.settings.events.inviteCreate) return;
      if (invite.channelId && shouldIgnoreChannel(invite.channelId, toAuditSettings(ctx.settings))) return;
      await send(ctx, "inviteCreate", inviteValues(invite));
    },

    async inviteDelete(invite, ctx) {
      if (!ctx.settings.events.inviteDelete) return;
      if (invite.channelId && shouldIgnoreChannel(invite.channelId, toAuditSettings(ctx.settings))) return;
      await send(ctx, "inviteDelete", inviteDeleteValues(invite));
    },

    async threadCreate(thread, ctx) {
      if (!ctx.settings.events.threadCreate) return;
      if (shouldIgnoreChannel(thread.id, toAuditSettings(ctx.settings), thread.parentId)) return;
      await send(ctx, "threadCreate", threadValues(thread));
    },

    async threadDelete(thread, ctx) {
      if (!ctx.settings.events.threadDelete) return;
      if (shouldIgnoreChannel(thread.id, toAuditSettings(ctx.settings), thread.parentId)) return;
      await send(ctx, "threadDelete", threadDeleteValues(thread));
    },

    async threadUpdate(before, after, ctx) {
      if (!ctx.settings.events.threadArchive || before.archived === true || after.archived !== true) return;
      if (shouldIgnoreChannel(after.id, toAuditSettings(ctx.settings), after.parentId)) return;
      await send(ctx, "threadArchive", threadValues(after));
    },

    async emojiCreate(emoji, ctx) {
      if (!ctx.settings.events.emojiChange) return;
      await send(ctx, "emojiCreate", emojiCreateValues(emoji));
    },

    async emojiUpdate(before, after, ctx) {
      if (!ctx.settings.events.emojiChange || before.name === after.name) return;
      await send(ctx, "emojiUpdate", emojiUpdateValues(before, after));
    },

    async emojiDelete(emoji, ctx) {
      if (!ctx.settings.events.emojiChange) return;
      await send(ctx, "emojiDelete", emojiDeleteValues(emoji));
    },

    async stickerCreate(sticker, ctx) {
      if (!ctx.settings.events.stickerChange) return;
      await send(ctx, "stickerCreate", stickerValues(sticker));
    },

    async stickerUpdate(before, after, ctx) {
      if (!ctx.settings.events.stickerChange) return;
      const lines = stickerChanges(before, after);
      if (lines.length === 0) return;
      await send(ctx, "stickerUpdate", { ...stickerValues(after), ...changesValues(lines) });
    },

    async stickerDelete(sticker, ctx) {
      if (!ctx.settings.events.stickerChange) return;
      await send(ctx, "stickerDelete", stickerValues(sticker));
    },

    async guildUpdate(before, after, ctx) {
      if (!ctx.settings.events.serverUpdate) return;
      const lines = serverChanges(before, after);
      if (lines.length === 0) return;
      await send(ctx, "serverUpdate", changesValues(lines));
    },
  },
});
