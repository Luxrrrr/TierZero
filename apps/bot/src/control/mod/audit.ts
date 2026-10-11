import { prisma } from "@tier0/db";
import type { Actor, AuditKind } from "@tier0/core";

export interface AuditEntry {
  guildId: string;
  actor: Actor;
  kind: AuditKind;
  summary: string;
  targetUserId?: string | null;
  infractionId?: number | null;
  noteId?: number | null;
  /** Snapshots are stored as JSON so an edit or removal can be read back whole. */
  before?: unknown;
  after?: unknown;
}

/** The prisma client or the one an interactive transaction hands out. */
export type AuditClient = Pick<typeof prisma, "modAudit">;

/**
 * Every change made through the mod dashboard is recorded here, by whoever
 * made it. Pass the transaction client to make the entry commit or roll back
 * together with the change it describes. Returns the new row's id.
 */
export async function writeAudit(entry: AuditEntry, client: AuditClient = prisma): Promise<number> {
  const row = await client.modAudit.create({
    data: {
      guildId: entry.guildId,
      actorId: entry.actor.userId,
      actorName: entry.actor.name,
      actorRole: entry.actor.role,
      kind: entry.kind,
      targetUserId: entry.targetUserId ?? null,
      infractionId: entry.infractionId ?? null,
      noteId: entry.noteId ?? null,
      summary: entry.summary,
      before: entry.before === undefined ? null : JSON.stringify(entry.before),
      after: entry.after === undefined ? null : JSON.stringify(entry.after),
    },
    select: { id: true },
  });
  return row.id;
}
