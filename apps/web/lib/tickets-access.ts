import { prisma } from "@tier0/db";
import type { TicketAccessLevel, TicketActor, TicketPermission } from "@tier0/shared-tickets";
import { auth } from "./auth";
import { requireGuildAccess, type AuthzFail } from "./authz";
import { ControlApiError, listBotGuilds, ticketsRequest } from "./control-api";
import { isInstanceOwner } from "./instance";

/**
 * Who may open a server's ticket workspace. Server code only: it reads the
 * session and the database.
 *
 * Ticket access depends on the member's roles in the server and on the
 * ticket settings, both of which the bot holds, so the bot decides: this file
 * finds the signed-in user's Discord id and asks. That is what lets a handler
 * who lacks Manage Server, and is not moderation staff, open the workspace.
 */

export interface TicketSession {
  userId: string;
  discordUserId: string;
  actor: TicketActor;
}

export type TicketSessionResult = ({ ok: true } & TicketSession) | AuthzFail;

export interface TicketViewer {
  viewerId: string;
  level: TicketAccessLevel;
  actor: TicketActor;
  /** Workspace-wide permissions, as the bot worked them out. */
  permissions: TicketPermission[];
  handledTypeIds: string[];
  moduleEnabled: boolean;
}

export type TicketViewerResult = ({ ok: true } & TicketViewer) | AuthzFail;

/** The signed-in user as a Discord account, with the actor a write is made as. */
export async function ticketSession(): Promise<TicketSessionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, status: 401, message: "Sign in to continue." };
  const account = await prisma.account.findFirst({ where: { userId: session.user.id, provider: "discord" } });
  if (!account?.providerAccountId) {
    return { ok: false, status: 403, message: "Your dashboard account is not linked to a Discord account. Sign out and sign in with Discord again." };
  }
  const image = session.user.image;
  return {
    ok: true,
    userId: session.user.id,
    discordUserId: account.providerAccountId,
    actor: {
      userId: account.providerAccountId,
      name: session.user.name ?? "Unknown",
      avatarUrl: typeof image === "string" && image.startsWith("https://") ? image : null,
    },
  };
}

/**
 * Manage Server in this server, or the instance owner where the bot is a
 * member: the same rule as the settings pages. A Discord failure reads as no,
 * because the bot checks again and a wrong yes here would only reach a refusal.
 */
export async function isTicketManager(userId: string, guildId: string): Promise<boolean> {
  const configured = await requireGuildAccess(guildId).catch(() => null);
  if (configured?.ok) return true;
  if (!(await isInstanceOwner(userId))) return false;
  const guilds = await listBotGuilds().catch(() => []);
  return guilds.some((guild) => guild.id === guildId);
}

interface AccessBody {
  level?: TicketAccessLevel | null;
  permissions?: TicketPermission[];
  handledTypeIds?: string[];
  moduleEnabled?: boolean;
  error?: string;
}

/**
 * The gate for every ticket page. The bot is asked where the signed-in user
 * stands; a failure to reach it is thrown as a ControlApiError so the page can
 * say the bot is offline rather than that access was refused.
 */
export async function requireTicketViewer(guildId: string): Promise<TicketViewerResult> {
  const session = await ticketSession();
  if (!session.ok) return session;

  const reply = await ticketsRequest(guildId, `access?viewer=${encodeURIComponent(session.discordUserId)}`);
  const body = (reply.body ?? {}) as AccessBody;
  if (reply.status === 200 && body.level) {
    return {
      ok: true,
      viewerId: session.discordUserId,
      level: body.level,
      actor: session.actor,
      permissions: body.permissions ?? [],
      handledTypeIds: body.handledTypeIds ?? [],
      moduleEnabled: body.moduleEnabled !== false,
    };
  }
  if (reply.status === 403 || reply.status === 404) {
    return { ok: false, status: 403, message: body.error ?? "You do not have access to this server's tickets." };
  }
  if (reply.status === 409) {
    // Settings that no longer read stop the bot from working out anyone's level, but a
    // manager still has to reach the Settings tab to save them again.
    if (await isTicketManager(session.userId, guildId)) {
      return {
        ok: true,
        viewerId: session.discordUserId,
        level: "manager",
        actor: session.actor,
        permissions: ["settings"],
        handledTypeIds: [],
        moduleEnabled: false,
      };
    }
    return { ok: false, status: 403, message: body.error ?? "The ticket settings for this server could not be read." };
  }
  throw new ControlApiError(reply.status, body.error ?? `The bot answered ${reply.status}.`);
}
