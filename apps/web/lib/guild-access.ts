import type { StaffRole } from "@tier0/shared-moderation";
import type { TicketAccessLevel } from "@tier0/shared-tickets";
import { getAuthorizedGuildIds, requireGuildAccess } from "./authz";
import { ControlApiError, listBotGuilds, ticketsRequest } from "./control-api";
import { prisma } from "@tier0/db";
import { requireStaff, staffGuilds } from "./mod-access";
import { requireTicketViewer } from "./tickets-access";

export { guildHome, guildRoleLabel } from "./guild-home";

export type GuildAccess =
  | { ok: true; manager: boolean; staffRole: StaffRole | null; ticketLevel: TicketAccessLevel | null }
  | { ok: false; status: 401 | 403; error?: unknown };

/**
 * What a signed-in user may do in one server: configure it (Manage Server),
 * use the mod dashboard (listed staff), work its tickets (a handler or admin
 * role), any mix of those, or nothing. The layout uses this
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
  // A manager is a ticket manager by definition, so the bot is only asked
  // about everyone else: handlers usually have neither of the other two.
  const ticketLevel = isManager ? "manager" : await ticketLevelIn(guildId);
  if (isManager || staffRole || ticketLevel) return { ok: true, manager: isManager, staffRole, ticketLevel };

  // A Discord or control API failure on the manager lookup must not read as
  // "you have no access"; the caller decides how to show it.
  if (manager.error) return { ok: false, status: 403, error: manager.error };

  const unauthenticated =
    (!staff.ok && staff.status === 401) || (manager.result?.ok === false && manager.result.status === 401);
  return { ok: false, status: unauthenticated ? 401 : 403 };
}

/** Null for no access, and for a bot that could not answer, which the other two checks report on their own. */
async function ticketLevelIn(guildId: string): Promise<TicketAccessLevel | null> {
  try {
    const viewer = await requireTicketViewer(guildId);
    return viewer.ok ? viewer.level : null;
  } catch {
    return null;
  }
}

export interface AccessibleGuilds {
  /** Servers the user may configure. */
  managed: Set<string>;
  /** Servers where the user is listed staff, with their level. */
  staff: Map<string, StaffRole>;
  /** Servers where the user works tickets without either of the above. */
  tickets: Set<string>;
  /** Everything they may open: the union of the three. */
  all: Set<string>;
}

// Asking the bot about every server on each page would add a round trip per
// server to every navigation, and ticket roles change rarely.
const TICKET_CACHE_MS = 30_000;
const shared = globalThis as typeof globalThis & { __tier0TicketGuilds?: Map<string, { at: number; ids: Set<string> }> };
const ticketCache = (shared.__tier0TicketGuilds ??= new Map());

/**
 * Servers where the bot says this Discord account works tickets, out of the
 * candidates given. The bot holds the roles and the ticket settings, so each
 * server is asked; one that cannot answer just leaves that server out.
 */
async function ticketGuilds(userId: string, candidates: readonly string[]): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  const key = `${userId}:${[...candidates].sort().join(",")}`;
  const cached = ticketCache.get(key);
  if (cached && Date.now() - cached.at < TICKET_CACHE_MS) return cached.ids;

  const account = await prisma.account.findFirst({ where: { userId, provider: "discord" } });
  const viewer = account?.providerAccountId;
  if (!viewer) return new Set();
  const answers = await Promise.all(
    candidates.map(async (guildId) => {
      const reply = await ticketsRequest(guildId, `access?viewer=${encodeURIComponent(viewer)}`).catch(() => null);
      const level = (reply?.body as { level?: unknown } | undefined)?.level;
      return reply?.status === 200 && typeof level === "string" ? guildId : null;
    }),
  );
  const ids = new Set(answers.filter((id): id is string => id !== null));
  ticketCache.set(key, { at: Date.now(), ids });
  return ids;
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
  // The instance owner is staff everywhere, so nobody else is left to ask about.
  const others = (await listBotGuilds()).map((guild) => guild.id).filter((id) => !managed.has(id) && !staff.has(id));
  const tickets = await ticketGuilds(userId, others);
  return { managed, staff, tickets, all: new Set([...managed, ...staff.keys(), ...tickets]) };
}
