import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits, SlashCommandBuilder,
  type Guild,
} from "discord.js";
import { customId, defineModule, isRoleAssignable, s, type Infer } from "@tier0/core";
import { prisma } from "@tier0/db";
import { computeToggle } from "./toggle.js";
import { parseMapping, serializeMapping, type MenuMapping } from "./mapping.js";

const MAX_BUTTONS_PER_ROW = 5;

const optionField = s.object({
  emoji: s.emoji({ optional: true, label: "Emoji" }),
  label: s.string({ label: "Label", max: 80 }),
  role: s.role({ label: "Role to grant" }),
});

type OptionSettings = Infer<typeof optionField>;

const menuField = s.object({
  name: s.string({ label: "Menu name", max: 100 }),
  channel: s.channel({ types: ["text"], label: "Channel to post in" }),
  title: s.string({ label: "Title", max: 256 }),
  description: s.string({ optional: true, multiline: true, max: 2000, label: "Description" }),
  exclusive: s.boolean({
    default: false,
    label: "Picking one option clears the others",
    help: "Turn this on for menus like pronouns or color where only one choice makes sense.",
  }),
  options: s.array(optionField, { min: 1, max: 25, label: "Options" }),
});

type MenuSettings = Infer<typeof menuField>;

function buildRows(options: OptionSettings[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < options.length; i += MAX_BUTTONS_PER_ROW) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const option of options.slice(i, i + MAX_BUTTONS_PER_ROW)) {
      const button = new ButtonBuilder()
        .setCustomId(customId("roles", "toggle", option.role))
        .setLabel(option.label)
        .setStyle(ButtonStyle.Secondary);
      if (option.emoji) button.setEmoji(option.emoji);
      row.addComponents(button);
    }
    rows.push(row);
  }
  return rows;
}

type PublishResult = { ok: true } | { ok: false; reason: string };

/**
 * Posts a menu, or edits its existing message when one is already published.
 * The lookup goes through the stored mapping's name. There is no column for
 * it, since ReactionRoleMenu has no notion of a menu beyond the message it
 * backs.
 */
async function publishMenu(guild: Guild, menu: MenuSettings): Promise<PublishResult> {
  const channel = guild.channels.cache.get(menu.channel);
  if (!channel || !channel.isTextBased()) {
    return { ok: false, reason: "The channel configured for this menu no longer exists." };
  }

  const mapping: MenuMapping = {
    name: menu.name,
    exclusive: menu.exclusive,
    options: menu.options.map((option) => ({
      role: option.role,
      label: option.label,
      ...(option.emoji ? { emoji: option.emoji } : {}),
    })),
  };

  const embed = new EmbedBuilder().setTitle(menu.title);
  if (menu.description) embed.setDescription(menu.description);
  const components = buildRows(menu.options);

  const guildMenus = await prisma.reactionRoleMenu.findMany({ where: { guildId: guild.id } });
  const existing = guildMenus.find((row) => parseMapping(row.mapping).name === menu.name);

  if (existing && existing.channelId === channel.id) {
    const message = await channel.messages.fetch(existing.messageId).catch(() => null);
    if (message) {
      await message.edit({ embeds: [embed], components });
      await prisma.reactionRoleMenu.update({
        where: { id: existing.id },
        data: { mapping: serializeMapping(mapping) },
      });
      return { ok: true };
    }
  }

  if (existing) {
    // The message was moved to a different channel or deleted out from under
    // us. Drop the stale row here instead of leaving two live copies behind.
    const oldChannel = guild.channels.cache.get(existing.channelId);
    if (oldChannel?.isTextBased()) {
      await oldChannel.messages.delete(existing.messageId).catch(() => {});
    }
    await prisma.reactionRoleMenu.delete({ where: { id: existing.id } }).catch(() => {});
  }

  const posted = await channel.send({ embeds: [embed], components });
  await prisma.reactionRoleMenu.create({
    data: {
      guildId: guild.id,
      channelId: channel.id,
      messageId: posted.id,
      mapping: serializeMapping(mapping),
    },
  });
  return { ok: true };
}

export default defineModule({
  id: "roles",
  name: "Self-service roles",
  summary: "Button-driven role menus members can use to opt into roles.",
  category: "members",

  settings: s.object({
    menus: s.array(menuField, { label: "Role menus" }),
  }),

  commands: [
    {
      name: "rolemenu",
      description: "Publish or refresh a self-service role menu.",
      build: () =>
        new SlashCommandBuilder()
          .setName("rolemenu")
          .setDescription("Publish or refresh a self-service role menu.")
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
          .addStringOption((option) =>
            option
              .setName("name")
              .setDescription("The menu's name, as set on the dashboard.")
              .setRequired(true),
          ),
      async run(interaction, ctx) {
        const name = interaction.options.getString("name", true);
        const menu = ctx.settings.menus.find((candidate) => candidate.name === name);
        if (!menu) {
          await interaction.reply({
            content: `No role menu named "${name}" is configured. Add one on the dashboard first.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const result = await publishMenu(ctx.guild, menu);
        await interaction.reply({
          content: result.ok
            ? `Published "${menu.name}" in <#${menu.channel}>.`
            : result.reason,
          flags: MessageFlags.Ephemeral,
        });
      },
    },
  ],

  components: {
    async toggle(interaction, { rest, ctx }) {
      if (!interaction.isButton()) return;
      const roleId = rest;

      const row = await prisma.reactionRoleMenu.findUnique({
        where: { messageId: interaction.message.id },
      });
      if (!row) {
        await interaction.reply({
          content: "This menu is no longer active. Ask a moderator to republish it.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const mapping = parseMapping(row.mapping);
      const option = mapping.options.find((candidate) => candidate.role === roleId);
      const role = ctx.guild.roles.cache.get(roleId);
      if (!option || !role) {
        await interaction.reply({
          content: "That option is no longer part of this menu.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const member = await ctx.guild.members.fetch(interaction.user.id);
      const menuRoleIds = mapping.options.map((candidate) => candidate.role);
      const current = menuRoleIds.filter((id) => member.roles.cache.has(id));
      const willGrant = !current.includes(roleId);

      const botHighest = ctx.guild.members.me?.roles.highest.position ?? 0;
      if (willGrant && !isRoleAssignable(role.position, botHighest)) {
        await interaction.reply({
          content: `I can't give you **${role.name}** because that role sits above my own highest role. Ask an admin to move my role above it.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const { toAdd, toRemove } = computeToggle(current, roleId, menuRoleIds, mapping.exclusive);
      for (const id of toRemove) await member.roles.remove(id).catch(() => {});
      for (const id of toAdd) await member.roles.add(id).catch(() => {});

      await interaction.reply({
        content: willGrant ? `Gave you **${role.name}**.` : `Removed **${role.name}**.`,
        flags: MessageFlags.Ephemeral,
      });
    },
  },

  requires: ["ManageRoles"],
});
