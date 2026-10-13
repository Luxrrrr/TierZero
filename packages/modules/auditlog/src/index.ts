import { defineModule, s, type Infer, type ModuleContext, type ReplyValues } from "@tier0/core";
import { categoriesForMemberDiff, diffMember } from "./diff.js";
import {
  ENTRIES,
  STARTING,
  banValues,
  channelCreateValues,
  channelDeleteValues,
  deleteValues,
  editValues,
  joinValues,
  memberValues,
  roleCreateValues,
  roleDeleteValues,
  updateValues,
  type AuditEvent,
} from "./messages.js";
import { shouldIgnoreChannel, shouldLogMessageEdit, shouldLogMessageEvent, type AuditSettings } from "./policy.js";

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
    help: "Left unset, nothing is logged.",
  }),
  includeBots: s.boolean({ label: "Log messages from bots", default: false }),
  ignoreChannels: s.array(s.channel({ types: ["text"] }), {
    label: "Channels to ignore",
    help: "Nothing that happens in these channels is logged.",
  }),
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
    },
    {
      label: "How each entry looks",
      help: "The wording of what is posted for each kind of event. Which events are posted is chosen above. A line left empty by what is known, such as a deleted message the bot never saw, is left out.",
    },
  ),
});

type AuditModuleSettings = Infer<typeof settingsSchema>;
type Ctx = ModuleContext<AuditModuleSettings>;

function toAuditSettings(settings: AuditModuleSettings): AuditSettings {
  return {
    logChannelId: settings.channel,
    ignoreChannels: settings.ignoreChannels,
    includeBots: settings.includeBots,
    categories: settings.events,
  };
}

async function send(ctx: Ctx, event: AuditEvent, values: ReplyValues): Promise<void> {
  // No channel configured means the module is on but has nothing to write to.
  // That is a normal state, not a misconfiguration.
  if (!ctx.settings.channel) return;
  const channel = ctx.guild.channels.cache.get(ctx.settings.channel);
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
      if (!shouldLogMessageEvent("messageDelete", settings, { channelId: message.channelId, authorIsBot })) {
        return;
      }
      await send(ctx, "messageDelete", deleteValues(message));
    },

    async messageUpdate(before, after, ctx) {
      const settings = toAuditSettings(ctx.settings);
      const authorIsBot = after.author?.bot ?? before.author?.bot ?? false;
      const contentBefore = before.content ?? null;
      const contentAfter = after.content ?? null;
      if (
        !shouldLogMessageEdit(settings, {
          channelId: after.channelId,
          authorIsBot,
          contentBefore,
          contentAfter,
        })
      ) {
        return;
      }
      const link = !after.partial && after.url ? after.url : null;
      await send(ctx, "messageEdit", editValues(after, contentBefore, contentAfter, link));
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
      const diff = diffMember(
        { nickname: before.nickname ?? null, roleIds: [...before.roles.cache.keys()] },
        { nickname: after.nickname ?? null, roleIds: [...after.roles.cache.keys()] },
      );
      const categories = categoriesForMemberDiff(diff).filter((category) => ctx.settings.events[category]);
      if (categories.length === 0) return;

      await send(
        ctx,
        "memberUpdate",
        updateValues(after.user, diff, {
          nickname: categories.includes("nicknameChange"),
          roles: categories.includes("roleChange"),
        }),
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
  },
});
