import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { defineModule, emptyEmbed, plainReply, s } from "@tier0/core";

/**
 * The proving module for the runtime. It exists to exercise every part of the
 * pipeline end to end: schema, dashboard form, command registration, and hot
 * reload on a settings change. Keep it small.
 */
const PING_REPLY = "Responding in {roundtrip}ms, gateway at {gateway}ms.";

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
  }),

  commands: [
    {
      name: "ping",
      response: {
        starting: plainReply(PING_REPLY),
        placeholders: [
          { name: "roundtrip", description: "Milliseconds from your command to the bot", sample: "84" },
          { name: "gateway", description: "The bot's gateway latency in milliseconds", sample: "61" },
        ],
      },
      description: "Check whether the bot is responding, and how quickly.",
      build: () =>
        new SlashCommandBuilder()
          .setName("ping")
          .setDescription("Check whether the bot is responding, and how quickly."),
      async run(interaction, ctx) {
        const roundTrip = Date.now() - interaction.createdTimestamp;
        const custom = ctx.customReply?.({ roundtrip: roundTrip, gateway: ctx.client.ws.ping });
        await interaction.reply({
          ...(custom ?? { content: `Responding in ${roundTrip}ms, gateway at ${ctx.client.ws.ping}ms.` }),
          flags: MessageFlags.Ephemeral,
        });
      },
    },
    {
      name: "serverinfo",
      publicReply: true,
      response: {
        starting: {
          content: "",
          embeds: [
            {
              ...emptyEmbed(),
              title: "{server}",
              color: "#5865f2",
              thumbnailUrl: "{server.icon}",
              fields: [
                { name: "Members", value: "{members}", inline: true },
                { name: "Channels", value: "{channels}", inline: true },
                { name: "Roles", value: "{roles}", inline: true },
                { name: "Created", value: "{created}", inline: false },
              ],
            },
          ],
          buttons: [],
          selects: [],
          reactions: [],
        },
        placeholders: [
          { name: "channels", description: "How many channels the server has", sample: "34" },
          { name: "roles", description: "How many roles the server has", sample: "18" },
          { name: "created", description: "The day the server was created", sample: "March 3, 2021" },
        ],
      },
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
        const custom = ctx.customReply?.({
          channels: guild.channels.cache.size,
          roles: guild.roles.cache.size,
          created: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`,
        });
        await interaction.reply(custom ?? { embeds: [embed] });
      },
    },
    {
      name: "userinfo",
      publicReply: true,
      response: {
        starting: {
          content: "",
          embeds: [
            {
              ...emptyEmbed(),
              title: "{user}",
              color: "#5865f2",
              thumbnailUrl: "{user.avatar}",
              fields: [
                { name: "Account created", value: "{created}", inline: true },
                { name: "Joined server", value: "{joined}", inline: true },
              ],
            },
          ],
          buttons: [],
          selects: [],
          reactions: [],
        },
        placeholders: [
          { name: "user", description: "The member's username", sample: "spamlord_42" },
          { name: "user.avatar", description: "The member's picture, for an image or thumbnail", sample: "" },
          { name: "created", description: "The day their account was created", sample: "June 9, 2019" },
          { name: "joined", description: "The day they joined this server", sample: "January 14, 2023" },
        ],
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

        const custom = ctx.customReply?.({
          user: target.username,
          "user.avatar": target.displayAvatarURL(),
          created: `<t:${Math.floor(target.createdTimestamp / 1000)}:D>`,
          joined: member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : "Unknown",
        });
        await interaction.reply(custom ?? { embeds: [embed] });
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
// this falls back instead of handing discord.js undefined.
function accentOf(name: string): number {
  return ACCENTS[name] ?? BLURPLE;
}
