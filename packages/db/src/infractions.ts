import type { Prisma } from "@prisma/client";
import { prisma } from "./index.js";

/**
 * Takes the next case number for a guild. One UPDATE both raises the guild's
 * counter and reads it back, so SQLite serialises concurrent callers one
 * statement at a time and none of them is ever given the same number. The
 * counter only goes up, so a number that was purged is never handed to a
 * different case. A failed insert after this leaves a gap, which is harmless.
 */
async function nextCaseNumber(guildId: string): Promise<number> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rows = await prisma.$queryRaw<{ caseCounter: number | bigint }[]>`
      UPDATE "Guild" SET "caseCounter" = "caseCounter" + 1
      WHERE "id" = ${guildId}
      RETURNING "caseCounter"`;
    const row = rows[0];
    if (row) return Number(row.caseCounter);
    // The server's row is normally written when the bot joins; make sure it exists.
    await prisma.guild.upsert({ where: { id: guildId }, create: { id: guildId, name: "" }, update: {} });
  }
  throw new Error(`Could not allocate a case number for guild ${guildId}.`);
}

/**
 * Writes an infraction under the next case number for its guild. Every writer
 * of infractions must come through here: a row written without a number would
 * take the default of 0 and collide with the next one.
 */
export async function createInfraction(data: Omit<Prisma.InfractionUncheckedCreateInput, "caseNumber">) {
  const caseNumber = await nextCaseNumber(data.guildId);
  return prisma.infraction.create({ data: { ...data, caseNumber } });
}
