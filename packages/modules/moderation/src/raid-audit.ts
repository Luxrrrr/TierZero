import { AUTOMOD_ACTOR_NAME, type ModuleContext } from "@tier0/core";
import { prisma } from "@tier0/db";
import type { ModerationSettings } from "./settings.js";
import type { LockResult } from "./lockdown.js";
import { staffRoleOf } from "./staff.js";

type Ctx = ModuleContext<ModerationSettings>;

export interface LockdownAudit {
  actorId: string;
  actorName: string;
  /** Set for a lockdown the join-rate alert started by itself. */
  automatic?: boolean;
  locked: boolean;
  result: LockResult;
  reason: string | null;
}

const channels = (count: number): string => `${count} ${count === 1 ? "channel" : "channels"}`;

/** The Staff activity line for a lockdown or an unlock. */
export function lockdownSummary(audit: Pick<LockdownAudit, "locked" | "result" | "reason" | "automatic">): string {
  const verb = audit.locked ? "Locked" : "Unlocked";
  const failed = audit.result.failed.length > 0 ? `, ${channels(audit.result.failed.length)} could not be changed` : "";
  const why = audit.automatic ? " after a burst of joins" : "";
  return `${verb} ${channels(audit.result.changed.length)}${why}${failed}${audit.reason ? `: ${audit.reason}` : ""}`;
}

/**
 * Writes the entry for a lockdown made from Discord or by the alert. The
 * dashboard writes its own through the control API. Never throws: the channels
 * are already changed.
 */
export async function auditLockdown(ctx: Ctx, audit: LockdownAudit): Promise<void> {
  if (audit.result.changed.length === 0 && audit.result.failed.length === 0) return;
  try {
    const role = audit.automatic ? "automod" : ((await staffRoleOf(ctx.guild.id, audit.actorId)) ?? "mod");
    await prisma.modAudit.create({
      data: {
        guildId: ctx.guild.id,
        actorId: audit.actorId,
        actorName: audit.automatic ? AUTOMOD_ACTOR_NAME : audit.actorName.slice(0, 80),
        actorRole: role,
        kind: audit.locked ? "raid.lockdown" : "raid.unlock",
        summary: lockdownSummary(audit),
        after: JSON.stringify({ changed: audit.result.changed, failed: audit.result.failed, reason: audit.reason }),
      },
    });
  } catch (error) {
    console.error("moderation: could not write the audit entry for a lockdown:", error);
  }
}
