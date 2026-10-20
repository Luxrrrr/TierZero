import { prisma } from "@tier0/db";
import { can, canVoidAction, type Actor, type InfractionDto, type LiftResult, type Page, type VoidReply } from "@tier0/shared-moderation";
import { writeAudit } from "./audit.js";
import { buildExport, EXPORT_MAX_ROWS, exportFilename } from "./csv.js";
import {
  checkVoidReason,
  clip,
  describeCase,
  infractionDto,
  infractionSnapshot,
  BAN_LIFT_UNCONFIRMED,
  liftsBan,
  restoredActive,
  TIMEOUT_ACTIONS,
  type InfractionRow,
} from "./dto.js";
import { infractionWhere } from "./filters.js";
import { refOf, resolveUsers } from "./names.js";
import { fetchBanOrNull } from "@tier0/module-moderation";
import type { GuildState } from "../../runtime/guild-state.js";
import { banRemovalReason, timeoutRemovalReason } from "../../runtime/system-messages.js";
import { forbidden, notFound, ok, pageOf, refuse, type ModCtx, type Reply } from "./types.js";

const EXPORT_NAME_LOOKUPS = 300;

async function present(ctx: ModCtx, row: InfractionRow): Promise<InfractionDto> {
  const ids = [row.userId, row.moderatorId];
  if (row.voidedBy) ids.push(row.voidedBy);
  if (row.editedBy) ids.push(row.editedBy);
  const refs = await resolveUsers(ctx.client, ctx.guild, ids);
  return infractionDto(row, (id) => refOf(refs, id), ctx.warnExpiryMs ?? null);
}

/** The case, only when it belongs to this server. */
async function findCase(ctx: ModCtx, id: number): Promise<InfractionRow | null> {
  const row = await prisma.infraction.findUnique({ where: { id } });
  return row && row.guildId === ctx.guild.id ? row : null;
}

/** GET /mod/infractions?action=&moderatorId=&userId=&state=all|onrecord|inforce|expired|removed&status=active|voided|all (older, ignored when state is given)&source=all|manual|automod&q=&page=&pageSize= -> Page of InfractionDto */
export async function listInfractions(ctx: ModCtx, query: URLSearchParams): Promise<Reply> {
  const { page, pageSize } = pageOf(query);
  const where = infractionWhere(ctx.guild.id, query, new Date(), ctx.warnExpiryMs ?? null);
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
    items: rows.map((row) => infractionDto(row, (id) => refOf(refs, id), ctx.warnExpiryMs ?? null)),
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
    where: infractionWhere(ctx.guild.id, query, new Date(), ctx.warnExpiryMs ?? null),
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
      text: buildExport(rows, now, (id) => refs.get(id)?.name ?? null, ctx.warnExpiryMs ?? null),
      filename: exportFilename(ctx.guild.id, now),
    },
  };
}

/**
 * Lifts the Discord timeout that a removed case put in place. This is best
 * effort: the removal itself must stand even when Discord says no, so the
 * outcome is returned as words for the audit entry instead of thrown.
 */
export interface LiftOutcome {
  result: LiftResult;
  /** For the audit entry. */
  text: string;
}

const outcome = (result: LiftResult, text: string): LiftOutcome => ({ result, text });

async function liftTimeout(ctx: ModCtx, row: InfractionRow, actor: Actor): Promise<LiftOutcome> {
  const now = new Date();
  if (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()) return outcome("nothing", "The timeout had already run out.");

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
  if (newer) return outcome("kept", `Left the Discord timeout in place because case #${newer.caseNumber} is still in force.`);

  const member = await ctx.guild.members.fetch(row.userId).catch(() => null);
  if (!member) return outcome("nothing", "The member is not in the server, so there was no timeout to lift.");
  if (!member.communicationDisabledUntil || member.communicationDisabledUntil.getTime() <= now.getTime()) {
    return outcome("nothing", "The member was not timed out on Discord.");
  }
  try {
    await member.timeout(null, timeoutRemovalReason(ctx.labels?.timeoutRemovalReason, row.caseNumber, actor.name));
    return outcome("lifted", "Lifted the Discord timeout.");
  } catch {
    return outcome("failed", "Could not lift the Discord timeout; the bot may lack permission or rank.");
  }
}

/**
 * Lifts the Discord ban that a removed case put in place, so the record and
 * Discord agree. Best effort, like lifting a timeout: the removal stands
 * either way, and the outcome is returned as words for the audit entry.
 */
async function liftBan(ctx: ModCtx, state: GuildState | undefined, row: InfractionRow, actor: Actor): Promise<LiftOutcome> {
  const now = new Date();
  const newer = await prisma.infraction.findFirst({
    where: {
      guildId: row.guildId,
      userId: row.userId,
      action: "ban",
      active: true,
      voidedAt: null,
      id: { not: row.id },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });
  if (newer) return outcome("kept", `Left the Discord ban in place because case #${newer.caseNumber} is still in force.`);

  let banned: boolean;
  try {
    banned = (await fetchBanOrNull(ctx.guild, row.userId)) !== null;
  } catch {
    return outcome("failed", "Could not check the ban in Discord, so it was left as it is. Unban them from their record if they should be let back in.");
  }
  if (!banned) return outcome("nothing", "The member was not banned in Discord.");
  try {
    await ctx.guild.members.unban(row.userId, banRemovalReason(ctx.labels?.banRemovalReason, row.caseNumber, actor.name));
  } catch {
    return outcome("failed", "Could not lift the Discord ban; the bot may lack the Ban Members permission. Unban them from their record.");
  }
  // A temporary ban scheduled its own reversal, which has nothing left to do.
  const moduleCtx = state ? await state.context(ctx.guild, "moderation").catch(() => null) : null;
  await moduleCtx?.tasks.cancel("unban", { userId: row.userId }).catch(() => undefined);
  return outcome("lifted", "Lifted the Discord ban.");
}

/**
 * Reply for a conditional write that matched nothing: the case was purged
 * (404) or another request got there first (409).
 */
async function lostRace(ctx: ModCtx, id: number, message: string): Promise<Reply> {
  return (await findCase(ctx, id)) ? refuse(409, message) : notFound("That case");
}

/**
 * POST /mod/infractions/:id/void {actor, reason, liftBan?} -> InfractionDto. Staff may void warns and timeouts.
 * A ban still in force is lifted in Discord too, so the request must say `liftBan: true`.
 */
export async function voidInfraction(
  ctx: ModCtx,
  id: number,
  actor: Actor,
  reason: unknown,
  options: { liftBan?: unknown; state?: GuildState } = {},
): Promise<Reply> {
  const seen = await findCase(ctx, id);
  if (!seen) return notFound("That case");
  if (!canVoidAction(actor.role, seen.action)) return forbidden(`remove a ${seen.action} from a record`);
  if (seen.voidedAt) return refuse(409, "That case has already been removed.");
  const checked = checkVoidReason(reason);
  if (!checked.ok) return refuse(400, checked.error);
  if (liftsBan(seen, new Date()) && options.liftBan !== true) return refuse(409, BAN_LIFT_UNCONFIRMED);

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

  const kind: "ban" | "timeout" | null = TIMEOUT_ACTIONS.includes(done.row.action) && done.row.active ? "timeout" : liftsBan(done.row, new Date()) ? "ban" : null;
  let lift: VoidReply["lift"] = null;
  if (kind) {
    lift = { kind, result: "failed" };
    try {
      const lifted = kind === "timeout" ? await liftTimeout(ctx, done.row, actor) : await liftBan(ctx, options.state, done.row, actor);
      lift = { kind, result: lifted.result };
      await prisma.modAudit.updateMany({
        where: { id: done.auditId },
        data: { summary: [...summary, lifted.text].join(". ") },
      });
    } catch (error) {
      console.error("Could not finish lifting the restriction for a removed case:", error);
    }
  }
  const reply: VoidReply = { ...(await present(ctx, done.updated)), lift };
  return ok(reply);
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
  // Removing a ban lifted it in Discord, and a restore never bans again, so the case is only in force if Discord still
  // holds a ban. When Discord cannot be asked, it is left not in force, which the Unban option will still correct.
  const stillBanned = seen.action === "ban" ? await fetchBanOrNull(ctx.guild, seen.userId).then((ban) => ban !== null, () => false) : true;

  const done = await prisma.$transaction(async (tx) => {
    // Voiding clears `active`, so put it back from the snapshot taken then.
    // A timeout of either kind stays inactive: removing it lifted it, and
    // putting the member back under one long after the fact is not something a restore should do.
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
        active: restoredActive(seen.action, wasActive, stillBanned),
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
