import { ContextMenuCommandBuilder, ApplicationCommandType, InteractionContextType, PermissionFlagsBits } from "discord.js";
import { defineModule, type ContextCommandDefinition } from "@tier0/core";
import { bodyFromMessage } from "./convert.js";
import { Settler } from "./debounce.js";
import { isPosted, live, postedChannels, remove, repost } from "./post.js";
import { settingsSchema, type StickySettings } from "./settings.js";

/**
 * A message that stays at the bottom of a channel. When someone talks, the bot
 * waits for a pause and posts it again below, then deletes the old copy. Which
 * channels have one is a setting, so it is edited from the dashboard, and the
 * right-click menu on a message is a shortcut that writes the same setting.
 */

/** A channel that never goes quiet still gets its sticky back this often. */
const CEILING_MS = 30_000;

const settler = new Settler(CEILING_MS);

/** The newest settings seen for each server, since the pause between a message and the repost can outlast a settings change. */
const latest = new Map<string, StickySettings>();

const channelKey = (guildId: string, channelId: string) => `${guildId}:${channelId}`;

function menuEntry(name: string, description: string, run: ContextCommandDefinition<StickySettings>["run"]): ContextCommandDefinition<StickySettings> {
  return {
    name,
    description,
    kind: "message",
    build: () =>
      new ContextMenuCommandBuilder()
        .setName(name)
        .setType(ApplicationCommandType.Message)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setContexts(InteractionContextType.Guild),
    run,
  };
}

const contextCommands: ContextCommandDefinition<StickySettings>[] = [
  menuEntry("Stick to channel", "Keep this message at the bottom of the channel.", async (interaction, ctx) => {
    const { messages } = ctx.settings;
    const here = { channel: `<#${interaction.channelId}>` };
    if (!interaction.isMessageContextMenuCommand()) return;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await ctx.reply(interaction, messages.notAllowed, here);
      return;
    }
    const channel = ctx.guild.channels.cache.get(interaction.channelId);
    if (!channel?.isTextBased() || channel.isThread()) {
      await ctx.reply(interaction, messages.failed, here);
      return;
    }
    const body = bodyFromMessage(interaction.targetMessage);
    if (!body) {
      await ctx.reply(interaction, messages.empty, here);
      return;
    }

    const rows = ctx.settings.stickies;
    const existing = rows.find((row) => row.channel === channel.id);
    if (!existing && rows.length >= 25) {
      await ctx.reply(interaction, messages.failed, here);
      return;
    }
    const row = { name: existing?.name || `#${"name" in channel ? channel.name : "channel"}`, channel: channel.id, enabled: true, message: body, pause: existing?.pause ?? 5000 };
    await interaction.deferReply({ flags: 64 });
    await ctx.update({ stickies: existing ? rows.map((entry) => (entry === existing ? row : entry)) : [...rows, row] });
    await ctx.reply(interaction, messages.stuck, here);
  }),

  menuEntry("Unstick from channel", "Stop keeping a message at the bottom of this channel.", async (interaction, ctx) => {
    const { messages } = ctx.settings;
    const here = { channel: `<#${interaction.channelId}>` };
    if (!interaction.isMessageContextMenuCommand()) return;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await ctx.reply(interaction, messages.notAllowed, here);
      return;
    }
    const rows = ctx.settings.stickies;
    if (!rows.some((row) => row.channel === interaction.channelId) && !(await isPosted(ctx.guild.id, interaction.channelId))) {
      await ctx.reply(interaction, messages.nothing, here);
      return;
    }
    await interaction.deferReply({ flags: 64 });
    await ctx.update({ stickies: rows.filter((row) => row.channel !== interaction.channelId) });
    await ctx.reply(interaction, messages.unstuck, here);
  }),
];

export default defineModule({
  id: "sticky",
  name: "Sticky messages",
  summary: "Keep a message at the bottom of a channel, such as the rules or how to get help.",
  category: "engagement",
  requires: ["ViewChannel", "SendMessages", "ManageMessages"],

  settings: settingsSchema,
  contextCommands,

  events: {
    async messageCreate(message, ctx) {
      if (message.author.id === ctx.client.user?.id) return;
      latest.set(ctx.guild.id, ctx.settings);
      const row = live(ctx.settings).find((entry) => entry.channel === message.channelId);
      if (!row?.channel) return;
      const guildId = ctx.guild.id;
      const channelId = row.channel;
      settler.touch(channelKey(guildId, channelId), row.pause, async () => {
        const current = live(latest.get(guildId) ?? ctx.settings).find((entry) => entry.channel === channelId);
        if (current) await repost(ctx, current);
      });
    },
  },

  rows: {
    stickies: {
      actions: {
        repost: {
          label: "Post it again now",
          help: "Posts the message at the bottom of the channel right away and deletes the old copy.",
          async run({ ctx, row }) {
            const channelId = typeof row.row.channel === "string" ? row.row.channel : "";
            const current = ctx.settings.stickies.find((entry) => entry.channel === channelId);
            if (!current) return { ok: false, message: "Pick a channel and save first." };
            if (!current.enabled) return { ok: false, message: "This one is switched off." };
            const done = await repost(ctx, current);
            return done ? { ok: true, message: "Posted." } : { ok: false, message: "Could not post there. Check that the bot can view the channel and send messages in it." };
          },
        },
      },
    },
  },

  async onEnable(ctx) {
    latest.set(ctx.guild.id, ctx.settings);
    for (const row of live(ctx.settings)) {
      if (row.channel && !(await isPosted(ctx.guild.id, row.channel))) await repost(ctx, row);
    }
  },

  async onDisable(ctx) {
    latest.delete(ctx.guild.id);
    for (const channelId of await postedChannels(ctx.guild.id)) {
      settler.cancel(channelKey(ctx.guild.id, channelId));
      await remove(ctx, channelId);
    }
  },

  async onSettingsChange(ctx, previous) {
    latest.set(ctx.guild.id, ctx.settings);
    const now = live(ctx.settings);
    const wanted = new Set(now.map((row) => row.channel));

    for (const channelId of await postedChannels(ctx.guild.id)) {
      if (wanted.has(channelId)) continue;
      settler.cancel(channelKey(ctx.guild.id, channelId));
      await remove(ctx, channelId);
    }

    for (const row of now) {
      if (!row.channel) continue;
      const before = live(previous).find((entry) => entry.channel === row.channel);
      const same = before && JSON.stringify(before.message) === JSON.stringify(row.message);
      if (same && (await isPosted(ctx.guild.id, row.channel))) continue;
      await repost(ctx, row);
    }
  },
});
