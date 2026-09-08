import { prisma } from "@tier0/db";
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
}

interface StoredInfraction {
  id: number;
  guildId: string;
  userId: string;
  moderatorId: string;
  action: string;
  reason: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  active: boolean;
}

function toRecord(row: StoredInfraction, caseNumber: number): InfractionRecord {
  return { ...row, caseNumber };
}

/**
 * How many of `idsAscending` were logged at or before `id`. Split out from
 * `recordInfraction` because it is the entire safety argument for case
 * numbers and deserves to be tested on its own, with no database involved.
 */
export function rankAmong(id: number, idsAscending: readonly number[]): number {
  let rank = 0;
  for (const existing of idsAscending) {
    if (existing <= id) rank += 1;
  }
  return rank;
}

export interface RecordInfractionInput {
  guildId: string;
  userId: string;
  moderatorId: string;
  action: ModerationAction;
  reason: string | null;
  expiresAt?: Date | null;
  active?: boolean;
}

/**
 * Writes an infraction and hands back its case number.
 *
 * There is no counter row to allocate a number from up front, which is what
 * makes this safe when two moderators act at the same moment: SQLite already
 * assigns each insert a unique, strictly increasing `id` as part of the
 * write itself, with no window in which two rows could be handed the same
 * one. The case number is nothing more than that row's rank among this
 * guild's infractions - "how many of this guild's rows exist at or before
 * mine" - computed after the fact, so there is nothing left to race over.
 */
export async function recordInfraction(input: RecordInfractionInput): Promise<InfractionRecord> {
  const created = await prisma.infraction.create({
    data: {
      guildId: input.guildId,
      userId: input.userId,
      moderatorId: input.moderatorId,
      action: input.action,
      reason: input.reason ?? null,
      expiresAt: input.expiresAt ?? null,
      active: input.active ?? true,
    },
  });
  const caseNumber = await prisma.infraction.count({
    where: { guildId: input.guildId, id: { lte: created.id } },
  });
  return toRecord(created, caseNumber);
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

export async function findByCaseNumber(
  guildId: string,
  caseNumber: number,
): Promise<InfractionRecord | null> {
  if (!Number.isInteger(caseNumber) || caseNumber < 1) return null;
  const rows = await prisma.infraction.findMany({
    where: { guildId },
    orderBy: { id: "asc" },
    skip: caseNumber - 1,
    take: 1,
  });
  const row = rows[0];
  return row ? toRecord(row, caseNumber) : null;
}

/**
 * A member's history, newest first, each row carrying its guild-wide case
 * number. The guild's full id list is fetched once to build that numbering
 * rather than issuing one count query per row - cheap at the scale a
 * self-hosted instance runs at, and exact rather than approximate.
 */
export async function historyFor(
  guildId: string,
  userId: string,
  limit = 25,
): Promise<InfractionRecord[]> {
  const guildRows = await prisma.infraction.findMany({
    where: { guildId },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  const rank = new Map<number, number>();
  guildRows.forEach((row, index) => rank.set(row.id, index + 1));

  const userRows = await prisma.infraction.findMany({
    where: { guildId, userId },
    orderBy: { id: "desc" },
    take: limit,
  });
  return userRows.map((row) => toRecord(row, rank.get(row.id) ?? 0));
}
