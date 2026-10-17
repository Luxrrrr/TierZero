import { embedReply, emptyEmbed, plainReply, type MessageBody } from "@tier0/core";

/**
 * What each message says until the owner writes another. Kept free of
 * discord.js so the wording and the settings upgrade can be tested without a
 * client or a guild.
 */

export const JOIN_MESSAGE: MessageBody = embedReply("Welcome to {server}!", "info", { ping: "{user}" });
export const LEAVE_MESSAGE: MessageBody = embedReply("{username} has left {server}.", "info");
export const JOIN_DM: MessageBody = embedReply("Welcome to {server}! Have a look around, and say hello when you are ready.", "info");
export const LEAVE_DM: MessageBody = embedReply("You have left {server}. We hope to see you again.", "info");

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

/**
 * Whether a new member's roles are given now, later from a scheduled task, or
 * when they finish membership screening, which the bot hears about as an update.
 */
export function rolesTiming(when: string, pending: boolean | null | undefined): "now" | "later" | "screening" {
  if (when === "delay") return "later";
  if (when === "screening" && pending === true) return "screening";
  return "now";
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

/**
 * Servers that saved welcome settings before "Leave bots out" existed had bots
 * greeted, messaged and given roles, and a "Bots" auto-role relies on that. The
 * switch is off for them until the owner turns it on. A server that has stored
 * nothing gets the new default.
 */
export function upgradeWelcome(stored: Record<string, unknown>): Record<string, unknown> {
  if (stored.ignoreBots !== undefined || Object.keys(stored).length === 0) return stored;
  return { ...stored, ignoreBots: false };
}
