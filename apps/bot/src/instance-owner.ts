import type { Client } from "discord.js";
import { prisma } from "@tier0/db";

interface UserLike {
  id: string;
}

interface TeamLike {
  ownerId: string | null;
}

/**
 * A personal application belongs to one user. A team application belongs to the
 * team, and the person it names as the team's owner is the one who runs it.
 */
export function applicationOwnerId(owner: UserLike | TeamLike | null | undefined): string | null {
  if (!owner) return null;
  if ("ownerId" in owner) return owner.ownerId;
  return owner.id;
}

/**
 * Records who owns the Discord application as the instance owner. Discord
 * already knows who created the application, so nobody has to claim the install
 * and nobody can claim it by getting to the setup page first. INSTANCE_OWNER_ID
 * still wins when it is set, so nothing is written then.
 *
 * Runs on every start, so handing the application to someone else in the
 * Developer Portal hands the install over with it.
 */
export async function syncInstanceOwner(client: Client): Promise<string | null> {
  if (process.env.INSTANCE_OWNER_ID) return process.env.INSTANCE_OWNER_ID;

  const application = await client.application?.fetch().catch(() => null);
  const ownerId = applicationOwnerId(application?.owner);
  if (!ownerId) return null;

  await prisma.instance.upsert({
    where: { id: 1 },
    create: { id: 1, ownerId, setupAt: new Date() },
    update: { ownerId },
  });
  return ownerId;
}
