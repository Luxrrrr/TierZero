import { prisma } from "@tier0/db";

const INSTANCE_ID = 1;

async function discordIdFor(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "discord" },
  });
  return account?.providerAccountId ?? null;
}

/**
 * INSTANCE_OWNER_ID, when set, always wins over whatever setup recorded -
 * that is what "overrides" means here. Otherwise this is whichever Discord
 * account claimed the instance first.
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

/**
 * Records the first account through the setup wizard as the instance owner.
 * A no-op when INSTANCE_OWNER_ID is set, since the environment variable wins
 * regardless of what's in the database.
 *
 * This is a first-run race: two people could open /setup at the same
 * instant and both see an unclaimed instance. It's resolved, not merely
 * ignored - the `upsert` guarantees the Instance row exists (idempotent, so
 * concurrent callers racing on it don't clobber each other), and the
 * `updateMany` below is a single atomic UPDATE guarded by `ownerId: null`.
 * SQLite serialises writes to the database file, so only one of the two
 * concurrent updateMany calls actually matches a null ownerId and changes a
 * row; the other affects zero rows and silently loses the race. Both
 * requests still proceed to /guilds - the loser just isn't recorded as
 * owner, and can be replaced by hand via INSTANCE_OWNER_ID if that matters
 * for a given install.
 */
export async function claimInstanceOwnership(userId: string): Promise<void> {
  if (process.env.INSTANCE_OWNER_ID) return;

  const discordId = await discordIdFor(userId);
  if (!discordId) return;

  await prisma.instance.upsert({
    where: { id: INSTANCE_ID },
    update: {},
    create: { id: INSTANCE_ID },
  });

  await prisma.instance.updateMany({
    where: { id: INSTANCE_ID, ownerId: null },
    data: { ownerId: discordId, setupAt: new Date() },
  });
}
