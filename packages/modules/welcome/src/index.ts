import type { GuildMember, PartialGuildMember } from "discord.js";
import { defineModule, isRoleAssignable, s, type Infer, type MessageBody, type ModuleContext } from "@tier0/core";
import { JOIN_DM, JOIN_MESSAGE, LEAVE_DM, LEAVE_MESSAGE, VARIABLES, rolesTiming, upgradeGroup, upgradeWelcome, valuesFor } from "./messages.js";

type Member = GuildMember | PartialGuildMember;

const SCREENING_WINDOW_MS = 7 * 86_400_000;

/** The essential set: welcome does nothing until one of these is filled in. */
const WELCOME_DOES = "action";

const settingsSchema = s.object({
  ignoreBots: s.boolean({
    label: "Leave bots out",
    help: "Bots that join or leave get no greeting, farewell, direct message or roles.",
    default: true,
  }),
  join: s.object(
    {
      channel: s.channel({
        types: ["text"],
        optional: true,
        guided: true,
        essential: WELCOME_DOES,
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
      roles: s.array(s.role({ assigns: true }), {
        label: "Roles to give on join",
        essential: WELCOME_DOES,
      }),
      rolesWhen: s.choice({
        label: "When to give them",
        options: [
          { value: "join", label: "As soon as they join" },
          { value: "delay", label: "After a wait", description: "Gives the roles after the time below, if they are still on the server." },
          {
            value: "screening",
            label: "Once they accept the rules",
            description: "Waits for the member to finish the server's membership screening. Without screening, roles are given on join.",
          },
        ],
        default: "join",
        when: { field: "roles" },
      }),
      rolesDelay: s.duration({
        label: "Wait before giving them",
        default: "10m",
        min: "1m",
        max: "7d",
        when: { field: "rolesWhen", equals: "delay" },
      }),
      sendDm: s.boolean({ default: false, essential: WELCOME_DOES, label: "Send the new member a direct message" }),
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
        essential: WELCOME_DOES,
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
      sendDm: s.boolean({ default: false, essential: WELCOME_DOES, label: "Send a departing member a direct message" }),
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
}, { upgrade: upgradeWelcome });

type Ctx = ModuleContext<Infer<typeof settingsSchema>>;

async function announce(ctx: Ctx, channelId: string, message: MessageBody, starting: MessageBody, member: Member): Promise<void> {
  const channel = ctx.guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return;
  await ctx.send(channel, message, valuesFor(member), { fallback: starting });
}

// Members can close DMs or share no mutual server, and neither is something
// a welcome message should ever fail loudly over. ctx.send logs and moves on.
async function directMessage(ctx: Ctx, message: MessageBody, starting: MessageBody, member: Member): Promise<void> {
  await ctx.send(member.user, message, valuesFor(member), { fallback: starting });
}

async function giveJoinRoles(ctx: Ctx, member: GuildMember): Promise<void> {
  const botHighest = ctx.guild.members.me?.roles.highest.position ?? 0;
  for (const roleId of ctx.settings.join.roles) {
    if (member.roles.cache.has(roleId)) continue;
    const role = ctx.guild.roles.cache.get(roleId);
    if (!role) continue;
    if (!isRoleAssignable(role.position, botHighest)) {
      console.warn(`[welcome] cannot assign role ${role.name} in ${ctx.guild.name}: above the bot's own role`);
      continue;
    }
    await member.roles.add(role).catch((error: unknown) => {
      console.warn(`[welcome] failed to assign role ${role.name} in ${ctx.guild.name}:`, error);
    });
  }
}

const skipped = (ctx: Ctx, member: Member): boolean => ctx.settings.ignoreBots && member.user.bot === true;

export default defineModule({
  id: "welcome",
  name: "Welcome messages",
  summary: "Greets new members, assigns roles, and says goodbye when they leave.",
  category: "members",

  settings: settingsSchema,

  events: {
    async memberJoin(member, ctx) {
      if (skipped(ctx, member)) return;
      const { join } = ctx.settings;

      if (join.roles.length > 0) {
        const timing = rolesTiming(join.rolesWhen, member.pending);
        if (timing === "now") await giveJoinRoles(ctx, member);
        else if (timing === "later") {
          await ctx.tasks.schedule("giveRoles", new Date(Date.now() + join.rolesDelay), { userId: member.id });
        }
      }

      if (join.channel) {
        await announce(ctx, join.channel, join.message, JOIN_MESSAGE, member);
      }
      if (join.sendDm) {
        await directMessage(ctx, join.dm, JOIN_DM, member);
      }
    },

    async memberUpdate(before, after, ctx) {
      // Discord reports finishing membership screening as the member no longer being pending.
      const { roles, rolesWhen } = ctx.settings.join;
      if (rolesWhen !== "screening" || after.pending || roles.length === 0 || skipped(ctx, after)) return;
      if (before.pending === true) {
        await giveJoinRoles(ctx, after);
        return;
      }
      // A member the bot had not cached, say after a restart, arrives without
      // the earlier state. A recent joiner holding none of the roles is taken
      // to have just finished screening.
      const recent = after.joinedTimestamp !== null && Date.now() - after.joinedTimestamp < SCREENING_WINDOW_MS;
      if (before.partial && recent && !roles.some((id) => after.roles.cache.has(id))) await giveJoinRoles(ctx, after);
    },

    async memberLeave(member, ctx) {
      if (skipped(ctx, member)) return;
      if (ctx.settings.join.rolesWhen === "delay") await ctx.tasks.cancel("giveRoles", { userId: member.id });
      const { leave } = ctx.settings;

      if (leave.channel) {
        await announce(ctx, leave.channel, leave.message, LEAVE_MESSAGE, member);
      }
      if (leave.sendDm) {
        await directMessage(ctx, leave.dm, LEAVE_DM, member);
      }
    },
  },

  tasks: {
    async giveRoles(payload, ctx) {
      const member = await ctx.guild.members.fetch(String(payload.userId)).catch(() => null);
      if (member) await giveJoinRoles(ctx, member);
    },
  },

  requires: ["ManageRoles"],
});
