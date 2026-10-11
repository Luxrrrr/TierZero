import type { StaffRole } from "@tier0/core";
import { getAuthorizedGuildIds, requireGuildAccess } from "./authz";
import { ControlApiError } from "./control-api";
import { requireStaff, staffGuilds } from "./mod-access";

export type GuildAccess =
  | { ok: true; manager: boolean; staffRole: StaffRole | null }
  | { ok: false; status: 401 | 403; error?: unknown };

/**
 * What a signed-in user may do in one server: configure it (Manage Server),
 * use the mod dashboard (listed staff), both, or neither. The layout uses this
 * to decide what to draw. It does not replace the check each settings page
 * makes for itself, because a layout does not run again when only the page
 * below it changes.
 */
export async function guildAccess(guildId: string): Promise<GuildAccess> {
  const [manager, staff] = await Promise.all([
    requireGuildAccess(guildId).then(
      (result) => ({ result, error: undefined as unknown }),
      (error: unknown) => ({ result: null, error }),
    ),
    requireStaff(guildId),
  ]);

  const isManager = manager.result?.ok === true;
  const staffRole = staff.ok ? staff.role : null;
  if (isManager || staffRole) return { ok: true, manager: isManager, staffRole };

  // A Discord or control API failure on the manager lookup must not read as
  // "you have no access"; the caller decides how to show it.
  if (manager.error) return { ok: false, status: 403, error: manager.error };

  const unauthenticated =
    (!staff.ok && staff.status === 401) || (manager.result?.ok === false && manager.result.status === 401);
  return { ok: false, status: unauthenticated ? 401 : 403 };
}

export interface AccessibleGuilds {
  /** Servers the user may configure. */
  managed: Set<string>;
  /** Servers where the user is listed staff, with their level. */
  staff: Map<string, StaffRole>;
  /** Everything they may open: the union of the two. */
  all: Set<string>;
}

/**
 * Every server the user can open in some capacity. A failed Manage Server
 * lookup (Discord rate limit, expired token) leaves that half empty rather
 * than hiding the servers they staff; a control API outage still propagates.
 */
export async function accessibleGuilds(userId: string): Promise<AccessibleGuilds> {
  const [managed, staff] = await Promise.all([
    getAuthorizedGuildIds(userId).catch((error: unknown) => {
      if (error instanceof ControlApiError) throw error;
      return new Set<string>();
    }),
    staffGuilds(userId),
  ]);
  return { managed, staff, all: new Set([...managed, ...staff.keys()]) };
}
