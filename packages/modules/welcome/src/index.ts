import type { GuildMember, PartialGuildMember } from "discord.js";
import { defineModule, isRoleAssignable, s, type MessageBody, type ModuleContext } from "@tier0/core";
import { JOIN_DM, JOIN_MESSAGE, LEAVE_DM, LEAVE_MESSAGE, VARIABLES, upgradeGroup, valuesFor } from "./messages.js";

type Member = GuildMember | PartialGuildMember;

async function announce(ctx: ModuleContext, channelId: string, message: MessageBody, starting: MessageBody, member: Member): Promise<void> {
  const channel = ctx.guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return;
  await ctx.send(channel, message, valuesFor(member), { fallback: starting });
}

// Members can close DMs or share no mutual server, and neither is something
// a welcome message should ever fail loudly over. ctx.send logs and moves on.
async function directMessage(ctx: ModuleContext, message: MessageBody, starting: MessageBody, member: Member): Promise<void> {
  await ctx.send(member.user, message, valuesFor(member), { fallback: starting });
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
          guided: true,
          label: "Channel to greet in",
          help: "Left unset, no greeting is posted.",
        }),
        message: s.message({
          guided: true,
          label: "Greeting message",
          help: "Posted in the channel above.",
          starting: JOIN_MESSAGE,
          variables: VARIABLES,
          when: { field: "channel" },
        }),
        roles: s.array(s.role(), {
          label: "Roles to assign on join",
        }),
        sendDm: s.boolean({ default: false, label: "Send the new member a direct message" }),
        dm: s.message({
          label: "Direct message to the new member",
          help: "Sent in addition to the channel greeting, if the member allows DMs.",
          delivery: "dm",
          starting: JOIN_DM,
          variables: VARIABLES,
          when: { field: "sendDm", equals: true },
        }),
      },
      { label: "When someone joins", upgrade: upgradeGroup },
    ),
    leave: s.object(
      {
        channel: s.channel({
          types: ["text"],
          optional: true,
          label: "Channel to post departures in",
          help: "Left unset, nothing is posted when a member leaves.",
        }),
        message: s.message({
          label: "Farewell message",
          help: "Posted in the channel above.",
          starting: LEAVE_MESSAGE,
          variables: VARIABLES,
          when: { field: "channel" },
        }),
        sendDm: s.boolean({ default: false, label: "Send a departing member a direct message" }),
        dm: s.message({
          label: "Direct message to a departing member",
          delivery: "dm",
          starting: LEAVE_DM,
          variables: VARIABLES,
          when: { field: "sendDm", equals: true },
        }),
      },
      { label: "When someone leaves", upgrade: upgradeGroup },
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

      if (join.channel) {
        await announce(ctx, join.channel, join.message, JOIN_MESSAGE, member);
      }
      if (join.sendDm) {
        await directMessage(ctx, join.dm, JOIN_DM, member);
      }
    },

    async memberLeave(member, ctx) {
      const { leave } = ctx.settings;

      if (leave.channel) {
        await announce(ctx, leave.channel, leave.message, LEAVE_MESSAGE, member);
      }
      if (leave.sendDm) {
        await directMessage(ctx, leave.dm, LEAVE_DM, member);
      }
    },
  },

  requires: ["ManageRoles"],
});
