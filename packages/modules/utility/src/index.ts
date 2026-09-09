import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { defineModule, s } from "@tier0/core";

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

  settings: s.object({
    accent: s.choice({
      label: "Embed color",
      options: [
        { value: "blurple", label: "Blurple" },
        { value: "grey", label: "Grey" },
        { value: "green", label: "Green" },
      ],
      default: "blurple",
    }),
    showJoinDate: s.boolean({
      label: "Show join dates on /userinfo",
      default: true,
    }),
    hiddenIn: s.array(s.channel({ types: ["text"] }), {
      label: "Channels where these commands are ignored",
    }),
  }),

  commands: [
    {
      name: "ping",
      description: "Check whether the bot is responding, and how quickly.",
      build: () =>
        new SlashCommandBuilder()
          .setName("ping")
          .setDescription("Check whether the bot is responding, and how quickly."),
      async run(interaction, ctx) {
        const roundTrip = Date.now() - interaction.createdTimestamp;
        await interaction.reply({
          content: `Responding in ${roundTrip}ms, gateway at ${ctx.client.ws.ping}ms.`,
          flags: MessageFlags.Ephemeral,
        });
      },
    },
    {
      name: "serverinfo",
      description: "Show information about this server.",
      build: () =>
        new SlashCommandBuilder()
          .setName("serverinfo")
          .setDescription("Show information about this server."),
      async run(interaction, ctx) {
        const { guild } = ctx;
        const embed = new EmbedBuilder()
          .setTitle(guild.name)
          .setColor(accentOf(ctx.settings.accent))
          .setThumbnail(guild.iconURL())
          .addFields(
            { name: "Members", value: String(guild.memberCount), inline: true },
            { name: "Channels", value: String(guild.channels.cache.size), inline: true },
            { name: "Roles", value: String(guild.roles.cache.size), inline: true },
            {
              name: "Created",
              value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`,
            },
          );
        await interaction.reply({ embeds: [embed] });
      },
    },
    {
      name: "userinfo",
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

        const embed = new EmbedBuilder()
          .setTitle(target.username)
          .setColor(accentOf(ctx.settings.accent))
          .setThumbnail(target.displayAvatarURL())
          .addFields({
            name: "Account created",
            value: `<t:${Math.floor(target.createdTimestamp / 1000)}:D>`,
            inline: true,
          });

        if (member?.joinedTimestamp && ctx.settings.showJoinDate) {
          embed.addFields({
            name: "Joined server",
            value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`,
            inline: true,
          });
        }

        await interaction.reply({ embeds: [embed] });
      },
    },
  ],
});

const BLURPLE = 0x5865f2;

const ACCENTS: Record<string, number> = {
  blurple: BLURPLE,
  grey: 0x99aab5,
  green: 0x57f287,
};

// A guild can hold an accent from a choice list that has since changed, so
// fall back rather than handing discord.js undefined.
function accentOf(name: string): number {
  return ACCENTS[name] ?? BLURPLE;
}
