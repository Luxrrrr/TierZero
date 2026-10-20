import { prisma } from "@tier0/db";
import { can, type Actor, type ModPermission, type StaffRole } from "@tier0/shared-moderation";
import { auth } from "./auth";
import { listBotGuilds } from "./control-api";
import { isInstanceOwner } from "./instance";
import type { AuthzFail } from "./authz";

/**
 * Who may open the mod dashboard, kept apart from the rule for configuring a
 * server (Manage Server). The instance owner is staff everywhere. Everyone
 * else is staff only where the owner has listed them, and at the level the
 * owner chose, so a server's moderators never need Manage Server at all.
 */

export interface StaffAccess {
  userId: string;
  discordUserId: string;
  name: string;
  role: StaffRole;
  actor: Actor;
}

export type StaffResult = ({ ok: true } & StaffAccess) | AuthzFail;

async function discordIdOf(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({ where: { userId, provider: "discord" } });
  return account?.providerAccountId ?? null;
}

/** The level a signed-in user holds in one server, or null for none. */
export async function staffRoleIn(userId: string, guildId: string): Promise<StaffRole | null> {
  const discordId = await discordIdOf(userId);
  if (!discordId) return null;

  if (await isInstanceOwner(userId)) {
    // A bot that cannot be reached is not the same as an owner without access:
    // let the failure through so the page can say the bot is offline.
    const guilds = await listBotGuilds();
    return guilds.some((guild) => guild.id === guildId) ? "owner" : null;
  }

  const row = await prisma.staffMember.findUnique({
    where: { guildId_userId: { guildId, userId: discordId } },
  });
  // Only the instance owner is ever "owner". A stored row can name admin or mod,
  // so a hand-edited row cannot confer the owner's powers.
  return row && (row.role === "admin" || row.role === "mod") ? row.role : null;
}

/** Every server where the user is staff, with their level in each. */
export async function staffGuilds(userId: string): Promise<Map<string, StaffRole>> {
  const result = new Map<string, StaffRole>();
  const discordId = await discordIdOf(userId);
  if (!discordId) return result;

  if (await isInstanceOwner(userId)) {
    for (const guild of await listBotGuilds()) result.set(guild.id, "owner");
    return result;
  }

  const rows = await prisma.staffMember.findMany({ where: { userId: discordId } });
  const inBot = new Set((await listBotGuilds()).map((guild) => guild.id));
  for (const row of rows) {
    if (inBot.has(row.guildId) && (row.role === "admin" || row.role === "mod")) result.set(row.guildId, row.role);
  }
  return result;
}

/**
 * The gate for every mod page and mod API route. Names the permission the
 * caller needs; the default is simply being staff here.
 */
export async function requireStaff(
  guildId: string,
  permission: ModPermission = "view",
): Promise<StaffResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, status: 401, message: "Sign in to continue." };

  const discordUserId = await discordIdOf(session.user.id);
  const role = await staffRoleIn(session.user.id, guildId);
  if (!discordUserId || !role) {
    return { ok: false, status: 403, message: "You have not been given access to this server's moderation tools." };
  }
  if (!can(role, permission)) {
    return { ok: false, status: 403, message: "Your role does not allow that." };
  }

  const name = session.user.name ?? "Unknown";
  return {
    ok: true,
    userId: session.user.id,
    discordUserId,
    name,
    role,
    actor: { userId: discordUserId, name, role },
  };
}
