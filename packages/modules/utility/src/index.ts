import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { defineModule, s } from "@tier0/core";
import {
  PING_PLACEHOLDERS,
  PING_STARTING,
  SERVERINFO_PLACEHOLDERS,
  USERINFO_PLACEHOLDERS,
  serverinfoBody,
  userinfoBody,
  UNKNOWN,
} from "./messages.js";

/**
 * The proving module for the runtime. It exists to exercise every part of the
 * pipeline end to end: schema, dashboard form, command registration, and hot
 * reload on a settings change. Keep it small.
 */
export default defineModule({
  id: "utility",
  name: "Utility",
  summary: "Server and member information commands.",
  category: "utility",

  // Nothing to configure here: the replies are edited on the Commands page.
  settings: s.object({}),

  // A page with no settings at all reads as broken without a line saying that is expected.
  async notices() {
    return [{ tone: "info" as const, text: "There is nothing to set up for this feature. Use Customize on a command below to reword its reply." }];
  },

  commands: [
    {
      name: "ping",
      response: {
        starting: PING_STARTING,
        placeholders: PING_PLACEHOLDERS,
      },
      description: "Check whether the bot is responding, and how quickly.",
      build: () =>
        new SlashCommandBuilder()
          .setName("ping")
          .setDescription("Check whether the bot is responding, and how quickly."),
      async run(interaction, ctx) {
        const values = { roundtrip: Date.now() - interaction.createdTimestamp, gateway: ctx.client.ws.ping };
        const custom = ctx.customReply?.(values);
        if (custom) await interaction.reply({ ...custom, flags: MessageFlags.Ephemeral });
        else await ctx.reply(interaction, PING_STARTING, values);
      },
    },
    {
      name: "serverinfo",
      publicReply: true,
      response: {
        starting: serverinfoBody(),
        placeholders: SERVERINFO_PLACEHOLDERS,
      },
      description: "Show information about this server.",
      build: () =>
        new SlashCommandBuilder()
          .setName("serverinfo")
          .setDescription("Show information about this server."),
      async run(interaction, ctx) {
        const { guild } = ctx;
        const values = {
          channels: guild.channels.cache.size,
          roles: guild.roles.cache.size,
          created: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`,
        };
        const custom = ctx.customReply?.(values);
        if (custom) {
          await interaction.reply(custom);
          return;
        }
        // These two keep the plain forms the standard reply has always shown: no thousands separator, the icon at Discord's own size.
        await ctx.reply(
          interaction,
          serverinfoBody(),
          { ...values, members: guild.memberCount, "server.icon": guild.iconURL() ?? "" },
          { ephemeral: false },
        );
      },
    },
    {
      name: "userinfo",
      publicReply: true,
      response: {
        starting: userinfoBody(),
        placeholders: USERINFO_PLACEHOLDERS,
      },
      description: "Show information about a member.",
      build: () =>
        new SlashCommandBuilder()
          .setName("userinfo")
          .setDescription("Show information about a member.")
          .addUserOption((option) =>
            option.setName("member").setDescription("Defaults to you."),
          ),
      async run(interaction, ctx) {
        const target = interaction.options.getUser("member") ?? interaction.user;
        const member = await ctx.guild.members.fetch(target.id).catch(() => null);

        const joined = member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : null;
        const values = {
          user: target.username,
          "user.avatar": target.displayAvatarURL(),
          created: `<t:${Math.floor(target.createdTimestamp / 1000)}:D>`,
        };
        const custom = ctx.customReply?.({ ...values, joined: joined ?? UNKNOWN });
        if (custom) {
          await interaction.reply(custom);
          return;
        }
        // A join date that is not known leaves the line out of the standard reply, as an empty value does.
        await ctx.reply(
          interaction,
          userinfoBody(),
          { ...values, joined: joined ?? "" },
          { ephemeral: false },
        );
      },
    },
  ],
});
