import { prisma } from "./index.js";

/**
 * Who owns the install: INSTANCE_OWNER_ID when it is set, else the owner the bot
 * recorded from the Discord application. This is the only place that decides,
 * so the dashboard, the bot and the moderation module cannot disagree about it.
 */
export async function instanceOwnerId(): Promise<string | null> {
  const fromEnv = process.env.INSTANCE_OWNER_ID;
  if (fromEnv) return fromEnv;
  const row = await prisma.instance.findUnique({ where: { id: 1 }, select: { ownerId: true } });
  return row?.ownerId ?? null;
}
