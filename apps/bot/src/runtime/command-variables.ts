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

export function commandVariables(interaction: VariableSource): Record<string, string> {
  const guild = interaction.guild;
  const now = new Date();
  const channel = interaction.channel;
  return {
    server: guild?.name ?? "",
    members: guild ? guild.memberCount.toLocaleString("en-US") : "",
    channel: `<#${interaction.channelId}>`,
    "channel.name": channel && "name" in channel && typeof channel.name === "string" ? channel.name : "",
    date: discordTimestamp(now, "D"),
    time: discordTimestamp(now, "t"),
    now: discordTimestamp(now, "f"),
    sender: interaction.user.displayName,
    bot: guild?.members.me?.displayName ?? interaction.client.user?.username ?? "TierZero",
    "server.icon": guild?.iconURL({ size: 256 }) ?? "",
  };
}

export const stringValues = (values: ReplyValues): Record<string, string> =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));
