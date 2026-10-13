import type { Client } from "discord.js";
import { AUTOMOD_ACTOR_NAME } from "@tier0/core";
import { prisma } from "@tier0/db";

export interface AutomodCaseFacts {
  guildId: string;
  /** The bot's own user id, which is who automod acts as. */
  botUserId: string;
  targetUserId: string;
  /** Null when the name is not at hand, which reads as the id. */
  targetName: string | null;
  infractionId: number;
  caseNumber: number;
  /** The case's action, such as "automod-warn". */
  action: string;
  /** What really happened, which the case alone cannot say: it keeps only the strongest. */
  deleted?: boolean;
  warned?: boolean;
  timedOut?: boolean;
  /** The fixed wording for what the member did. Never the text that matched. */
  reason: string | null;
  /** Defaults to now. A backfilled entry is dated to its case. */
  at?: Date;
}

const clip = (text: string): string => (text.length > 120 ? `${text.slice(0, 117)}...` : text);

/** What the case's action says automod did, for when nothing finer is known. */
function flagsFromAction(action: string): { deleted: boolean; warned: boolean; timedOut: boolean } {
  return {
    deleted: action === "automod-delete",
    warned: action === "automod-warn",
    timedOut: action === "automod-timeout",
  };
}

/**
 * One line for Staff activity, in the wording of the entries staff write for
 * their own actions. It names what automod did, not what the member typed:
 * the dashboard shows the message on the case itself.
 */
export function automodAuditSummary(facts: AutomodCaseFacts): string {
  const known = facts.deleted || facts.warned || facts.timedOut;
  const done = known
    ? { deleted: !!facts.deleted, warned: !!facts.warned, timedOut: !!facts.timedOut }
    : flagsFromAction(facts.action);
  const name = facts.targetName ?? facts.targetUserId;

  const parts: string[] = [];
  if (done.deleted) parts.push(`deleted a message from ${name}`);
  if (done.warned) parts.push(parts.length ? "warned them" : `warned ${name}`);
  if (done.timedOut) parts.push(parts.length ? "timed them out" : `timed out ${name}`);
  // A rule that managed nothing is still filed as a warning, so that is what this says.
  if (parts.length === 0) parts.push(`warned ${name}`);

  const verbs = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]!;
  return `Automod ${verbs} (case #${facts.caseNumber})${facts.reason ? `: ${clip(facts.reason)}` : ""}`;
}

/**
 * Leaves the line in Staff activity that says automod acted, because a case
 * made by a rule has no person behind it and would otherwise be absent from
 * the trail while every other action is in it. Never throws: the case is
 * already made, and a failed note must not disturb the message flow. Returns whether the entry was written.
 */
export async function auditAutomodCase(facts: AutomodCaseFacts): Promise<boolean> {
  try {
    await prisma.modAudit.create({
      data: {
        guildId: facts.guildId,
        ...(facts.at ? { at: facts.at } : {}),
        actorId: facts.botUserId,
        actorName: AUTOMOD_ACTOR_NAME,
        actorRole: "automod",
        kind: "action.take",
        targetUserId: facts.targetUserId,
        infractionId: facts.infractionId,
        summary: automodAuditSummary(facts),
        after: JSON.stringify({ action: facts.action, caseNumber: facts.caseNumber, reason: facts.reason }),
      },
    });
    return true;
  } catch (error) {
    console.error("automod: could not write the audit entry for a case:", error);
    return false;
  }
}

/**
 * The fixed wording out of a stored automod reason, which reads
 * "rule: wording", then maybe " (matched ...)" and " (problems)". The match
 * is dropped because it is the member's own text and the case already shows it.
 */
export function genericReasonOf(stored: string | null): string | null {
  if (!stored) return null;
  let text = stored;
  for (const marker of [" (matched ", " (Could not "]) {
    const at = text.indexOf(marker);
    if (at >= 0) text = text.slice(0, at);
  }
  const colon = text.indexOf(": ");
  const wording = colon >= 0 ? text.slice(colon + 2).trim() : "";
  return wording || null;
}

/**
 * Older automod cases were never written to the audit trail. Gives each one an
 * entry, dated to the case, built from what the case stored. Safe to run on
 * every start: a case that already has an action entry is skipped.
 */
export async function backfillAutomodAudit(client: Client): Promise<number> {
  const botUserId = client.user?.id;
  if (!botUserId) return 0;

  const cases = await prisma.infraction.findMany({
    where: { moderatorId: botUserId, action: { startsWith: "automod-" } },
    select: { id: true, guildId: true, userId: true, caseNumber: true, action: true, reason: true, createdAt: true },
  });
  if (cases.length === 0) return 0;

  const have = new Set(
    (
      await prisma.modAudit.findMany({
        where: { kind: "action.take", infractionId: { in: cases.map((row) => row.id) } },
        select: { infractionId: true },
      })
    ).map((row) => row.infractionId),
  );

  let written = 0;
  for (const row of cases) {
    if (have.has(row.id)) continue;
    const name = client.guilds.cache.get(row.guildId)?.members.cache.get(row.userId)?.displayName ?? client.users.cache.get(row.userId)?.displayName ?? null;
    const done = await auditAutomodCase({
      guildId: row.guildId,
      botUserId,
      targetUserId: row.userId,
      targetName: name,
      infractionId: row.id,
      caseNumber: row.caseNumber,
      action: row.action,
      reason: genericReasonOf(row.reason),
      at: row.createdAt,
    });
    if (done) written += 1;
  }
  return written;
}
