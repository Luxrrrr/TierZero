import { createInfraction, prisma } from "@tier0/db";
import type { AutomaticCase, EvidenceMessage } from "@tier0/core";
import type { ModerationAction } from "./modlog.js";

export interface InfractionRecord {
  id: number;
  caseNumber: number;
  guildId: string;
  userId: string;
  moderatorId: string;
  action: string;
  reason: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  active: boolean;
  /** Messages kept with the action, as JSON. */
  evidence: string;
}

export interface RecordInfractionInput {
  guildId: string;
  userId: string;
  moderatorId: string;
  action: ModerationAction;
  reason: string | null;
  expiresAt?: Date | null;
  active?: boolean;
  evidence?: EvidenceMessage[];
  /** Set when an escalation rule took this action, not a person. */
  automatic?: AutomaticCase | null;
}

/**
 * Writes an infraction and hands back its stored case number: one past the
 * highest in the guild. Two writers can pick the same number at once, so a
 * unique-index conflict is retried with a fresh pick. Voided rows still count
 * towards the highest, which keeps numbers from being reused.
 */
export async function recordInfraction(input: RecordInfractionInput): Promise<InfractionRecord> {
  return createInfraction({
    guildId: input.guildId,
    userId: input.userId,
    moderatorId: input.moderatorId,
    action: input.action,
    reason: input.reason ?? null,
    expiresAt: input.expiresAt ?? null,
    active: input.active ?? true,
    evidence: JSON.stringify(input.evidence ?? []),
    ...(input.automatic ? { automatic: JSON.stringify(input.automatic) } : {}),
  });
}

/** Marks the most recent open infraction of `action` inactive, for a reversal. */
export async function deactivateOpen(
  guildId: string,
  userId: string,
  action: ModerationAction,
): Promise<void> {
  const open = await prisma.infraction.findFirst({
    where: { guildId, userId, action, active: true },
    orderBy: { id: "desc" },
  });
  if (!open) return;
  await prisma.infraction.update({ where: { id: open.id }, data: { active: false } });
}

/** The newest ban on a member's record that is still flagged active and has not been removed. */
export async function latestOpenBan(guildId: string, userId: string): Promise<InfractionRecord | null> {
  return prisma.infraction.findFirst({
    where: { guildId, userId, action: "ban", active: true, voidedAt: null },
    orderBy: { id: "desc" },
  });
}

/** Looks a case up by its stored number. A voided case reads as missing. */
export async function findByCaseNumber(
  guildId: string,
  caseNumber: number,
): Promise<InfractionRecord | null> {
  if (!Number.isInteger(caseNumber) || caseNumber < 1) return null;
  return prisma.infraction.findFirst({ where: { guildId, caseNumber, voidedAt: null } });
}

/** A member's history, newest first, leaving out anything staff have removed from the record. */
export async function historyFor(
  guildId: string,
  userId: string,
  limit = 25,
): Promise<InfractionRecord[]> {
  return prisma.infraction.findMany({
    where: { guildId, userId, voidedAt: null },
    orderBy: { id: "desc" },
    take: limit,
  });
}

/**
 * Closes every open timeout on a member, automod's included: both put the same
 * Discord timeout on them, so clearing it ends both.
 */
export async function deactivateOpenTimeouts(guildId: string, userId: string): Promise<void> {
  await prisma.infraction.updateMany({
    where: { guildId, userId, action: { in: ["timeout", "automod-timeout"] }, active: true },
    data: { active: false },
  });
}
