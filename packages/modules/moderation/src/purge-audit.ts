import { prisma } from "@tier0/db";
import { staffRoleOf } from "./staff.js";

export interface PurgeFacts {
  guildId: string;
  actorId: string;
  actorName: string;
  channelId: string;
  channelName: string;
  deleted: number;
}

/**
 * Leaves a line in the audit trail that Staff activity reads, because the
 * messages themselves are gone and nothing else says who removed them. The
 * mod log is not used: its post is built around a case, a member and an
 * action, and a purge has none of those. Never throws, since the messages are
 * already deleted and a failed note must not read as a failed purge.
 */
export async function auditPurge(facts: PurgeFacts): Promise<void> {
  try {
    const role = await staffRoleOf(facts.guildId, facts.actorId);
    const where = facts.channelName ? `#${facts.channelName}` : "a channel";
    await prisma.modAudit.create({
      data: {
        guildId: facts.guildId,
        actorId: facts.actorId,
        actorName: facts.actorName,
        // Someone holding Manage Messages without a place on the staff list is recorded as having none.
        actorRole: role ?? "none",
        kind: "channel.purge",
        summary: `Deleted ${facts.deleted} message${facts.deleted === 1 ? "" : "s"} in ${where}`,
        after: JSON.stringify({ channelId: facts.channelId, deleted: facts.deleted }),
      },
    });
  } catch (error) {
    console.error("moderation: could not write the audit entry for a purge:", error);
  }
}
