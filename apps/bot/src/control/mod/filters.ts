import type { Prisma } from "@tier0/db";
import { isInForce, isWarning } from "@tier0/core";

/**
 * Query-string parsing for the action log and the audit trail, kept apart from
 * the handlers so the list and the CSV export build the same filter and can be
 * tested without a database.
 */

const SNOWFLAKE = /^\d{17,20}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const SEARCH_MAX = 200;

/**
 * Every action the bot writes. The restricting ones are found by asking the
 * shared in-force rule rather than listing them a second time, so a change to
 * that rule reaches the database filter too.
 */
const KNOWN_ACTIONS = [
  "warn",
  "timeout",
  "timeout-clear",
  "kick",
  "ban",
  "unban",
  "automod-warn",
  "automod-delete",
  "automod-timeout",
];

export const RESTRICTION_ACTIONS: string[] = KNOWN_ACTIONS.filter((action) =>
  isInForce({ action, active: true, expiresAt: null, removed: false }),
);

export const INFRACTION_STATES = ["all", "onrecord", "inforce", "expired", "removed"] as const;
export type InfractionState = (typeof INFRACTION_STATES)[number];

export function parseInfractionState(value: string | null): InfractionState | null {
  return INFRACTION_STATES.find((state) => state === value) ?? null;
}

const AUTOMOD_PREFIX = "automod-";

/** Who made the entry: staff by hand, or automod. Anything unrecognised means no restriction. */
export const INFRACTION_SOURCES = ["all", "manual", "automod"] as const;
export type InfractionSource = (typeof INFRACTION_SOURCES)[number];

export function parseInfractionSource(value: string | null): InfractionSource {
  return INFRACTION_SOURCES.find((source) => source === value) ?? "all";
}

/**
 * The part of the filter that depends on the clock, evaluated in the query so
 * paging and totals stay correct. Mirrors `isInForce` from the shared contract:
 * a restriction is in force when it is not removed, still flagged active, and
 * has no end or an end in the future. `expired` is the rest of the
 * restrictions that are still on the record, ended by time or cleared, and,
 * while the server's warn expiry is set, the warnings older than it, which is
 * what `caseStateOf` calls expired too.
 */
export function stateWhere(state: InfractionState, now: Date, warnExpiryMs: number | null = null): Prisma.InfractionWhereInput {
  switch (state) {
    case "all":
      return {};
    case "onrecord":
      return { voidedAt: null };
    case "removed":
      return { voidedAt: { not: null } };
    case "inforce":
      return {
        voidedAt: null,
        active: true,
        action: { in: RESTRICTION_ACTIONS },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      };
    case "expired": {
      const restrictions: Prisma.InfractionWhereInput = {
        action: { in: RESTRICTION_ACTIONS },
        OR: [{ active: false }, { expiresAt: { lte: now } }],
      };
      if (!warnExpiryMs || warnExpiryMs <= 0) return { voidedAt: null, ...restrictions };
      const warnings: Prisma.InfractionWhereInput = { action: { in: WARNING_ACTIONS }, createdAt: { lte: new Date(now.getTime() - warnExpiryMs) } };
      return { voidedAt: null, OR: [restrictions, warnings] };
    }
  }
}

export const WARNING_ACTIONS: string[] = KNOWN_ACTIONS.filter(isWarning);

/**
 * `state` is the full filter: all, onrecord (not removed), inforce, expired or
 * removed. The older `status=active|voided` still works when `state` is absent
 * or not recognised.
 */
export function infractionWhere(
  guildId: string,
  query: URLSearchParams,
  now: Date = new Date(),
  warnExpiryMs: number | null = null,
): Prisma.InfractionWhereInput {
  const where: Prisma.InfractionWhereInput = { guildId };
  const and: Prisma.InfractionWhereInput[] = [];

  const action = query.get("action");
  if (action) where.action = action;
  const moderatorId = query.get("moderatorId");
  if (moderatorId) where.moderatorId = moderatorId;
  const userId = query.get("userId");
  if (userId) where.userId = userId;

  const source = parseInfractionSource(query.get("source"));
  if (source === "automod") and.push({ action: { startsWith: AUTOMOD_PREFIX } });
  else if (source === "manual") and.push({ NOT: { action: { startsWith: AUTOMOD_PREFIX } } });

  const state = parseInfractionState(query.get("state"));
  if (state !== null) {
    and.push(stateWhere(state, now, warnExpiryMs));
  } else {
    const status = query.get("status");
    if (status === "active") where.voidedAt = null;
    else if (status === "voided") where.voidedAt = { not: null };
  }

  const q = (query.get("q") ?? "").trim().slice(0, SEARCH_MAX);
  if (q !== "") {
    const either: Prisma.InfractionWhereInput[] = [{ reason: { contains: q } }];
    // The dashboard prints case numbers as "#198", so that is what people paste.
    const caseNumber = /^#?\s*(\d{1,9})$/.exec(q)?.[1];
    if (caseNumber) either.push({ caseNumber: Number(caseNumber) });
    if (SNOWFLAKE.test(q)) either.push({ userId: q }, { moderatorId: q });
    and.push({ OR: either });
  }
  if (and.length > 0) where.AND = and;
  return where;
}

/**
 * Reads a calendar day from a query value. A plain `2026-10-09` is taken as
 * that UTC day; a full timestamp is taken as the UTC day it falls on. Anything
 * else, including a day that does not exist such as `2026-02-30`, is ignored.
 */
export function parseDay(value: string | null): number | null {
  if (value === null) return null;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const ms = Date.parse(`${text}T00:00:00.000Z`);
    return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== text ? null : ms;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const ms = Date.parse(text);
    if (Number.isNaN(ms)) return null;
    const date = new Date(ms);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }
  return null;
}

/**
 * `since` and `until` are whole UTC days, both inclusive: `until=2026-10-09`
 * includes everything up to 23:59:59.999 that day. A pair given the wrong way
 * round simply matches nothing.
 */
export function auditWhere(guildId: string, query: URLSearchParams): Prisma.ModAuditWhereInput {
  const where: Prisma.ModAuditWhereInput = { guildId };

  const kind = query.get("kind");
  if (kind) where.kind = kind;
  const actorId = query.get("actorId");
  // "automod" stands for the bot, whose id the dashboard does not have to know.
  if (actorId === "automod") where.actorRole = "automod";
  else if (actorId) where.actorId = actorId;
  const targetUserId = query.get("targetUserId");
  if (targetUserId) where.targetUserId = targetUserId;
  // Everything staff did on one case: making it, editing it, removing and restoring it.
  const infractionId = Number(query.get("infractionId"));
  if (Number.isInteger(infractionId) && infractionId > 0) where.infractionId = infractionId;

  const since = parseDay(query.get("since"));
  const until = parseDay(query.get("until"));
  if (since !== null || until !== null) {
    where.at = {
      ...(since !== null ? { gte: new Date(since) } : {}),
      ...(until !== null ? { lt: new Date(until + DAY_MS) } : {}),
    };
  }

  const q = (query.get("q") ?? "").trim().slice(0, SEARCH_MAX);
  if (q !== "") where.summary = { contains: q };
  return where;
}
