/**
 * The authorization rule, kept apart from the Discord HTTP client so it has no
 * imports and no I/O of its own. Whether a signed-in user may configure a
 * given guild is the security boundary of the whole dashboard, so it is worth
 * being able to exercise directly rather than only through a live session.
 */

export const MANAGE_GUILD = 0x20;

export interface ManageableGuild {
  id: string;
  permissions: string;
}

/** Discord sends permissions as a decimal string that can exceed 32 bits. */
export function hasManageGuild(permissions: string): boolean {
  try {
    return (BigInt(permissions) & BigInt(MANAGE_GUILD)) === BigInt(MANAGE_GUILD);
  } catch {
    return false;
  }
}

/** A guild is configurable when the caller manages it and the bot is in it. */
export function authorizedGuildIds(
  userGuilds: ManageableGuild[],
  botGuildIds: Iterable<string>,
): Set<string> {
  const inBot = new Set(botGuildIds);
  const authorized = new Set<string>();
  for (const guild of userGuilds) {
    if (inBot.has(guild.id) && hasManageGuild(guild.permissions)) {
      authorized.add(guild.id);
    }
  }
  return authorized;
}
