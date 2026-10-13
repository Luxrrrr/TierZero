import { prisma } from "@tier0/db";
import { AUDIT_KIND_LABEL, auditActorRole, type AuditDto, type AuditKind, type Page, type UserRef } from "@tier0/core";
import { auditWhere } from "./filters.js";
import { refOf, resolveUsers } from "./names.js";
import { ok, pageOf, type ModCtx, type Reply } from "./types.js";

/** A row as Prisma returns it, so callers can pass whatever they queried. */
export type ModAuditRow = Awaited<ReturnType<typeof prisma.modAudit.findMany>>[number];

/** Snapshots are written by this code, but a hand-edited or truncated row should not take the whole list down. */
function parseSnapshot(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const isKnownKind = (kind: string): kind is AuditKind => kind in AUDIT_KIND_LABEL;

/**
 * Turns stored audit rows into what the dashboard shows: names resolved, the
 * kind given a label, and the before/after snapshots parsed back from JSON.
 * Other handlers call this when they need audit entries in a reply.
 */
export async function toAuditDtos(
  ctx: ModCtx,
  rows: ModAuditRow[],
  known?: Map<string, UserRef>,
): Promise<AuditDto[]> {
  // A caller that has already resolved these ids passes them in, so one
  // request does not spend the name budget twice.
  const targets = rows.flatMap((row) => (row.targetUserId ? [row.targetUserId] : []));
  const refs = known ?? (await resolveUsers(ctx.client, ctx.guild, targets));

  return rows.map((row) => ({
    id: row.id,
    at: row.at.toISOString(),
    // The name stored at the time is kept: it is what the actor was called when they acted.
    actor: {
      userId: row.actorId,
      name: row.actorName,
      role: auditActorRole(row.actorRole),
    },
    // An unknown kind (a row from a newer version) still renders, with its raw name as the label.
    kind: row.kind as AuditKind,
    label: isKnownKind(row.kind) ? AUDIT_KIND_LABEL[row.kind] : row.kind,
    summary: row.summary,
    targetUser: row.targetUserId ? refOf(refs, row.targetUserId) : null,
    infractionId: row.infractionId,
    noteId: row.noteId,
    before: parseSnapshot(row.before),
    after: parseSnapshot(row.after),
  }));
}

/** GET /mod/audit?kind=&actorId=&targetUserId=&since=&until=&q=&page=&pageSize= -> Page of AuditDto */
export async function listAudit(ctx: ModCtx, query: URLSearchParams): Promise<Reply> {
  const { page, pageSize } = pageOf(query);
  const where = auditWhere(ctx.guild.id, query);

  const [total, rows] = await Promise.all([
    prisma.modAudit.count({ where }),
    prisma.modAudit.findMany({
      where,
      orderBy: [{ at: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const body: Page<AuditDto> = { items: await toAuditDtos(ctx, rows), total, page, pageSize };
  return ok(body);
}
