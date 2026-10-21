import { prisma } from "@tier0/db";

/**
 * The numbers workflows keep: a count, a streak, a flag. One is kept for a member
 * or for the whole server, under a name the owner chose. Nothing is stored until
 * a step changes it, and a number that was never set reads as zero.
 */

export type Scope = "member" | "server";
export type Change = "add" | "subtract" | "set";

/** Large enough for any count worth keeping, and inside what the database stores. */
export const LIMIT = 2_000_000_000;

const clamp = (value: number): number => Math.max(-LIMIT, Math.min(LIMIT, Math.trunc(value)));

const subjectOf = (scope: Scope, memberId: string | null): string => (scope === "member" ? (memberId ?? "") : "");

/** The values of the named numbers, zero for one that was never set. */
export async function read(guildId: string, scope: Scope, memberId: string | null, names: readonly string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = Object.fromEntries(names.map((name) => [name, 0]));
  if (names.length === 0 || (scope === "member" && !memberId)) return result;
  const rows = await prisma.workflowValue.findMany({ where: { guildId, scope, subjectId: subjectOf(scope, memberId), name: { in: [...names] } } });
  for (const row of rows) result[row.name] = row.value;
  return result;
}

/** Changes one number and says what it is now. Adding and subtracting happen in the database, so two runs at once both count. */
export async function change(guildId: string, scope: Scope, memberId: string | null, name: string, how: Change, amount: number): Promise<number | null> {
  if (scope === "member" && !memberId) return null;
  const where = { guildId_scope_subjectId_name: { guildId, scope, subjectId: subjectOf(scope, memberId), name } };
  const by = how === "subtract" ? -clamp(amount) : clamp(amount);
  const row =
    how === "set"
      ? await prisma.workflowValue.upsert({ where, create: { guildId, scope, subjectId: subjectOf(scope, memberId), name, value: clamp(amount) }, update: { value: clamp(amount) } })
      : await prisma.workflowValue.upsert({ where, create: { guildId, scope, subjectId: subjectOf(scope, memberId), name, value: clamp(by) }, update: { value: { increment: by } } });
  // An increment can pass the limit, which the next write brings back.
  if (Math.abs(row.value) > LIMIT) {
    const kept = clamp(row.value);
    await prisma.workflowValue.update({ where, data: { value: kept } });
    return kept;
  }
  return row.value;
}
