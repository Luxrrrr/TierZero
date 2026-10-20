import { can, type ModPermission, type StaffRole } from "@tier0/shared-moderation";
import { type TicketAccessLevel } from "@tier0/shared-tickets";

/**
 * The refusals of the Moderation and Tickets pages, decided again by their
 * layouts.
 *
 * Both areas have a loading screen, which makes Next.js send the page in a
 * stream: the layout and the loading screen go out first, with a 200, and a
 * page that refuses afterwards can no longer change the status. A layout runs
 * before that point, so it applies the same rules to the address it was asked
 * for and refuses with a real 403 (or redirects with a real 307). The pages
 * keep their own checks, because moving between tabs renders only the page.
 *
 * Free of Next.js imports so the rules can be tested on their own.
 */

export type Gate = { kind: "ok" } | { kind: "forbidden" } | { kind: "redirect"; href: string };

const OK: Gate = { kind: "ok" };
const FORBIDDEN: Gate = { kind: "forbidden" };

/** The part of the address after `/guilds/:id/<area>`, without a query or a trailing slash. */
export function restOfPath(path: string, guildId: string, area: "mod" | "tickets"): string | null {
  const bare = path.split(/[?#]/)[0]?.replace(/\/+$/, "") ?? "";
  const base = `/guilds/${guildId}/${area}`;
  if (bare === base) return "";
  return bare.startsWith(`${base}/`) ? bare.slice(base.length + 1) : null;
}

/** The staff permission each Moderation page asks for, by its first path segment. */
const MOD_PAGES: Record<string, ModPermission> = {
  "": "stats.view",
  members: "view",
  actions: "view",
  audit: "audit.view",
  messages: "view",
  "server-logs": "messages.view",
  access: "staff.manage",
  danger: "purge",
  appeals: "appeals.manage",
  raid: "raid.lockdown",
};

/**
 * What a Moderation page does for this person. Settings needs Manage Server
 * and nothing else. The staff pages need the permission above; someone who
 * manages the server without being staff is sent to Settings, as the pages
 * themselves do, except from Access, which refuses outright.
 */
export function modGate(rest: string | null, role: StaffRole | null, manager: boolean, guildId: string): Gate {
  if (rest === null) return OK;
  const [first = ""] = rest.split("/");
  if (first === "settings") return manager ? OK : FORBIDDEN;
  const permission = MOD_PAGES[first];
  if (!permission) return OK;
  if (role && can(role, permission)) return OK;
  if (manager && !role && first !== "access") return { kind: "redirect", href: `/guilds/${guildId}/mod/settings` };
  return FORBIDDEN;
}

/**
 * What a Tickets page does for this person. Settings and the quick setup need
 * Manage Server; the workspace needs a ticket level. Which tickets of a type
 * someone may open is the bot's decision on each request, so it is left to
 * the page.
 */
export function ticketsGate(rest: string | null, level: TicketAccessLevel | null, canManage: boolean): Gate {
  if (rest === null) return OK;
  const [first = ""] = rest.split("/");
  if (first === "settings" || first === "setup") return canManage ? OK : FORBIDDEN;
  return level !== null || canManage ? OK : FORBIDDEN;
}
