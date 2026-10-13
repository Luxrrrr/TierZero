import { emptyEmbed, plainReply, type MessageBody } from "@tier0/core";

/**
 * What each message says until the owner writes another. Kept free of
 * discord.js so the wording and the settings upgrade can be tested without a
 * client or a guild.
 */

export const JOIN_MESSAGE: MessageBody = plainReply("Welcome to {server}, {user}!");
export const LEAVE_MESSAGE: MessageBody = plainReply("{username} has left {server}.");
export const JOIN_DM: MessageBody = plainReply("Welcome to {server}! Have a look around, and say hello when you are ready.");
export const LEAVE_DM: MessageBody = plainReply("You have left {server}. We hope to see you again.");

export const VARIABLES = [
  { name: "user", description: "The member, as a mention", sample: "@Ada" },
  { name: "username", description: "The member's name, without a mention", sample: "Ada" },
  { name: "server", description: "The server's name", sample: "Northwind" },
  { name: "memberCount", description: "How many members the server has", sample: "128" },
];

export interface MemberLike {
  id: string;
  user: { username: string };
  guild: { name: string; memberCount: number };
}

export function valuesFor(member: MemberLike): Record<string, string> {
  return {
    user: `<@${member.id}>`,
    username: member.user.username,
    server: member.guild.name,
    memberCount: String(member.guild.memberCount),
  };
}

const isBlank = (value: unknown): boolean => typeof value === "string" && value.trim() === "";

/**
 * Reads a group saved before the greeting was a full message. The text becomes
 * a plain message, or the description of an embed when the owner had turned
 * "send as an embed" on, and a direct message that was set counts as switched
 * on. A value that is already current passes through unchanged.
 */
export function upgradeGroup(stored: Record<string, unknown>): Record<string, unknown> {
  const next = { ...stored };
  const asEmbed = next.embed === true;
  delete next.embed;

  if (typeof next.message === "string") {
    if (isBlank(next.message)) delete next.message;
    else next.message = asEmbed ? { ...plainReply(""), embeds: [{ ...emptyEmbed(), description: next.message }] } : plainReply(next.message);
  }

  if (isBlank(next.dm)) delete next.dm;
  if (next.dm !== undefined && next.dm !== null && typeof next.sendDm !== "boolean") next.sendDm = true;
  return next;
}
