import type { Client, Guild } from "discord.js";
import type { Actor } from "@tier0/core";
import { staffRoleOf } from "@tier0/module-moderation";
import type { GuildState } from "../../runtime/guild-state.js";
import { systemLabels } from "../../runtime/system-messages.js";
import { actionContextFor, actionTarget, editInfraction, memberMessages, takeAction } from "./actions.js";
import { listAudit } from "./audit-list.js";
import { appealDetail, decideAppeal, listAppeals } from "./appeals.js";
import { lockFromDashboard, massJob, massPreview, massRun, raidStatus, unlockFromDashboard } from "./raid.js";
import { exportInfractions, listInfractions, purgeInfraction, restoreInfraction, voidInfraction } from "./infractions.js";
import { dangerCounts, dangerDelete } from "./danger.js";
import { listLoggedMessages, listServerLog, purgeServerLog } from "./server-log.js";
import { listMembers, memberProfile, searchGuildMembers } from "./members.js";
import { addNote, deleteNote, editNote, purgeNote, restoreNote } from "./notes.js";
import { listStaff, removeStaff, setStaff } from "./staff.js";
import { exportStats, modStats } from "./stats.js";
import { parseStatsRange } from "./stats-calc.js";
import { forbidden, refuse, type ModCtx, type Reply } from "./types.js";

const SNOWFLAKE = /^\d{17,20}$/;

export interface ModRequest {
  client: Client;
  guild: Guild;
  /** Module settings and enabled flags, for the handlers that act through a module. */
  state: GuildState;
  method: string;
  /** The path after `/guilds/:id/mod/`, split on slashes. */
  segments: string[];
  query: URLSearchParams;
  body: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads the actor the dashboard attached. The dashboard says which Discord account is
 * acting, from the signed-in session, and the bot works out what that account is on
 * the staff list itself. Whatever role the request claimed is ignored, so a
 * dashboard that forwarded the wrong one could not make anyone an owner.
 */
async function actorOf(guild: Guild, body: unknown): Promise<Actor | Reply> {
  if (!isRecord(body) || !isRecord(body.actor)) return refuse(400, "The request did not say who is making it.");
  const { userId, name } = body.actor;
  if (typeof userId !== "string" || !SNOWFLAKE.test(userId) || typeof name !== "string") {
    return refuse(400, "The request did not say who is making it.");
  }
  const role = await staffRoleOf(guild.id, userId);
  if (!role) return forbidden("use the moderation tools on this server. The owner can add you under Access");
  return { userId, name: name.slice(0, 80), role };
}

/**
 * Reads that depend on who is asking are given the viewer's account by the
 * dashboard. What that account may see is worked out here, from the staff list,
 * and replaces any owner or role the request carried.
 */
async function viewerIs(guild: Guild, query: URLSearchParams): Promise<Reply | null> {
  const viewer = query.get("viewer");
  const role = viewer !== null && SNOWFLAKE.test(viewer) ? await staffRoleOf(guild.id, viewer) : null;
  if (!role) return forbidden("use the moderation tools on this server. The owner can add you under Access");
  query.set("owner", role === "owner" ? "1" : "0");
  query.set("role", role);
  return null;
}

const idOf = (value: string | undefined): number | null => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const isReply = (value: Actor | Reply): value is Reply => "status" in value;

/** Routes one request under `/guilds/:id/mod/`. Returns null for a path that matches nothing. */
export async function handleMod(request: ModRequest): Promise<Reply | null> {
  const { client, guild, state, method, segments, query, body } = request;
  // The warn expiry is read whether or not Moderation is on, so the record reads the same either way.
  const moderation = (await state.context(guild, "moderation"))?.settings as { warnExpiry?: number } | undefined;
  const ctx: ModCtx = { client, guild, labels: await systemLabels(state, guild.id), warnExpiryMs: moderation?.warnExpiry ?? null };
  const [area, a, b] = segments;

  if (method === "GET") {
    const asksAsSomeone =
      (area === "members" && a !== undefined && (b === "messages" || b === "standing")) || area === "server-logs" || area === "messages";
    if (asksAsSomeone) {
      const refused = await viewerIs(guild, query);
      if (refused) return refused;
    }
    if (area === "actions" && a === "context" && b === undefined) return actionContextFor(ctx, state);
    if (area === "members" && a === undefined) return listMembers(ctx, query);
    if (area === "members" && a !== undefined && b === undefined) return memberProfile(ctx, a);
    // The viewer is named by the dashboard from the signed-in session, never by the browser.
    if (area === "members" && a !== undefined && b === "messages") {
      return memberMessages(ctx, a, query.get("viewer"), query.get("owner") === "1");
    }
    if (area === "members" && a !== undefined && b === "standing") {
      return actionTarget(ctx, a, query.get("viewer"), query.get("owner") === "1");
    }
    if (area === "server-logs" && a === undefined) return listServerLog(ctx, state, query);
    if (area === "messages" && a === undefined) return listLoggedMessages(ctx, state, query);
    if (area === "member-search") return searchGuildMembers(ctx, query.get("q") ?? "");
    if (area === "infractions" && a === undefined) return listInfractions(ctx, query);
    if (area === "infractions" && a === "export" && b === undefined) return exportInfractions(ctx, query);
    if (area === "audit" && a === undefined) return listAudit(ctx, query);
    if (area === "stats" && a === undefined) return modStats(ctx, parseStatsRange(query, new Date()));
    if (area === "stats" && a === "export" && b === undefined) {
      return exportStats(ctx, parseStatsRange(query, new Date()));
    }
    if (area === "staff" && a === undefined) return listStaff(ctx);
    if (area === "danger" && a === undefined) return dangerCounts(ctx);
    if (area === "appeals" && a === undefined) return listAppeals(ctx, query);
    if (area === "appeals" && a !== undefined && b === undefined) {
      const id = idOf(a);
      return id === null ? refuse(400, "Bad appeal id") : appealDetail(ctx, id);
    }
    if (area === "raid" && a === undefined) return raidStatus(ctx, state);
    if (area === "raid" && a === "mass" && b !== undefined && segments.length === 3) return massJob(ctx, b);
    return null;
  }

  const actor = await actorOf(guild, body);
  if (isReply(actor)) return actor;
  const payload = isRecord(body) ? body : {};

  if (method === "POST") {
    if (area === "members" && a !== undefined && b === "notes") return addNote(ctx, a, actor, payload.content);
    if (area === "members" && a !== undefined && b === "actions") return takeAction(ctx, state, a, actor, payload);
    if (area === "notes" && b === "restore") {
      const id = idOf(a);
      return id === null ? refuse(400, "Bad note id") : restoreNote(ctx, id, actor);
    }
    if (area === "infractions" && b === "void") {
      const id = idOf(a);
      return id === null ? refuse(400, "Bad case id") : voidInfraction(ctx, id, actor, payload.reason, { liftBan: payload.liftBan, state });
    }
    if (area === "infractions" && b === "restore") {
      const id = idOf(a);
      return id === null ? refuse(400, "Bad case id") : restoreInfraction(ctx, id, actor);
    }
    if (area === "appeals" && (b === "accept" || b === "deny") && segments.length === 3) {
      const id = idOf(a);
      return id === null ? refuse(400, "Bad appeal id") : decideAppeal(ctx, state, id, actor, b === "accept" ? "accepted" : "denied", payload);
    }
    if (area === "raid" && a === "lock" && b === undefined) return lockFromDashboard(ctx, state, actor, payload);
    if (area === "raid" && a === "unlock" && b === undefined) return unlockFromDashboard(ctx, state, actor, payload);
    if (area === "raid" && a === "mass" && b === undefined) return massRun(ctx, state, actor, payload);
    if (area === "raid" && a === "mass" && b === "preview" && segments.length === 3) return massPreview(ctx, state, actor, payload);
    return null;
  }

  if (method === "PATCH" && area === "infractions" && a !== undefined && b === undefined) {
    const id = idOf(a);
    return id === null ? refuse(400, "Bad case id") : editInfraction(ctx, state, id, actor, payload);
  }

  if (method === "PATCH" && area === "notes" && a !== undefined && b === undefined) {
    const id = idOf(a);
    return id === null ? refuse(400, "Bad note id") : editNote(ctx, id, actor, payload.content);
  }

  if (method === "PUT" && area === "staff" && a !== undefined && b === undefined) {
    return setStaff(ctx, a, actor, payload.role);
  }

  if (method === "DELETE") {
    const purge = query.get("purge") === "1";
    if (area === "notes" && a !== undefined && b === undefined) {
      const id = idOf(a);
      if (id === null) return refuse(400, "Bad note id");
      return purge ? purgeNote(ctx, id, actor) : deleteNote(ctx, id, actor);
    }
    if (area === "infractions" && a !== undefined && b === undefined) {
      const id = idOf(a);
      if (id === null) return refuse(400, "Bad case id");
      return purge ? purgeInfraction(ctx, id, actor) : forbidden("remove a case without voiding it first");
    }
    if (area === "staff" && a !== undefined && b === undefined) return removeStaff(ctx, a, actor);
    if (area === "server-logs" && a === undefined) return purgeServerLog(ctx, actor);
    if (area === "danger" && a === undefined) return dangerDelete(ctx, actor, query.get("targets"));
  }

  return null;
}
