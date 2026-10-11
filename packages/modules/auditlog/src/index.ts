import { EmbedBuilder } from "discord.js";
import { defineModule, s, type Infer, type ModuleContext } from "@tier0/core";
import { categoriesForMemberDiff, diffMember } from "./diff.js";
import { shouldIgnoreChannel, shouldLogMessageEdit, shouldLogMessageEvent, type AuditSettings } from "./policy.js";

const FIELD_LIMIT = 1024;

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

function truncate(text: string, max = FIELD_LIMIT): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

async function send(ctx: Ctx, embed: EmbedBuilder): Promise<void> {
  // No channel configured means the module is on but has nothing to write to.
  // That is a normal state, not a misconfiguration.
  if (!ctx.settings.channel) return;
  const channel = ctx.guild.channels.cache.get(ctx.settings.channel);
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [embed] }).catch((error: unknown) => {
    console.error(`[auditlog] failed to write to the log channel in guild ${ctx.guild.id}:`, error);
  });
}

function baseEmbed(title: string, color: number): EmbedBuilder {
  return new EmbedBuilder().setTitle(title).setColor(color).setTimestamp(new Date());
}

const COLOR_REMOVE = 0xed4245;
const COLOR_EDIT = 0xfaa61a;
const COLOR_ADD = 0x57f287;
const COLOR_NEUTRAL = 0x5865f2;

export default defineModule({
  id: "auditlog",
  name: "Audit log",
  summary: "Writes a record of what changed on the server to a channel.",
  category: "logging",

  settings: settingsSchema,

  events: {
    async messageDelete(message, ctx) {
      const settings = toAuditSettings(ctx.settings);
      const authorIsBot = message.author?.bot ?? false;
      if (!shouldLogMessageEvent("messageDelete", settings, { channelId: message.channelId, authorIsBot })) {
        return;
      }

      const embed = baseEmbed("Message deleted", COLOR_REMOVE).addFields(
        {
          name: "Author",
          value: message.author ? `<@${message.author.id}> (${message.author.tag})` : "Unknown (not cached)",
          inline: true,
        },
        { name: "Channel", value: `<#${message.channelId}>`, inline: true },
        {
          name: "Content",
          value: message.content ? truncate(message.content) : "Unavailable (message was not cached)",
        },
      );
      await send(ctx, embed);
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

      const embed = baseEmbed("Message edited", COLOR_EDIT).addFields(
        {
          name: "Author",
          value: after.author ? `<@${after.author.id}> (${after.author.tag})` : "Unknown (not cached)",
          inline: true,
        },
        { name: "Channel", value: `<#${after.channelId}>`, inline: true },
        { name: "Before", value: contentBefore ? truncate(contentBefore) : "Unavailable (not cached)" },
        { name: "After", value: contentAfter ? truncate(contentAfter) : "Unavailable" },
      );
      if (!after.partial && after.url) embed.setURL(after.url);
      await send(ctx, embed);
    },

    async memberJoin(member, ctx) {
      if (!ctx.settings.events.memberJoin) return;
      const embed = baseEmbed("Member joined", COLOR_ADD).addFields(
        { name: "Member", value: `<@${member.id}> (${member.user.tag})`, inline: true },
        {
          name: "Account created",
          value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
          inline: true,
        },
      );
      await send(ctx, embed);
    },

    async memberLeave(member, ctx) {
      if (!ctx.settings.events.memberLeave) return;
      const embed = baseEmbed("Member left", COLOR_REMOVE).addFields({
        name: "Member",
        value: `<@${member.id}> (${member.user.tag})`,
      });
      await send(ctx, embed);
    },

    async memberUpdate(before, after, ctx) {
      const diff = diffMember(
        { nickname: before.nickname ?? null, roleIds: [...before.roles.cache.keys()] },
        { nickname: after.nickname ?? null, roleIds: [...after.roles.cache.keys()] },
      );
      const categories = categoriesForMemberDiff(diff).filter((category) => ctx.settings.events[category]);
      if (categories.length === 0) return;

      const embed = baseEmbed("Member updated", COLOR_NEUTRAL).addFields({
        name: "Member",
        value: `<@${after.id}> (${after.user.tag})`,
      });

      if (categories.includes("nicknameChange")) {
        embed.addFields(
          { name: "Nickname before", value: diff.nicknameBefore ?? "(none)", inline: true },
          { name: "Nickname after", value: diff.nicknameAfter ?? "(none)", inline: true },
        );
      }
      if (categories.includes("roleChange")) {
        if (diff.rolesAdded.length > 0) {
          embed.addFields({ name: "Roles added", value: diff.rolesAdded.map((id) => `<@&${id}>`).join(", ") });
        }
        if (diff.rolesRemoved.length > 0) {
          embed.addFields({ name: "Roles removed", value: diff.rolesRemoved.map((id) => `<@&${id}>`).join(", ") });
        }
      }
      await send(ctx, embed);
    },

    async channelCreate(channel, ctx) {
      if (!ctx.settings.events.channelCreate) return;
      if (shouldIgnoreChannel(channel.id, toAuditSettings(ctx.settings))) return;
      const embed = baseEmbed("Channel created", COLOR_ADD).addFields({
        name: "Channel",
        value: `<#${channel.id}> (${channel.name})`,
      });
      await send(ctx, embed);
    },

    async channelDelete(channel, ctx) {
      if (!ctx.settings.events.channelDelete) return;
      if (shouldIgnoreChannel(channel.id, toAuditSettings(ctx.settings))) return;
      const embed = baseEmbed("Channel deleted", COLOR_REMOVE).addFields({
        name: "Channel",
        value: `#${channel.name}`,
      });
      await send(ctx, embed);
    },

    async roleCreate(role, ctx) {
      if (!ctx.settings.events.roleCreate) return;
      const embed = baseEmbed("Role created", COLOR_ADD).addFields({
        name: "Role",
        value: `<@&${role.id}> (${role.name})`,
      });
      await send(ctx, embed);
    },

    async roleDelete(role, ctx) {
      if (!ctx.settings.events.roleDelete) return;
      const embed = baseEmbed("Role deleted", COLOR_REMOVE).addFields({ name: "Role", value: role.name });
      await send(ctx, embed);
    },

    async banAdd(ban, ctx) {
      if (!ctx.settings.events.banAdd) return;
      const embed = baseEmbed("Member banned", COLOR_REMOVE).addFields({
        name: "Member",
        value: `<@${ban.user.id}> (${ban.user.tag})`,
      });
      if (!ban.partial && ban.reason) embed.addFields({ name: "Reason", value: truncate(ban.reason) });
      await send(ctx, embed);
    },

    async banRemove(ban, ctx) {
      if (!ctx.settings.events.banRemove) return;
      const embed = baseEmbed("Member unbanned", COLOR_ADD).addFields({
        name: "Member",
        value: `<@${ban.user.id}> (${ban.user.tag})`,
      });
      await send(ctx, embed);
    },
  },
});
