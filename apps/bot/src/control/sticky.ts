import type { Guild } from "discord.js";
import type { MessageBody, ModuleRegistry } from "@tier0/core";
import { prisma } from "@tier0/db";
import type { GuildState, Resync } from "../runtime/guild-state.js";

/** Keeps a message just sent from the Message creator at the bottom of its channel. Resolves to a note for the person when something stops it. */
export type StickyKeeper = (channelId: string, message: MessageBody, messageId: string) => Promise<string | null>;

const MAX_STICKIES = 25;

const parseJson = (text: string): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/**
 * Makes the message that was just sent the channel's sticky message: the
 * message stays where it is as the current copy, and the Sticky messages
 * feature moves it from then on. It goes through the same settings update the
 * dashboard uses, so the feature picks it up without a restart. Buttons, menus
 * and reactions don't carry over, because the feature can't answer them.
 */
export function stickyKeeper(guild: Guild, registry: ModuleRegistry, state: GuildState, resync: Resync): StickyKeeper {
  return async (channelId, message, messageId) => {
    if (!registry.get("sticky")) return "Sticky messages isn't part of this bot, so the message was sent but won't stay at the bottom.";

    const row = await prisma.guildModule.findUnique({ where: { guildId_moduleId: { guildId: guild.id, moduleId: "sticky" } } });
    const resolved = registry.resolveSettings("sticky", row ? parseJson(row.settings) : {});
    if (!resolved.ok) return "The message was sent, but Sticky messages' settings can't be read, so it won't stay at the bottom.";
    const settings = resolved.value as { stickies: { name?: string; channel?: string; enabled: boolean; message: MessageBody; pause: number }[] };

    const existing = settings.stickies.find((entry) => entry.channel === channelId);
    if (!existing && settings.stickies.length >= MAX_STICKIES) {
      return `The message was sent, but Sticky messages already has ${MAX_STICKIES} channels, so it won't stay at the bottom.`;
    }

    const channel = guild.channels.cache.get(channelId);
    const entry = {
      name: existing?.name || `#${channel && "name" in channel ? channel.name : "channel"}`,
      channel: channelId,
      enabled: true,
      message: { ...message, buttons: [], selects: [], reactions: [] },
      pause: existing?.pause ?? 5000,
    };
    const stickies = existing ? settings.stickies.map((other) => (other === existing ? entry : other)) : [...settings.stickies, entry];

    const check = registry.resolveSettings("sticky", { ...settings, stickies });
    if (!check.ok) return `The message was sent, but it can't be kept at the bottom: ${check.errors[0]?.message ?? "it doesn't fit."}`;

    // The message just sent becomes the current copy, so the feature doesn't post it a second time.
    const old = await prisma.stickyPost.findUnique({ where: { guildId_channelId: { guildId: guild.id, channelId } } });
    await prisma.stickyPost.upsert({
      where: { guildId_channelId: { guildId: guild.id, channelId } },
      create: { guildId: guild.id, channelId, messageId },
      update: { messageId },
    });
    if (old && old.messageId !== messageId) {
      const target = channel?.isTextBased() ? channel : null;
      await target?.messages.delete(old.messageId).catch(() => {});
    }

    const result = await state.applyModuleUpdate(guild, "sticky", { settings: check.value }, resync);
    if (!result.ok) return `The message was sent, but it can't be kept at the bottom: ${result.errors[0]?.message ?? "the settings were refused."}`;

    if (!(row?.enabled ?? false)) {
      return "Sticky messages is switched off, so the message won't move until you turn it on.";
    }
    return null;
  };
}
