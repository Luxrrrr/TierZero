import type { Guild, GuildMember } from "discord.js";
import { checkHierarchy, checkStanding, type HierarchyResult } from "./hierarchy.js";

/** Adapts the pure hierarchy rule to real discord.js objects. */
export function guardAgainstMember(
  guild: Guild,
  actor: GuildMember,
  target: GuildMember,
  requiresDiscordAction = true,
): HierarchyResult {
  return checkHierarchy({
    actorTopRole: actor.roles.highest.position,
    targetTopRole: target.roles.highest.position,
    botTopRole: guild.members.me?.roles.highest.position ?? 0,
    targetIsOwner: target.id === guild.ownerId,
    actorIsOwner: actor.id === guild.ownerId,
    requiresDiscordAction,
  });
}

/** The same rule for a dashboard actor, who may not be a member of the server. */
export function guardForDashboard(
  guild: Guild,
  actor: GuildMember | null,
  actorIsInstanceOwner: boolean,
  target: GuildMember,
  requiresDiscordAction = true,
): HierarchyResult {
  return checkStanding({
    actor: actor ? { topRole: actor.roles.highest.position, isServerOwner: actor.id === guild.ownerId } : null,
    actorIsInstanceOwner,
    target: { topRole: target.roles.highest.position, isServerOwner: target.id === guild.ownerId },
    botTopRole: guild.members.me?.roles.highest.position ?? 0,
    requiresDiscordAction,
  });
}
