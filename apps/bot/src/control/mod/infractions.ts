import { prisma } from "@tier0/db";
import { can, canVoidAction, type Actor, type InfractionDto, type Page } from "@tier0/core";
import { writeAudit } from "./audit.js";
import { buildExport, EXPORT_MAX_ROWS, exportFilename } from "./csv.js";
import {
  checkVoidReason,
  clip,
  describeCase,
  infractionDto,
  infractionSnapshot,
  type InfractionRow,
} from "./dto.js";
import { infractionWhere } from "./filters.js";
import { refOf, resolveUsers } from "./names.js";
import { timeoutRemovalReason } from "../../runtime/system-messages.js";
import { forbidden, notFound, ok, pageOf, refuse, type ModCtx, type Reply } from "./types.js";

const EXPORT_NAME_LOOKUPS = 300;

/** Both put a Discord timeout on the member, so removing either has to lift it. */
const TIMEOUT_ACTIONS = ["timeout", "automod-timeout"];

async function present(ctx: ModCtx, row: InfractionRow): Promise<InfractionDto> {
  const ids = [row.userId, row.moderatorId];
  if (row.voidedBy) ids.push(row.voidedBy);
  if (row.editedBy) ids.push(row.editedBy);
  const refs = await resolveUsers(ctx.client, ctx.guild, ids);
  return infractionDto(row, (id) => refOf(refs, id));
}

/** The case, only when it belongs to this server. */
async function findCase(ctx: ModCtx, id: number): Promise<InfractionRow | null> {
  const row = await prisma.infraction.findUnique({ where: { id } });
  return row && row.guildId === ctx.guild.id ? row : null;
}

/** GET /mod/infractions?action=&moderatorId=&userId=&state=all|onrecord|inforce|expired|removed&status=active|voided|all (older, ignored when state is given)&source=all|manual|automod&q=&page=&pageSize= -> Page of InfractionDto */
export async function listInfractions(ctx: ModCtx, query: URLSearchParams): Promise<Reply> {
  const { page, pageSize } = pageOf(query);
  const where = infractionWhere(ctx.guild.id, query);
  const [total, rows] = await Promise.all([
    prisma.infraction.count({ where }),
    prisma.infraction.findMany({
      where,
      orderBy: { id: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.userId);
    ids.add(row.moderatorId);
    if (row.voidedBy) ids.add(row.voidedBy);
    if (row.editedBy) ids.add(row.editedBy);
  }
  const refs = await resolveUsers(ctx.client, ctx.guild, ids);
  const body: Page<InfractionDto> = {
    items: rows.map((row) => infractionDto(row, (id) => refOf(refs, id))),
    total,
    page,
    pageSize,
  };
  return ok(body);
}

/**
 * GET /mod/infractions/export?action=&moderatorId=&userId=&state=&status=&source=&q= -> CSV.
 * Takes the same filters as the list. Newest first, at most EXPORT_MAX_ROWS.
 */
export async function exportInfractions(ctx: ModCtx, query: URLSearchParams): Promise<Reply> {
  const now = new Date();
  const rows = await prisma.infraction.findMany({
    where: infractionWhere(ctx.guild.id, query),
    orderBy: { id: "desc" },
    take: EXPORT_MAX_ROWS,
  });

  // Ids come newest first, so when the lookup allowance runs out it is the
  // oldest cases that keep a blank name. Remembered names are always used.
  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.userId);
    ids.add(row.moderatorId);
    if (row.voidedBy) ids.add(row.voidedBy);
    if (row.editedBy) ids.add(row.editedBy);
  }
  const refs = await resolveUsers(ctx.client, ctx.guild, ids, { maxFetches: EXPORT_NAME_LOOKUPS });

  return {
    status: 200,
    body: null,
    raw: {
      contentType: "text/csv; charset=utf-8",
      text: buildExport(rows, now, (id) => refs.get(id)?.name ?? null),
      filename: exportFilename(ctx.guild.id, now),
    },
  };
}

/**
 * Lifts the Discord timeout that a removed case put in place. This is best
 * effort: the removal itself must stand even when Discord says no, so the
 * outcome is returned as words for the audit entry instead of thrown.
 */
async function liftTimeout(ctx: ModCtx, row: InfractionRow, actor: Actor): Promise<string> {
  const now = new Date();
  if (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()) return "The timeout had already run out.";

  const newer = await prisma.infraction.findFirst({
    where: {
      guildId: row.guildId,
      userId: row.userId,
      action: { in: TIMEOUT_ACTIONS },
      active: true,
      voidedAt: null,
      id: { not: row.id },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });
  if (newer) return `Left the Discord timeout in place because case #${newer.caseNumber} is still in force.`;

  const member = await ctx.guild.members.fetch(row.userId).catch(() => null);
  if (!member) return "The member is not in the server, so there was no timeout to lift.";
  if (!member.communicationDisabledUntil || member.communicationDisabledUntil.getTime() <= now.getTime()) {
    return "The member was not timed out on Discord.";
  }
  try {
    await member.timeout(null, timeoutRemovalReason(ctx.labels?.timeoutRemovalReason, row.caseNumber, actor.name));
    return "Lifted the Discord timeout.";
  } catch {
    return "Could not lift the Discord timeout; the bot may lack permission or rank.";
  }
}

/**
 * Reply for a conditional write that matched nothing: the case was purged
 * (404) or another request got there first (409).
 */
async function lostRace(ctx: ModCtx, id: number, message: string): Promise<Reply> {
  return (await findCase(ctx, id)) ? refuse(409, message) : notFound("That case");
}

/** POST /mod/infractions/:id/void {actor, reason} -> InfractionDto. Staff may void warns and timeouts. */
export async function voidInfraction(ctx: ModCtx, id: number, actor: Actor, reason: unknown): Promise<Reply> {
  const seen = await findCase(ctx, id);
  if (!seen) return notFound("That case");
  if (!canVoidAction(actor.role, seen.action)) return forbidden(`remove a ${seen.action} from a record`);
  if (seen.voidedAt) return refuse(409, "That case has already been removed.");
  const checked = checkVoidReason(reason);
  if (!checked.ok) return refuse(400, checked.error);

  const target = (await resolveUsers(ctx.client, ctx.guild, [seen.userId])).get(seen.userId);
  const described = describeCase(seen, target ?? { userId: seen.userId, name: null, avatarUrl: null, inServer: false });
  const summary = [`Removed ${described}`, `Why: ${clip(checked.value)}`];

  // The row change and its audit entry commit together. Lifting the Discord
  // timeout is a call to another service that cannot be rolled back, so it
  // happens only after the commit, and its outcome is added to the entry then.
  const done = await prisma.$transaction(async (tx) => {
    const row = await tx.infraction.findFirst({ where: { id, guildId: ctx.guild.id } });
    if (!row) return null;
    const changed = await tx.infraction.updateMany({
      where: { id, guildId: ctx.guild.id, voidedAt: null },
      data: { voidedAt: new Date(), voidedBy: actor.userId, voidReason: checked.value, active: false },
    });
    if (changed.count === 0) return null;
    const updated = await tx.infraction.findUniqueOrThrow({ where: { id } });
    const auditId = await writeAudit(
      {
        guildId: ctx.guild.id,
        actor,
        kind: "infraction.void",
        summary: summary.join(". "),
        targetUserId: row.userId,
        infractionId: id,
        before: infractionSnapshot(row),
        after: infractionSnapshot(updated),
      },
      tx,
    );
    return { row, updated, auditId };
  });
  if (!done) return lostRace(ctx, id, "That case has already been removed.");

  if (TIMEOUT_ACTIONS.includes(done.row.action) && done.row.active) {
    try {
      const outcome = await liftTimeout(ctx, done.row, actor);
      await prisma.modAudit.updateMany({
        where: { id: done.auditId },
        data: { summary: [...summary, outcome].join(". ") },
      });
    } catch (error) {
      console.error("Could not finish lifting the timeout for a removed case:", error);
    }
  }
  return ok(await present(ctx, done.updated));
}

function wasActiveBefore(snapshot: string): boolean {
  try {
    const parsed: unknown = JSON.parse(snapshot);
    return typeof parsed === "object" && parsed !== null && (parsed as { active?: unknown }).active === true;
  } catch {
    return false;
  }
}

/** POST /mod/infractions/:id/restore {actor} -> InfractionDto */
export async function restoreInfraction(ctx: ModCtx, id: number, actor: Actor): Promise<Reply> {
  if (!can(actor.role, "infraction.restore")) return forbidden("restore a case to a record");
  const seen = await findCase(ctx, id);
  if (!seen) return notFound("That case");
  if (!seen.voidedAt) return refuse(409, "That case has not been removed.");

  const target = (await resolveUsers(ctx.client, ctx.guild, [seen.userId])).get(seen.userId);
  const described = describeCase(seen, target ?? { userId: seen.userId, name: null, avatarUrl: null, inServer: false });

  const done = await prisma.$transaction(async (tx) => {
    // Voiding clears `active`, so put it back from the snapshot taken then.
    // A timeout stays inactive: putting the member back under one long after
    // the fact is not something a restore should do.
    const voidEntry = await tx.modAudit.findFirst({
      where: { guildId: ctx.guild.id, infractionId: id, kind: "infraction.void" },
      orderBy: { id: "desc" },
    });
    const wasActive = voidEntry?.before ? wasActiveBefore(voidEntry.before) : false;
    const changed = await tx.infraction.updateMany({
      where: { id, guildId: ctx.guild.id, voidedAt: { not: null } },
      data: {
        voidedAt: null,
        voidedBy: null,
        voidReason: null,
        active: seen.action === "timeout" ? false : wasActive,
      },
    });
    if (changed.count === 0) return null;
    const updated = await tx.infraction.findUniqueOrThrow({ where: { id } });
    await writeAudit(
      {
        guildId: ctx.guild.id,
        actor,
        kind: "infraction.restore",
        summary: `Restored ${described}`,
        targetUserId: seen.userId,
        infractionId: id,
        before: infractionSnapshot(seen),
        after: infractionSnapshot(updated),
      },
      tx,
    );
    return updated;
  });
  if (!done) return lostRace(ctx, id, "That case has not been removed.");
  return ok(await present(ctx, done));
}

/** DELETE /mod/infractions/:id?purge=1 {actor}: owner only; removes the row and every audit row about it, leaving nothing */
export async function purgeInfraction(ctx: ModCtx, id: number, actor: Actor): Promise<Reply> {
  if (!can(actor.role, "purge")) return forbidden("permanently delete cases");

  // The row goes first and its count decides the outcome, so a repeated purge
  // finds nothing and answers 404 instead of throwing.
  const purged = await prisma.$transaction(async (tx) => {
    const removed = await tx.infraction.deleteMany({ where: { id, guildId: ctx.guild.id } });
    if (removed.count === 0) return false;
    await tx.modAudit.deleteMany({ where: { guildId: ctx.guild.id, infractionId: id } });
    return true;
  });
  return purged ? ok({ purged: true }) : notFound("That case");
}
