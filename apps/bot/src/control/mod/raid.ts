import { createHash, randomUUID } from "node:crypto";
import type { Guild, GuildMember } from "discord.js";
import {
  MASS_ACTION_LIMIT,
  can,
  type Actor,
  type LockedChannelDto,
  type MassActionKind,
  type MassActionRequest,
  type MassJobDto,
  type MassPreviewDto,
  type MassTargetDto,
  type ModuleContext,
  type RaidStatusDto,
} from "@tier0/core";
import { createInfraction, prisma } from "@tier0/db";
import {
  botCanLock,
  fetchMemberOrNull,
  joinTracker,
  lockChannels,
  lockableChannels,
  unlockChannels,
  type LockResult,
  type ModerationSettings,
} from "@tier0/module-moderation";
import type { GuildState } from "../../runtime/guild-state.js";
import { writeAudit } from "./audit.js";
import { refOf, resolveUsers } from "./names.js";
import { forbidden, notFound, ok, refuse, type ModCtx, type Reply } from "./types.js";

/**
 * The Raid tools tab: locking channels, and banning or kicking many members at
 * once. Both are for admins and the owner. A mass action is always previewed
 * first, and the run must name the count the preview showed, so what runs is
 * what was seen.
 */

type ModerationContext = ModuleContext<ModerationSettings>;

const MODULE_ID = "moderation";
export const RAID_MODULE_OFF = "Turn on the Moderation feature to use the raid tools.";
export const CANNOT_LOCK = "The bot needs the Manage Roles permission to change who can talk in channels. Give its role that permission, then try again.";
const MAX_LOCK_MS = 7 * 86_400_000;

async function moderationOf(ctx: ModCtx, state: GuildState): Promise<ModerationContext | null> {
  return (await state.context(ctx.guild, MODULE_ID)) as unknown as ModerationContext | null;
}

/** GET /mod/raid -> RaidStatusDto */
export async function raidStatus(ctx: ModCtx, state: GuildState): Promise<Reply> {
  const moduleCtx = await moderationOf(ctx, state);
  if (!moduleCtx) return refuse(409, "The Moderation settings for this server could not be read. Open them in the dashboard and save them again.");
  const rows = await prisma.lockedChannel.findMany({ where: { guildId: ctx.guild.id }, orderBy: { lockedAt: "desc" } });
  const refs = await resolveUsers(ctx.client, ctx.guild, rows.map((row) => row.lockedBy));
  const locked = new Set(rows.map((row) => row.channelId));
  const alert = moduleCtx.settings.joinAlert;
  const body: RaidStatusDto = {
    moduleEnabled: await state.isEnabled(ctx.guild.id, MODULE_ID),
    locked: rows.map(
      (row): LockedChannelDto => ({
        channelId: row.channelId,
        name: ctx.guild.channels.cache.get(row.channelId)?.name ?? null,
        lockedAt: row.lockedAt.toISOString(),
        lockedBy: refOf(refs, row.lockedBy),
        reason: row.reason,
        endsAt: row.endsAt ? row.endsAt.toISOString() : null,
      }),
    ),
    channels: lockableChannels(ctx.guild, moduleCtx.settings.lockdown.exemptChannels).map((channel) => ({ ...channel, locked: locked.has(channel.id) })),
    joinAlert: { enabled: alert.enabled, joins: alert.joins, seconds: Math.round(alert.window / 1000), lockdown: alert.lockdown },
    recentJoins: joinTracker.recent(ctx.guild.id, Date.now()),
    canManageChannels: botCanLock(ctx.guild),
  };
  return ok(body);
}

const SNOWFLAKE = /^\d{17,20}$/;

/** Reads `channels`: "all" or a list of channel ids. */
export function readChannels(value: unknown): "all" | string[] | null {
  if (value === "all") return "all";
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) return null;
  const ids = value.filter((id): id is string => typeof id === "string" && SNOWFLAKE.test(id));
  return ids.length === value.length ? [...new Set(ids)] : null;
}

async function lockAction(ctx: ModCtx, state: GuildState, actor: Actor, payload: Record<string, unknown>, lock: boolean): Promise<Reply> {
  if (!can(actor.role, "raid.lockdown")) return forbidden("lock or unlock channels. Admins and the owner can");
  const channels = readChannels(payload.channels);
  if (!channels) return refuse(400, "Choose the channels to change, or every channel.");
  if (!(await state.isEnabled(ctx.guild.id, MODULE_ID))) return refuse(409, RAID_MODULE_OFF);
  const moduleCtx = await moderationOf(ctx, state);
  if (!moduleCtx) return refuse(409, "The Moderation settings for this server could not be read. Open them in the dashboard and save them again.");
  if (!botCanLock(ctx.guild)) return refuse(409, CANNOT_LOCK);

  let result: LockResult;
  let reason: string | null = null;
  if (lock) {
    if (payload.reason !== undefined && payload.reason !== null && typeof payload.reason !== "string") return refuse(400, "The reason must be text.");
    reason = typeof payload.reason === "string" ? payload.reason.trim().slice(0, 300) || null : null;
    const length = payload.durationMs;
    if (length !== undefined && length !== null && (typeof length !== "number" || !Number.isInteger(length) || length < 60_000 || length > MAX_LOCK_MS)) {
      return refuse(400, "A lockdown can last from one minute to seven days, or until it is unlocked.");
    }
    const endsAt = typeof length === "number" ? new Date(Date.now() + length) : null;
    result = await lockChannels(moduleCtx, { channels, actorId: actor.userId, reason, endsAt });
  } else {
    result = await unlockChannels(moduleCtx, channels);
  }

  if (result.changed.length > 0 || result.failed.length > 0) {
    const count = (n: number) => `${n} ${n === 1 ? "channel" : "channels"}`;
    await writeAudit({
      guildId: ctx.guild.id,
      actor,
      kind: lock ? "raid.lockdown" : "raid.unlock",
      summary: `${lock ? "Locked" : "Unlocked"} ${count(result.changed.length)}${result.failed.length > 0 ? `, ${count(result.failed.length)} could not be changed` : ""}${reason ? `: ${reason}` : ""}`,
      after: { changed: result.changed, failed: result.failed, reason },
    }).catch((error: unknown) => console.error("mod: could not write the audit entry for a lockdown:", error));
  }

  const status = await raidStatus(ctx, state);
  const names = (ids: string[]) => ids.map((id) => ctx.guild.channels.cache.get(id)?.name ?? id);
  return ok({ [lock ? "locked" : "unlocked"]: result.changed.length, failed: names(result.failed), status: status.body });
}

export const lockFromDashboard = (ctx: ModCtx, state: GuildState, actor: Actor, payload: Record<string, unknown>) => lockAction(ctx, state, actor, payload, true);
export const unlockFromDashboard = (ctx: ModCtx, state: GuildState, actor: Actor, payload: Record<string, unknown>) => lockAction(ctx, state, actor, payload, false);

/* Mass actions ----------------------------------------------------------------------- */

export type ReadMass = { ok: true; request: MassActionRequest & { window: { after: Date; before: Date; open: boolean } | null } } | { ok: false; error: string };

const WINDOW_MAX_MS = 7 * 86_400_000;

/** Reads a mass action request: the action, and either pasted ids or a join window, never both. */
export function readMassRequest(payload: Record<string, unknown>, now: Date = new Date()): ReadMass {
  const action = payload.action;
  if (action !== "ban" && action !== "kick") return { ok: false, error: "Choose ban or kick." };
  if (payload.reason !== undefined && payload.reason !== null && typeof payload.reason !== "string") return { ok: false, error: "The reason must be text." };
  const reason = typeof payload.reason === "string" ? payload.reason.trim() || null : null;
  if (reason && reason.length > 500) return { ok: false, error: "A reason can be at most 500 characters." };
  const deleteDays = payload.deleteDays ?? 0;
  if (action === "ban" && (typeof deleteDays !== "number" || !Number.isInteger(deleteDays) || deleteDays < 0 || deleteDays > 7)) {
    return { ok: false, error: "Choose between 0 and 7 days of messages to delete." };
  }

  const hasIds = Array.isArray(payload.ids) && payload.ids.length > 0;
  const hasWindow = (payload.joinedAfter !== undefined && payload.joinedAfter !== null) || (payload.joinedBefore !== undefined && payload.joinedBefore !== null && payload.joinedBefore !== "");
  if (hasIds === hasWindow) return { ok: false, error: "Paste a list of user IDs, or choose a time window people joined in." };

  if (hasIds) {
    const raw = payload.ids as unknown[];
    if (raw.some((id) => typeof id !== "string" || !SNOWFLAKE.test(id))) return { ok: false, error: "One of the IDs is not a Discord user ID." };
    const ids = [...new Set(raw as string[])];
    if (ids.length > MASS_ACTION_LIMIT) return { ok: false, error: `A mass action can name at most ${MASS_ACTION_LIMIT} users at once.` };
    return { ok: true, request: { action, ids, reason, deleteDays: action === "ban" ? (deleteDays as number) : null, window: null } };
  }

  const after = typeof payload.joinedAfter === "string" ? new Date(payload.joinedAfter) : null;
  // No end means "until now", read when the request arrives so a preview and the run that follows see the same people.
  const open = payload.joinedBefore === undefined || payload.joinedBefore === null || payload.joinedBefore === "";
  const before = open ? now : typeof payload.joinedBefore === "string" ? new Date(payload.joinedBefore) : null;
  if (!after || !before || Number.isNaN(after.getTime()) || Number.isNaN(before.getTime())) return { ok: false, error: "Choose when the window starts, and when it ends if it did not run until now." };
  if (after.getTime() >= before.getTime()) return { ok: false, error: "The start of the window must be before its end." };
  if (before.getTime() - after.getTime() > WINDOW_MAX_MS) return { ok: false, error: "The window can be at most seven days long." };
  return {
    ok: true,
    request: {
      action,
      joinedAfter: after.toISOString(),
      joinedBefore: before.toISOString(),
      reason,
      deleteDays: action === "ban" ? (deleteDays as number) : null,
      window: { after, before, open },
    },
  };
}

export interface TargetFacts {
  id: string;
  member: { topRole: number; bannable: boolean; kickable: boolean } | null;
  isStaff: boolean;
}

export interface ActorFacts {
  id: string;
  /** Null when they are not in the server; then only the person running the install may act. */
  topRole: number | null;
  isInstanceOwner: boolean;
  isServerOwner: boolean;
}

/** Why one target is left alone, or null when the action goes ahead. The same rules a single action is held to. */
export function massSkip(action: MassActionKind, target: TargetFacts, actor: ActorFacts, botId: string | null, ownerId: string): string | null {
  if (target.id === actor.id) return "This is you.";
  if (target.id === botId) return "This is the bot.";
  if (target.id === ownerId) return "The server owner cannot be actioned.";
  if (target.isStaff) return "On this server's staff list.";
  if (action === "kick" && !target.member) return "Not in the server.";
  if (target.member) {
    const outranks = !actor.isInstanceOwner && !actor.isServerOwner && (actor.topRole === null || target.member.topRole >= actor.topRole);
    if (outranks) return "Has a role at or above yours.";
    if (action === "ban" ? !target.member.bannable : !target.member.kickable) return "The bot's role is not above theirs.";
  }
  return null;
}

async function membersByIds(guild: Guild, ids: string[]): Promise<Map<string, GuildMember>> {
  const found = new Map<string, GuildMember>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const fetched = await guild.members.fetch({ user: chunk }).catch(() => null);
    fetched?.forEach((member, id) => found.set(id, member));
  }
  return found;
}

async function staffIds(guildId: string): Promise<Set<string>> {
  const rows = await prisma.staffMember.findMany({ where: { guildId }, select: { userId: true } });
  const owner = process.env.INSTANCE_OWNER_ID || (await prisma.instance.findUnique({ where: { id: 1 } }))?.ownerId;
  return new Set([...rows.map((row) => row.userId), ...(owner ? [owner] : [])]);
}

interface Preview {
  dto: MassPreviewDto;
  go: string[];
}

async function preview(ctx: ModCtx, actor: Actor, request: ReadMass & { ok: true }): Promise<Preview | Reply> {
  const { guild } = ctx;
  let ids: string[];
  let members: Map<string, GuildMember>;
  if (request.request.window) {
    const all = await guild.members.fetch().catch(() => null);
    if (!all) return refuse(409, "The member list could not be read from Discord. Try again in a moment.");
    const { after, before } = request.request.window;
    const joined = [...all.values()].filter((member) => {
      const at = member.joinedAt?.getTime();
      return at !== undefined && at >= after.getTime() && at <= before.getTime();
    });
    if (joined.length > MASS_ACTION_LIMIT) {
      return refuse(409, `${joined.length} members joined in that window, more than the ${MASS_ACTION_LIMIT} a mass action can take at once. Narrow the window.`);
    }
    ids = joined.map((member) => member.id);
    members = new Map(joined.map((member) => [member.id, member]));
  } else {
    ids = request.request.ids ?? [];
    members = await membersByIds(guild, ids);
  }

  const [staff, actorMember, refs] = await Promise.all([staffIds(guild.id), fetchMemberOrNull(guild, actor.userId).catch(() => null), resolveUsers(ctx.client, guild, ids)]);
  const actorFacts: ActorFacts = {
    id: actor.userId,
    topRole: actorMember?.roles.highest.position ?? null,
    isInstanceOwner: actor.role === "owner",
    isServerOwner: actor.userId === guild.ownerId,
  };
  if (!actorFacts.isInstanceOwner && actorFacts.topRole === null) {
    return refuse(403, "You need to be a member of this server to act on members here, because the bot compares your roles with theirs.");
  }
  const botId = ctx.client.user?.id ?? null;
  const targets: MassTargetDto[] = ids.map((id) => {
    const member = members.get(id) ?? null;
    const skip = massSkip(
      request.request.action,
      { id, member: member ? { topRole: member.roles.highest.position, bannable: member.bannable, kickable: member.kickable } : null, isStaff: staff.has(id) },
      actorFacts,
      botId,
      guild.ownerId,
    );
    return {
      user: { ...refOf(refs, id), inServer: member !== null },
      joinedAt: member?.joinedAt ? member.joinedAt.toISOString() : null,
      accountCreatedAt: member ? member.user.createdAt.toISOString() : null,
      skip,
    };
  });
  const go = targets.filter((target) => target.skip === null).map((target) => target.user.userId);
  return { dto: { action: request.request.action, targets, count: go.length, skipped: targets.length - go.length, token: massToken(request.request.action, go, request.request.joinedAfter, request.request.window?.open ? null : request.request.joinedBefore) }, go };
}

/** Identifies the set a preview showed, so a confirmation of a different set with the same size is refused. */
export function massToken(action: string, go: readonly string[], after: string | null | undefined, before: string | null | undefined): string {
  const hash = createHash("sha256");
  hash.update(`${action}\n${after ?? ""}\n${before ?? ""}\n${[...go].sort().join(",")}`);
  return hash.digest("hex").slice(0, 32);
}

const isReply = (value: Preview | Reply): value is Reply => "status" in value;

async function massGate(ctx: ModCtx, state: GuildState, actor: Actor): Promise<Reply | ModerationContext> {
  if (!can(actor.role, "raid.mass")) return forbidden("ban or kick members in bulk. Admins and the owner can");
  if (!(await state.isEnabled(ctx.guild.id, MODULE_ID))) return refuse(409, RAID_MODULE_OFF);
  const moduleCtx = await moderationOf(ctx, state);
  if (!moduleCtx) return refuse(409, "The Moderation settings for this server could not be read. Open them in the dashboard and save them again.");
  return moduleCtx;
}

/** POST /mod/raid/mass/preview -> MassPreviewDto. Changes nothing. */
export async function massPreview(ctx: ModCtx, state: GuildState, actor: Actor, payload: Record<string, unknown>): Promise<Reply> {
  const gate = await massGate(ctx, state, actor);
  if ("status" in gate) return gate;
  const request = readMassRequest(payload);
  if (!request.ok) return refuse(400, request.error);
  const result = await preview(ctx, actor, request);
  return isReply(result) ? result : ok(result.dto);
}

type Job = MassJobDto & { guildId: string; finishedAt: number | null };

const jobs = new Map<string, Job>();
const starting = new Set<string>();
const JOB_KEEP_MS = 60 * 60_000;

function pruneJobs(now: number): void {
  for (const [id, job] of jobs) if (job.finishedAt !== null && now - job.finishedAt > JOB_KEEP_MS) jobs.delete(id);
}

const publicJob = (job: Job): MassJobDto => {
  const { guildId: _guild, finishedAt: _finished, ...rest } = job;
  return { ...rest, failures: [...rest.failures] };
};

/** POST /mod/raid/mass { ...request, confirm } -> MassJobDto. Starts the work and answers at once; poll the job. */
export async function massRun(ctx: ModCtx, state: GuildState, actor: Actor, payload: Record<string, unknown>): Promise<Reply> {
  const gate = await massGate(ctx, state, actor);
  if ("status" in gate) return gate;
  const moduleCtx = gate;
  const request = readMassRequest(payload);
  if (!request.ok) return refuse(400, request.error);
  pruneJobs(Date.now());
  // Claimed in the same tick as the check, before the slow member fetch, so two requests together cannot both pass.
  if (starting.has(ctx.guild.id) || [...jobs.values()].some((job) => job.guildId === ctx.guild.id && job.status === "running")) {
    return refuse(409, "A mass action is already running on this server. Wait for it to finish.");
  }
  starting.add(ctx.guild.id);
  let job: Job;
  let result: Preview;
  try {
    const made = await preview(ctx, actor, request);
    if (isReply(made)) return made;
    result = made;
    if (payload.confirm !== result.dto.count || payload.token !== result.dto.token) {
      return refuse(409, `The preview no longer matches: ${result.dto.count} would be acted on now. Preview again and check the list before you confirm.`);
    }
    if (result.go.length === 0) return refuse(409, "Nobody on the list can be acted on, so nothing was done.");

    job = { id: randomUUID(), action: request.request.action, status: "running", total: result.go.length, done: 0, failed: 0, failures: [], guildId: ctx.guild.id, finishedAt: null };
    jobs.set(job.id, job);
  } finally {
    starting.delete(ctx.guild.id);
  }
  const running = runJob(ctx, moduleCtx, actor, request.request, result, job)
    .catch((error: unknown) => {
      console.error(`mod: mass ${job.action} in guild ${ctx.guild.id} failed:`, error);
      job.failures.push("The rest could not be done because of an error. Check the bot's logs.");
      job.status = "done";
      job.finishedAt = Date.now();
    })
    .finally(() => settled.delete(running));
  settled.add(running);
  return ok(publicJob(job));
}

const settled = new Set<Promise<void>>();

/** Resolves once every mass job started so far has finished, so a test need not guess how long one takes. */
export async function massIdle(): Promise<void> {
  while (settled.size > 0) await Promise.all([...settled]);
}

/** GET /mod/raid/mass/:id -> MassJobDto */
export function massJob(ctx: ModCtx, id: string): Reply {
  const job = jobs.get(id);
  if (!job || job.guildId !== ctx.guild.id) return notFound("That mass action");
  return ok(publicJob(job));
}

async function runJob(
  ctx: ModCtx,
  moduleCtx: ModerationContext,
  actor: Actor,
  request: MassActionRequest,
  planned: Preview,
  job: Job,
): Promise<void> {
  const { guild } = ctx;
  const reason = request.reason ?? undefined;
  const names = new Map(planned.dto.targets.map((target) => [target.user.userId, target.user.name ?? target.user.userId]));
  const record = async (userId: string) => {
    await createInfraction({ guildId: guild.id, userId, moderatorId: actor.userId, action: request.action, reason: request.reason, expiresAt: null, active: true, evidence: "[]" });
    if (request.action === "ban") await moduleCtx.tasks.cancel("unban", { userId });
  };

  if (request.action === "ban") {
    // One call for the whole list. Discord says which ids it banned and which it could not.
    const outcome = await guild.bans
      .bulkCreate(planned.go, { reason, deleteMessageSeconds: (request.deleteDays ?? 0) * 86_400 })
      .catch((error: unknown) => {
        console.warn(`mod: bulk ban refused in guild ${guild.id}:`, error);
        return null;
      });
    const banned = outcome?.bannedUsers ?? [];
    for (const id of banned) {
      await record(id);
      job.done += 1;
    }
    const failed = outcome ? outcome.failedUsers : planned.go;
    job.done += failed.length;
    job.failed += failed.length;
    for (const id of failed) job.failures.push(`${names.get(id) ?? id} could not be banned.`);
  } else {
    for (const id of planned.go) {
      try {
        const member = await guild.members.fetch(id);
        await member.kick(reason);
        await record(id);
        job.done += 1;
      } catch {
        job.done += 1;
        job.failed += 1;
        job.failures.push(`${names.get(id) ?? id} could not be kicked.`);
      }
    }
  }

  const succeeded = job.done - job.failed;
  const window = request.joinedAfter && request.joinedBefore ? ` who joined between ${request.joinedAfter} and ${request.joinedBefore}` : " from a pasted list";
  await writeAudit({
    guildId: guild.id,
    actor,
    kind: "raid.mass",
    summary: `${request.action === "ban" ? "Banned" : "Kicked"} ${succeeded} ${succeeded === 1 ? "member" : "members"}${window}${job.failed > 0 ? ` (${job.failed} failed)` : ""}${request.reason ? `: ${request.reason.slice(0, 117)}` : ""}`,
    after: { action: request.action, succeeded, failed: job.failed, reason: request.reason, ids: planned.go },
  }).catch((error: unknown) => console.error("mod: could not write the audit entry for a mass action:", error));

  job.status = "done";
  job.finishedAt = Date.now();
}
