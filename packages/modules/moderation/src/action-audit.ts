import { deletedMessagesText, readEvidence, type AuditActorRole, type ModActionKind } from "@tier0/shared-moderation";
import { prisma } from "@tier0/db";
import type { InfractionRecord } from "./infractions.js";
import type { DeletionReport } from "./delete-evidence.js";
import { staffRoleOf } from "./staff.js";

/** Who the entry names, when the caller already knows better than the staff list does. */
export interface ActionAuditOptions {
  /** The name shown for the actor. Defaults to their display name in the server, then their id. */
  actorName?: string;
  /** The actor's role. Defaults to their place on the staff list, or "discord" when they have none. */
  actorRole?: AuditActorRole;
  /** The target's name, or null to show their id. Defaults to the name the refusals use. */
  targetName?: string | null;
  /** Leaves no entry, for a caller that writes a fuller one of its own, such as a decided appeal. */
  skip?: boolean;
}

export interface ActionAuditFacts {
  guildId: string;
  actorId: string;
  actorName: string;
  actorRole: AuditActorRole;
  targetId: string;
  /** Null when the name is not at hand, which reads as the id. */
  targetName: string | null;
  action: ModActionKind;
  record: Pick<InfractionRecord, "id" | "caseNumber" | "reason" | "evidence">;
  deletion?: Pick<DeletionReport, "deleted" | "failed"> | null;
}

const PAST: Record<ModActionKind, string> = {
  warn: "Warned",
  timeout: "Timed out",
  "timeout-clear": "Cleared the timeout of",
  kick: "Kicked",
  ban: "Banned",
  unban: "Unbanned",
};

const clipReason = (text: string): string => (text.length > 120 ? `${text.slice(0, 117)}...` : text);

/** The Staff activity line for an action taken on a member, from the dashboard or from Discord. */
export function actionAuditSummary(facts: ActionAuditFacts): string {
  const deleted = deletedMessagesText(readEvidence(facts.record.evidence));
  const reason = facts.record.reason ? `: ${clipReason(facts.record.reason)}` : "";
  return `${PAST[facts.action]} ${facts.targetName ?? facts.targetId} (case #${facts.record.caseNumber})${reason}${deleted ? `. ${deleted}` : ""}`;
}

/** The role an actor is recorded under when nothing says otherwise. */
export async function actorRoleFor(guildId: string, userId: string, isInstanceOwner: boolean): Promise<AuditActorRole> {
  if (isInstanceOwner) return "owner";
  return (await staffRoleOf(guildId, userId).catch(() => null)) ?? "discord";
}

/**
 * Leaves the line in Staff activity for an action a person took. Every way of
 * taking one comes through the performer, so this is the one place it is
 * written, whether it was asked for in the dashboard, with a slash command or
 * from the right-click menu. Never throws: the action has already happened.
 */
export async function auditAction(facts: ActionAuditFacts): Promise<void> {
  try {
    await prisma.modAudit.create({
      data: {
        guildId: facts.guildId,
        actorId: facts.actorId,
        actorName: facts.actorName.slice(0, 80),
        actorRole: facts.actorRole,
        kind: "action.take",
        targetUserId: facts.targetId,
        infractionId: facts.record.id,
        summary: actionAuditSummary(facts),
        after: JSON.stringify({
          action: facts.action,
          caseNumber: facts.record.caseNumber,
          reason: facts.record.reason,
          ...(facts.deletion ? { messagesDeleted: facts.deletion.deleted.length, messagesNotDeleted: facts.deletion.failed.length } : {}),
        }),
      },
    });
  } catch (error) {
    console.error("moderation: could not write the audit entry for an action:", error);
  }
}
