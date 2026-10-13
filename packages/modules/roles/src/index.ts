import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits, SlashCommandBuilder,
} from "discord.js";
import { customId, defineModule, isRoleAssignable, s, type Infer, type ModuleContext } from "@tier0/core";
import { prisma } from "@tier0/db";
import { computeToggle } from "./toggle.js";
import { parseMapping, serializeMapping, type MenuMapping } from "./mapping.js";
import {
  GAVE_MESSAGE,
  MENU_MESSAGE,
  MENU_VARIABLES,
  PUBLISHED_MESSAGE,
  PUBLISHED_VARIABLES,
  REMOVED_MESSAGE,
  TOGGLE_VARIABLES,
  upgradeMenu,
} from "./messages.js";

const MAX_BUTTONS_PER_ROW = 5;

const optionField = s.object({
  emoji: s.emoji({ optional: true, label: "Emoji" }),
  label: s.string({ label: "Label", max: 80 }),
  role: s.role({ label: "Role to grant" }),
});

type OptionSettings = Infer<typeof optionField>;

const menuField = s.object(
  {
    name: s.string({ label: "Menu name", max: 100 }),
    channel: s.channel({ types: ["text"], label: "Channel to post in" }),
    message: s.message({
      label: "Menu message",
      note: "The role buttons are added under this message for you.",
      starting: MENU_MESSAGE,
      variables: MENU_VARIABLES,
      components: false,
    }),
    exclusive: s.boolean({
      default: false,
      label: "Picking one option clears the others",
      help: "Turn this on for menus like platform or rank where only one choice makes sense.",
    }),
    options: s.array(optionField, { min: 1, max: 25, label: "Options" }),
  },
  { upgrade: upgradeMenu },
);

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
async function publishMenu(ctx: ModuleContext, menu: MenuSettings): Promise<PublishResult> {
  const guild = ctx.guild;
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

  const values = { menu: menu.name };
  const options = { fallback: MENU_MESSAGE, rows: buildRows(menu.options) };

  const guildMenus = await prisma.reactionRoleMenu.findMany({ where: { guildId: guild.id } });
  const existing = guildMenus.find((row) => parseMapping(row.mapping).name === menu.name);

  if (existing && existing.channelId === channel.id) {
    const message = await channel.messages.fetch(existing.messageId).catch(() => null);
    if (message) {
      const edited = await ctx.edit(message, menu.message, values, options);
      // Not falling through to a repost: that would delete the live menu over a message that cannot be built.
      if (!edited) return { ok: false, reason: "I couldn't update the menu message. Check that I can still edit it." };
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

  const posted = await ctx.send(channel, menu.message, values, options);
  if (!posted) {
    return { ok: false, reason: "I couldn't post the menu there. Check that I can send messages and embed links in that channel." };
  }
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
    replies: s.object(
      {
        gave: s.message({
          label: "When a role is given",
          starting: GAVE_MESSAGE,
          variables: TOGGLE_VARIABLES,
          delivery: "dm",
          components: false,
          note: "Only the member who pressed the button sees this.",
        }),
        removed: s.message({
          label: "When a role is taken away",
          starting: REMOVED_MESSAGE,
          variables: TOGGLE_VARIABLES,
          delivery: "dm",
          components: false,
          note: "Only the member who pressed the button sees this.",
        }),
        published: s.message({
          label: "After /rolemenu publishes a menu",
          starting: PUBLISHED_MESSAGE,
          variables: PUBLISHED_VARIABLES,
          delivery: "dm",
          components: false,
          note: "Only the moderator who ran the command sees this.",
        }),
      },
      { label: "Replies" },
    ),
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

        const result = await publishMenu(ctx, menu);
        if (!result.ok) {
          await interaction.reply({ content: result.reason, flags: MessageFlags.Ephemeral });
          return;
        }
        await ctx.reply(
          interaction,
          ctx.settings.replies.published,
          { menu: menu.name, menuChannel: `<#${menu.channel}>` },
          { fallback: PUBLISHED_MESSAGE },
        );
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

      await ctx.reply(
        interaction,
        willGrant ? ctx.settings.replies.gave : ctx.settings.replies.removed,
        { role: role.name, menu: mapping.name },
        { fallback: willGrant ? GAVE_MESSAGE : REMOVED_MESSAGE },
      );
    },
  },

  requires: ["ManageRoles"],
});
