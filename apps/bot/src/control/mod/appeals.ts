import {
  APPEAL_LIMITS,
  can,
  isAppealStatus,
  readEvidence,
  type Actor,
  type AppealDetailDto,
  type AppealDto,
  type AppealListDto,
  type AppealStatus,
  type ModuleContext,
} from "@tier0/core";
import { prisma } from "@tier0/db";
import {
  ActionRefused,
  APPEAL_ACCEPTED_DM as APPEAL_ACCEPTED_FALLBACK,
  APPEAL_DENIED_DM as APPEAL_DENIED_FALLBACK,
  fetchBanOrNull,
  fetchMemberOrNull,
  formatEvidence,
  performAction,
  retryNote,
  type ModerationSettings,
} from "@tier0/module-moderation";
import type { GuildState } from "../../runtime/guild-state.js";
import { writeAudit } from "./audit.js";
import { infractionDto, noteDto } from "./dto.js";
import { refOf, resolveUsers } from "./names.js";
import { forbidden, notFound, ok, pageOf, refuse, type ModCtx, type Reply } from "./types.js";

/**
 * The Appeals tab: banned members' appeals, read and decided by admins and the
 * owner. Accepting lifts the ban through the same performer every unban uses,
 * so it is recorded, posted to the mod log and audited like any other.
 */

type ModerationContext = ModuleContext<ModerationSettings>;

export const APPEALS_MODULE_OFF = "Turn on the Moderation feature to decide appeals, because accepting one lifts the ban through it.";

interface AppealRow {
  id: number;
  guildId: string;
  userId: string;
  infractionId: number;
  caseNumber: number;
  text: string;
  status: string;
  createdAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  decidedByName: string | null;
  response: string | null;
  infraction: { reason: string | null; createdAt: Date; expiresAt: Date | null; moderatorId: string; voidedAt: Date | null };
}

type Lookup = (id: string) => ReturnType<typeof refOf>;

export function appealDto(row: AppealRow, ref: Lookup): AppealDto {
  const status: AppealStatus = isAppealStatus(row.status) ? row.status : "pending";
  return {
    id: row.id,
    user: ref(row.userId),
    caseNumber: row.caseNumber,
    infractionId: row.infractionId,
    status,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
    decided:
      status !== "pending" && row.decidedAt
        ? { at: row.decidedAt.toISOString(), by: { ...ref(row.decidedBy ?? ""), name: ref(row.decidedBy ?? "").name ?? row.decidedByName }, response: row.response }
        : null,
    ban: {
      reason: row.infraction.reason,
      createdAt: row.infraction.createdAt.toISOString(),
      expiresAt: row.infraction.expiresAt ? row.infraction.expiresAt.toISOString() : null,
      moderator: ref(row.infraction.moderatorId),
      removed: row.infraction.voidedAt !== null,
    },
  };
}

const INCLUDE = { infraction: { select: { reason: true, createdAt: true, expiresAt: true, moderatorId: true, voidedAt: true } } } as const;

function idsOf(rows: AppealRow[]): string[] {
  return rows.flatMap((row) => [row.userId, row.infraction.moderatorId, ...(row.decidedBy ? [row.decidedBy] : [])]);
}

/** GET /mod/appeals?status=pending|accepted|denied|all&page=&pageSize= -> AppealListDto, newest first. Pending is the default. */
export async function listAppeals(ctx: ModCtx, query: URLSearchParams): Promise<Reply> {
  const asked = query.get("status");
  const status = asked === "all" ? null : isAppealStatus(asked) ? asked : "pending";
  const { page, pageSize } = pageOf(query);
  const where = { guildId: ctx.guild.id, ...(status ? { status } : {}) };
  const [total, pending, rows] = await Promise.all([
    prisma.appeal.count({ where }),
    prisma.appeal.count({ where: { guildId: ctx.guild.id, status: "pending" } }),
    prisma.appeal.findMany({ where, include: INCLUDE, orderBy: { id: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  const refs = await resolveUsers(ctx.client, ctx.guild, idsOf(rows));
  const body: AppealListDto = { items: rows.map((row) => appealDto(row, (id) => refOf(refs, id))), total, page, pageSize, pending };
  return ok(body);
}

async function findAppeal(ctx: ModCtx, id: number): Promise<AppealRow | null> {
  const row = await prisma.appeal.findUnique({ where: { id }, include: INCLUDE });
  return row && row.guildId === ctx.guild.id ? row : null;
}

/** GET /mod/appeals/:id -> AppealDetailDto: the appeal with the member's whole record, notes and other appeals. */
export async function appealDetail(ctx: ModCtx, id: number): Promise<Reply> {
  const row = await findAppeal(ctx, id);
  if (!row) return notFound("That appeal");
  const guildId = ctx.guild.id;
  const [infractions, notes, others, stillBanned] = await Promise.all([
    prisma.infraction.findMany({ where: { guildId, userId: row.userId }, orderBy: { id: "desc" } }),
    prisma.modNote.findMany({ where: { guildId, userId: row.userId }, orderBy: { id: "desc" } }),
    prisma.appeal.findMany({ where: { guildId, userId: row.userId, id: { not: row.id } }, include: INCLUDE, orderBy: { id: "desc" }, take: 25 }),
    fetchBanOrNull(ctx.guild, row.userId).then((ban) => ban !== null, () => null),
  ]);
  const refs = await resolveUsers(ctx.client, ctx.guild, [
    ...idsOf([row, ...others]),
    ...infractions.flatMap((r) => [r.moderatorId, ...(r.voidedBy ? [r.voidedBy] : []), ...(r.editedBy ? [r.editedBy] : [])]),
    ...notes.flatMap((n) => [n.authorId, ...(n.deletedBy ? [n.deletedBy] : [])]),
  ]);
  const ref = (userId: string) => refOf(refs, userId);
  const body: AppealDetailDto = {
    appeal: appealDto(row, ref),
    stillBanned,
    infractions: infractions.map((r) => infractionDto(r, ref, ctx.warnExpiryMs ?? null)),
    notes: notes.map((n) => noteDto(n, ref)),
    others: others.map((r) => appealDto(r, ref)),
  };
  return ok(body);
}

/** Reads what staff wrote back. Empty is allowed: the message then says only the decision. */
export function readResponse(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: "The message to the member must be text." };
  const text = value.trim();
  if (text.length > APPEAL_LIMITS.response) return { ok: false, error: `The message to the member can be at most ${APPEAL_LIMITS.response} characters.` };
  return { ok: true, value: text === "" ? null : text };
}

// One decision at a time per appeal, so a double click cannot unban twice or send two messages.
const deciding = new Set<number>();

const DM_FAILED = "The member could not be sent a direct message about the decision, most likely because they no longer share a server with the bot or do not accept messages from it.";
const NOT_BANNED_ANY_MORE = "They were not banned in Discord any more, so there was no ban to lift.";

/** POST /mod/appeals/:id/accept|deny { response } -> { appeal, notes }. */
export async function decideAppeal(
  ctx: ModCtx,
  state: GuildState,
  id: number,
  actor: Actor,
  decision: "accepted" | "denied",
  payload: Record<string, unknown>,
): Promise<Reply> {
  if (!can(actor.role, "appeals.manage")) return forbidden("decide ban appeals. Admins and the owner can");
  const response = readResponse(payload.response);
  if (!response.ok) return refuse(400, response.error);
  if (deciding.has(id)) return refuse(409, "Someone is deciding this appeal right now. Reload to see the outcome.");

  deciding.add(id);
  try {
    const row = await findAppeal(ctx, id);
    if (!row) return notFound("That appeal");
    if (row.status !== "pending") return refuse(409, "That appeal was already decided. Reload to see the decision.");
    if (!(await state.isEnabled(ctx.guild.id, "moderation"))) return refuse(409, APPEALS_MODULE_OFF);
    const moduleCtx = (await state.context(ctx.guild, "moderation")) as unknown as ModerationContext | null;
    if (!moduleCtx) return refuse(409, "The Moderation settings for this server could not be read. Open them in the dashboard and save them again.");

    const notes: string[] = [];
    let unbanCase: number | null = null;
    if (decision === "accepted") {
      try {
        const actorMember = await fetchMemberOrNull(ctx.guild, actor.userId);
        const outcome = await performAction(moduleCtx, {
          action: "unban",
          targetId: row.userId,
          targetName: refOf(await resolveUsers(ctx.client, ctx.guild, [row.userId]), row.userId).name ?? "That user",
          moderatorId: actor.userId,
          reason: moduleCtx.settings.labels.reasons.appealAccepted,
          durationMs: null,
          deleteDays: null,
          actorMember,
          actorIsInstanceOwner: actor.role === "owner",
          origin: "dashboard",
          // The member is told by the appeal's own message instead.
          noDirectMessage: true,
          // The decision writes the entry, and it says which case the unban became.
          audit: { skip: true },
        });
        unbanCase = outcome.record.caseNumber;
        notes.push(...outcome.notes);
      } catch (error) {
        if (!(error instanceof ActionRefused)) throw error;
        if (error.code !== "notBanned") return { status: error.status, body: { error: error.message } };
        notes.push(NOT_BANNED_ANY_MORE);
      }
    }

    const decidedAt = new Date();
    const claimed = await prisma.appeal.updateMany({
      where: { id, guildId: ctx.guild.id, status: "pending" },
      data: { status: decision, decidedAt, decidedBy: actor.userId, decidedByName: actor.name, response: response.value },
    });
    if (claimed.count === 0) return refuse(409, "That appeal was already decided. Reload to see the decision.");

    const refs = await resolveUsers(ctx.client, ctx.guild, [row.userId]);
    const name = refOf(refs, row.userId).name ?? row.userId;
    await writeAudit({
      guildId: ctx.guild.id,
      actor,
      kind: decision === "accepted" ? "appeal.accept" : "appeal.deny",
      summary: `${decision === "accepted" ? "Accepted" : "Denied"} the ban appeal of ${name} on case #${row.caseNumber}${unbanCase ? `, unbanned as case #${unbanCase}` : ""}${response.value ? `: ${response.value.slice(0, 117)}${response.value.length > 117 ? "..." : ""}` : ""}`,
      targetUserId: row.userId,
      infractionId: row.infractionId,
      after: { appealId: id, status: decision, response: response.value, unbanCase },
    }).catch((error: unknown) => console.error("mod: could not write the audit entry for an appeal:", error));

    const settings = moduleCtx.settings;
    // What the ban was for, so the member is not left to guess: its reason and the messages kept with it.
    const ban = row.infractionId ? await prisma.infraction.findUnique({ where: { id: row.infractionId } }).catch(() => null) : null;
    const evidence = settings.dmIncludeMessages === false ? { title: "", value: "" } : formatEvidence(readEvidence(ban?.evidence), settings.labels.notes);
    const values = {
      case: row.caseNumber,
      response: response.value ?? "",
      responseNote: response.value ? ` ${response.value}` : "",
      retryNote: decision === "denied" ? retryNote(settings, decidedAt) : "",
      reason: ban?.reason ?? settings.labels.actions.noReason,
      evidence: evidence.value,
      evidenceTitle: evidence.value === "" ? "" : evidence.title,
      when: `<t:${Math.floor(decidedAt.getTime() / 1000)}:f>`,
      created: decidedAt.toISOString(),
    };
    const sent = await ctx.client.users
      .fetch(row.userId)
      .then((user) =>
        moduleCtx.send(user, decision === "accepted" ? settings.appeals.acceptedMessage : settings.appeals.deniedMessage, values, {
          fallback: decision === "accepted" ? APPEAL_ACCEPTED_FALLBACK : APPEAL_DENIED_FALLBACK,
        }),
      )
      .catch(() => null);
    if (!sent) notes.push(DM_FAILED);

    const updated = await findAppeal(ctx, id);
    const all = await resolveUsers(ctx.client, ctx.guild, idsOf(updated ? [updated] : []));
    return ok({ appeal: updated ? appealDto(updated, (userId) => refOf(all, userId)) : null, notes });
  } finally {
    deciding.delete(id);
  }
}

