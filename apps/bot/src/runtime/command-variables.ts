import type { Client, Guild, TextBasedChannel, User } from "discord.js";
import { discordTimestamp, type ReplyValues } from "@tier0/core";

/**
 * The variables every message has, filled in for a command that was just run.
 * `{sender}` here is the person who ran it, and `{channel}` the channel it was
 * run in, which is the nearest thing a command has to the Messages page's send.
 */
export interface VariableSource {
  guild: Guild | null;
  user: User;
  channelId: string;
  channel: TextBasedChannel | null;
  client: Client;
}

export interface GlobalVariableSource {
  guild: Guild | null;
  client: Client;
  sender: string;
  /** Left out for a message that is not going to a channel. */
  channel?: { id: string; name?: string } | null;
}

/** The names in MESSAGE_VARIABLES, for one message about to be sent. */
export function globalVariables({ guild, client, sender, channel }: GlobalVariableSource): Record<string, string> {
  const now = new Date();
  return {
    server: guild?.name ?? "",
    members: guild ? guild.memberCount.toLocaleString("en-US") : "",
    channel: channel ? `<#${channel.id}>` : "",
    "channel.name": channel?.name ?? "",
    date: discordTimestamp(now, "D"),
    time: discordTimestamp(now, "t"),
    now: discordTimestamp(now, "f"),
    sender,
    bot: guild?.members.me?.displayName ?? client.user?.username ?? "TierZero",
    "server.icon": guild?.iconURL({ size: 256 }) ?? "",
  };
}

export function commandVariables(interaction: VariableSource): Record<string, string> {
  const channel = interaction.channel;
  return globalVariables({
    guild: interaction.guild,
    client: interaction.client,
    sender: interaction.user.displayName,
    channel: {
      id: interaction.channelId,
      ...(channel && "name" in channel && typeof channel.name === "string" ? { name: channel.name } : {}),
    },
  });
}

export const stringValues = (values: ReplyValues): Record<string, string> =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));
