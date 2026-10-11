import type { Guild, GuildBan, GuildMember } from "discord.js";
import { ActionRefused, LOOKUP_FAILED, describeDiscordError, isAbsentBan, isAbsentMember } from "./action-rules.js";

/**
 * A member of the server, or null when Discord says they are not one. Any
 * other failure refuses the action rather than reading as a departure.
 */
export async function fetchMemberOrNull(guild: Guild, userId: string): Promise<GuildMember | null> {
  try {
    return await guild.members.fetch(userId);
  } catch (error) {
    if (isAbsentMember(error)) return null;
    console.warn(`moderation: member lookup failed in guild ${guild.id}: ${describeDiscordError(error)}`);
    throw new ActionRefused(502, LOOKUP_FAILED);
  }
}

/** The ban on a user, or null when Discord says there is none. Any other failure refuses. */
export async function fetchBanOrNull(guild: Guild, userId: string): Promise<GuildBan | null> {
  try {
    return await guild.bans.fetch(userId);
  } catch (error) {
    if (isAbsentBan(error)) return null;
    console.warn(`moderation: ban lookup failed in guild ${guild.id}: ${describeDiscordError(error)}`);
    throw new ActionRefused(502, LOOKUP_FAILED);
  }
}
