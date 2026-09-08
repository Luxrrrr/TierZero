import { EmbedBuilder, type GuildMember, type PartialGuildMember } from "discord.js";
import { defineModule, isRoleAssignable, s } from "@tier0/core";
import { PLACEHOLDERS, renderTemplate, type PlaceholderValues } from "./template.js";

function placeholdersFor(member: GuildMember | PartialGuildMember): PlaceholderValues {
  const guild = member.guild;
  return {
    user: `<@${member.id}>`,
    username: member.user.username,
    server: guild.name,
    memberCount: String(guild.memberCount),
  };
}

async function announce(
  channelId: string,
  message: string,
  embed: boolean,
  member: GuildMember | PartialGuildMember,
): Promise<void> {
  const channel = member.guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return;

  const body = renderTemplate(message, placeholdersFor(member));
  if (embed) {
    await channel.send({ embeds: [new EmbedBuilder().setDescription(body)] });
  } else {
    await channel.send({ content: body });
  }
}

async function directMessage(
  message: string,
  member: GuildMember | PartialGuildMember,
): Promise<void> {
  const body = renderTemplate(message, placeholdersFor(member));
  // Members can close DMs or share no mutual server, and neither is something
  // a welcome message should ever fail loudly over.
  await member.user.send({ content: body }).catch(() => {});
}

export default defineModule({
  id: "welcome",
  name: "Welcome messages",
  summary: "Greets new members, assigns roles, and says goodbye when they leave.",
  category: "members",

  settings: s.object({
    join: s.object(
      {
      channel: s.channel({
        types: ["text"],
        optional: true,
        label: "Channel to greet in",
        help: "Left unset, no greeting is posted.",
      }),
      message: s.template({
        optional: true,
        placeholders: [...PLACEHOLDERS],
        label: "Greeting message",
      }),
      embed: s.boolean({ default: false, label: "Send the greeting as an embed" }),
      roles: s.array(s.role(), {
        label: "Roles to assign on join",
      }),
      dm: s.template({
        optional: true,
        placeholders: [...PLACEHOLDERS],
        label: "Direct message to the new member",
        help: "Sent in addition to the channel greeting, if the member allows DMs.",
      }),
      },
      { label: "When someone joins" },
    ),
    leave: s.object(
      {
      channel: s.channel({
        types: ["text"],
        optional: true,
        label: "Channel to post departures in",
        help: "Left unset, nothing is posted when a member leaves.",
      }),
      message: s.template({
        optional: true,
        placeholders: [...PLACEHOLDERS],
        label: "Farewell message",
      }),
      embed: s.boolean({ default: false, label: "Send the farewell as an embed" }),
      dm: s.template({
        optional: true,
        placeholders: [...PLACEHOLDERS],
        label: "Direct message to a departing member",
      }),
      },
      { label: "When someone leaves" },
    ),
  }),

  events: {
    async memberJoin(member, ctx) {
      const { join } = ctx.settings;
      const botHighest = ctx.guild.members.me?.roles.highest.position ?? 0;

      for (const roleId of join.roles) {
        const role = ctx.guild.roles.cache.get(roleId);
        if (!role) continue;
        if (!isRoleAssignable(role.position, botHighest)) {
          console.warn(
            `[welcome] cannot assign role ${role.name} in ${ctx.guild.name}: above the bot's own role`,
          );
          continue;
        }
        await member.roles.add(role).catch((error: unknown) => {
          console.warn(`[welcome] failed to assign role ${role.name} in ${ctx.guild.name}:`, error);
        });
      }

      if (join.channel && join.message) {
        await announce(join.channel, join.message, join.embed, member);
      }
      if (join.dm) {
        await directMessage(join.dm, member);
      }
    },

    async memberLeave(member, ctx) {
      const { leave } = ctx.settings;

      if (leave.channel && leave.message) {
        await announce(leave.channel, leave.message, leave.embed, member);
      }
      if (leave.dm) {
        await directMessage(leave.dm, member);
      }
    },
  },

  requires: ["ManageRoles"],
});
