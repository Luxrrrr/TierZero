import { prisma } from "@tier0/db";
import { AUDIT_KIND_LABEL, AUTOMOD_NAME, auditActorRole, isAutomodActor, type AuditDto, type AuditKind, type Page, type UserRef } from "@tier0/core";
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

/**
 * The case number an entry's snapshot carries, for a case that has since been
 * deleted for good and so can no longer be joined to.
 */
function snapshotCaseNumber(row: ModAuditRow): number | null {
  for (const raw of [row.after, row.before]) {
    const snapshot = parseSnapshot(raw);
    const value = snapshot && typeof snapshot === "object" ? (snapshot as Record<string, unknown>).caseNumber : undefined;
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  }
  return null;
}

/** Case numbers for every infraction id the rows mention, in one query. */
async function caseNumbersFor(guildId: string, rows: ModAuditRow[]): Promise<Map<number, number>> {
  const ids = [...new Set(rows.flatMap((row) => (row.infractionId !== null ? [row.infractionId] : [])))];
  if (ids.length === 0) return new Map();
  const found = await prisma.infraction.findMany({
    where: { guildId, id: { in: ids } },
    select: { id: true, caseNumber: true },
  });
  return new Map(found.map((row) => [row.id, row.caseNumber]));
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
  const [refs, caseNumbers] = await Promise.all([
    known ?? resolveUsers(ctx.client, ctx.guild, targets),
    caseNumbersFor(ctx.guild.id, rows),
  ]);
  const botId = ctx.client.user?.id;

  return rows.map((row) => {
    const automod = isAutomodActor({ userId: row.actorId, role: row.actorRole }, botId);
    return {
      id: row.id,
      at: row.at.toISOString(),
      // The name stored at the time is kept: it is what the actor was called when they acted.
      // Automod is the exception, because it has one name everywhere whatever an old row says.
      actor: {
        userId: row.actorId,
        name: automod ? AUTOMOD_NAME : row.actorName,
        role: automod ? ("automod" as const) : auditActorRole(row.actorRole),
      },
      // An unknown kind (a row from a newer version) still renders, with its raw name as the label.
      kind: row.kind as AuditKind,
      label: isKnownKind(row.kind) ? AUDIT_KIND_LABEL[row.kind] : row.kind,
      summary: row.summary,
      targetUser: row.targetUserId ? refOf(refs, row.targetUserId) : null,
      infractionId: row.infractionId,
      caseNumber: row.infractionId === null ? null : (caseNumbers.get(row.infractionId) ?? snapshotCaseNumber(row)),
      noteId: row.noteId,
      before: parseSnapshot(row.before),
      after: parseSnapshot(row.after),
    };
  });
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
