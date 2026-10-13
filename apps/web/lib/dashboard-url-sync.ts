import { headers } from "next/headers";
import { prisma } from "@tier0/db";
import { isInstanceOwner } from "./instance";
import { originFromHeaders, shouldStoreDashboardUrl } from "./dashboard-url";

const INSTANCE_ID = 1;

/**
 * Keeps `Instance.dashboardUrl` in step with the address the owner actually
 * uses, so the bot's "View in dashboard" links work without anyone typing the
 * address anywhere. Only the instance owner's requests count: the host header
 * is client-supplied, and a moderator who could set it could point the bot's
 * links at another site. The stored value is read first and the owner lookup
 * and write happen only when it would change.
 *
 * Never throws: a failure here must not stop a page from rendering.
 */
export async function captureDashboardUrl(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  try {
    const incoming = await headers();
    const candidate = originFromHeaders({
      host: incoming.get("host"),
      forwardedHost: incoming.get("x-forwarded-host"),
      forwardedProto: incoming.get("x-forwarded-proto"),
    });
    if (!candidate) return;

    const instance = await prisma.instance.findUnique({ where: { id: INSTANCE_ID }, select: { dashboardUrl: true } });
    if (!shouldStoreDashboardUrl(instance?.dashboardUrl, candidate)) return;
    if (!(await isInstanceOwner(userId))) return;

    await prisma.instance.updateMany({ where: { id: INSTANCE_ID }, data: { dashboardUrl: candidate } });
  } catch {
    // Best effort; the address is picked up on a later visit.
  }
}
