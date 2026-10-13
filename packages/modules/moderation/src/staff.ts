import type { StaffRole } from "@tier0/core";
import { prisma } from "@tier0/db";

/**
 * Where a Discord user stands on the moderation staff list of one server. The
 * dashboard decides this in its own process; the bot needs the same answer for
 * the right-click menu, so the rule is repeated here and kept to the same shape:
 * the person running the install is the owner everywhere, and a stored row can
 * only ever name admin or mod.
 */
export async function staffRoleOf(guildId: string, userId: string): Promise<StaffRole | null> {
  const ownerId = process.env.INSTANCE_OWNER_ID || (await prisma.instance.findUnique({ where: { id: 1 } }))?.ownerId;
  if (ownerId && ownerId === userId) return "owner";

  const row = await prisma.staffMember.findUnique({ where: { guildId_userId: { guildId, userId } } });
  return row && (row.role === "admin" || row.role === "mod") ? row.role : null;
}

export const NOT_STAFF =
  "Only moderators on this server's staff list can use this. Ask the server owner to add you on the Access tab of the dashboard.";
