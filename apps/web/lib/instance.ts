import { prisma } from "@tier0/db";

const INSTANCE_ID = 1;

async function discordIdFor(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "discord" },
  });
  return account?.providerAccountId ?? null;
}

/**
 * INSTANCE_OWNER_ID, when set, always wins. Otherwise this is the owner of the
 * Discord application, which the bot records each time it connects
 * (apps/bot/src/instance-owner.ts). Nothing on the web side can set it.
 */
export async function getInstanceOwnerId(): Promise<string | null> {
  const override = process.env.INSTANCE_OWNER_ID;
  if (override) return override;

  const instance = await prisma.instance.findUnique({ where: { id: INSTANCE_ID } });
  return instance?.ownerId ?? null;
}

export async function isInstanceClaimed(): Promise<boolean> {
  return (await getInstanceOwnerId()) !== null;
}

export async function isInstanceOwner(userId: string): Promise<boolean> {
  const ownerId = await getInstanceOwnerId();
  if (!ownerId) return false;
  const discordId = await discordIdFor(userId);
  return discordId !== null && discordId === ownerId;
}
