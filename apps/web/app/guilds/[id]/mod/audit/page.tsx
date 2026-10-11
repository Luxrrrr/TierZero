import { forbidden, redirect } from "next/navigation";
import type { Metadata } from "next";
import { ROLE_LABEL, type AuditDto } from "@tier0/core";
import { requireStaff } from "../../../../../lib/mod-access";
import { ControlApiError } from "../../../../../lib/control-api";
import { modAudit, modStaff } from "../../../../../lib/mod-api";
import { LoadError } from "../actions/LoadError";
import { AuditLog, type ActorOption } from "./AuditLog";
import { auditApiParams, narrowAudit, parseAuditQuery } from "./params";

export const metadata: Metadata = { title: "Audit trail · Moderation" };

/** Staff as listed now, plus anyone seen acting on this page (the owner is never in the staff list). */
async function actorOptions(guildId: string, seen: AuditDto[]): Promise<ActorOption[]> {
  const byId = new Map<string, ActorOption>();
  try {
    for (const entry of await modStaff(guildId)) {
      byId.set(entry.user.userId, {
        userId: entry.user.userId,
        name: entry.user.name,
        role: ROLE_LABEL[entry.role],
      });
    }
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
  }
  for (const { actor } of seen) {
    if (!byId.has(actor.userId)) byId.set(actor.userId, { userId: actor.userId, name: actor.name, role: ROLE_LABEL[actor.role] });
  }
  return [...byId.values()].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = parseAuditQuery(await searchParams);

  const access = await requireStaff(id, "audit.view");
  if (!access.ok) {
    if (access.status === 401) redirect("/login");
    forbidden();
  }

  try {
    const fetched = await modAudit(id, auditApiParams(query));
    const items = narrowAudit(fetched.items, query);
    // Fewer rows after narrowing means the bot ignored the date or text filter.
    const narrowedHere = items.length < fetched.items.length;
    const actors = await actorOptions(id, fetched.items);
    return (
      <AuditLog guildId={id} query={query} data={{ ...fetched, items }} actors={actors} narrowedHere={narrowedHere} />
    );
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return <LoadError what="the audit trail" status={error.status} message={error.message} />;
  }
}
