/**
 * Where a server opens for someone, by what they may do there. Kept apart from
 * guild-access.ts, which reads the session and the database, so it can be
 * tested on its own.
 */

interface Areas {
  managed: ReadonlySet<string>;
  staff: ReadonlyMap<string, unknown>;
  tickets: ReadonlySet<string>;
}

/** Where opening a server takes someone: the overview if they configure it, else the one area they were given. */
export function guildHome(guildId: string, access: Pick<Areas, "managed" | "staff">): string {
  if (access.managed.has(guildId)) return `/guilds/${guildId}`;
  if (access.staff.has(guildId)) return `/guilds/${guildId}/mod`;
  return `/guilds/${guildId}/tickets`;
}

/** What a server's card on Your servers says the person can use there, when it is not the whole server. */
export function guildRoleLabel(guildId: string, access: Areas): string | null {
  if (access.managed.has(guildId)) return null;
  if (access.staff.has(guildId)) return "Moderation";
  return access.tickets.has(guildId) ? "Tickets" : null;
}

