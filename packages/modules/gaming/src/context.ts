import type { GuildMember, MessageComponentInteraction, RepliableInteraction, Role } from "discord.js";
import type { MessageBody, ModuleContext, ReplyValues } from "@tier0/core";
import type { ReplyDefinition } from "./messages.js";
import type { GamingSettings } from "./settings.js";

export type GamingCtx = ModuleContext<GamingSettings>;

export type Answerable = RepliableInteraction | MessageComponentInteraction;

export const warn = (what: string) => (error: unknown) => console.warn(`[gaming] could not ${what}:`, error);

/** Replies to whoever used a command or button in the server's own words, falling back to the default wording. */
export async function answer(
  ctx: GamingCtx,
  interaction: Answerable,
  body: MessageBody,
  definition: ReplyDefinition,
  values: ReplyValues = {},
): Promise<void> {
  await ctx.reply(interaction, body, values, { fallback: definition.starting });
}

/** The server member behind an interaction, fetched when the interaction brought only the raw data. */
export async function memberOf(ctx: GamingCtx, interaction: Answerable): Promise<GuildMember | null> {
  if (interaction.member && "voice" in interaction.member) return interaction.member;
  return ctx.guild.members.fetch(interaction.user.id).catch(() => null);
}

export function hasAnyRole(member: GuildMember, roleIds: string[]): boolean {
  return roleIds.some((id) => member.roles.cache.has(id));
}

export const mention = (id: string) => `<@${id}>`;

export function roleMentions(roles: Iterable<Role | string>): string {
  return [...roles].map((role) => `<@&${typeof role === "string" ? role : role.id}>`).join(" ");
}

export function nameOf(member: GuildMember | null | undefined, fallback: string): string {
  return member?.displayName ?? fallback;
}
