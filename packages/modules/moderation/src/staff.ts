import type { StaffRole } from "@tier0/core";
import { instanceOwnerId, prisma } from "@tier0/db";

/**
 * Where a Discord user stands on the moderation staff list of one server. The
 * dashboard decides this in its own process; the bot needs the same answer for
 * the right-click menu, so the rule is repeated here and kept to the same shape:
 * the person running the install is the owner everywhere, and a stored row can
 * only ever name admin or mod.
 */
export async function staffRoleOf(guildId: string, userId: string): Promise<StaffRole | null> {
  if ((await instanceOwnerId()) === userId) return "owner";

  const row = await prisma.staffMember.findUnique({ where: { guildId_userId: { guildId, userId } } });
  return row && (row.role === "admin" || row.role === "mod") ? row.role : null;
}
