import type { Guild, GuildMember } from "discord.js";
import { checkHierarchy, type HierarchyResult } from "./hierarchy.js";

/** Adapts the pure hierarchy rule to real discord.js objects. */
export function guardAgainstMember(
  guild: Guild,
  actor: GuildMember,
  target: GuildMember,
): HierarchyResult {
  return checkHierarchy({
    actorTopRole: actor.roles.highest.position,
    targetTopRole: target.roles.highest.position,
    botTopRole: guild.members.me?.roles.highest.position ?? 0,
    targetIsOwner: target.id === guild.ownerId,
    actorIsOwner: actor.id === guild.ownerId,
  });
}
