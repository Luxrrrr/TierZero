import type { Client, Guild } from "discord.js";
import { isStaffRole, type Actor } from "@tier0/core";
import type { GuildState } from "../../runtime/guild-state.js";
import { actionContextFor, editInfraction, memberMessages, takeAction } from "./actions.js";
import { listAudit } from "./audit-list.js";
import { exportInfractions, listInfractions, purgeInfraction, restoreInfraction, voidInfraction } from "./infractions.js";
import { dangerDelete } from "./danger.js";
import { listLoggedMessages, listServerLog, purgeServerLog } from "./server-log.js";
import { listMembers, memberProfile, searchGuildMembers } from "./members.js";
import { addNote, deleteNote, editNote, purgeNote, restoreNote } from "./notes.js";
import { listStaff, removeStaff, setStaff } from "./staff.js";
import { modStats } from "./stats.js";
import { forbidden, refuse, type ModCtx, type Reply } from "./types.js";

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
 * Reads the actor the dashboard attached. The dashboard fills it in from the
 * signed-in session, and the control API is only reachable with the shared
 * secret, so nothing a browser sends can name itself an owner.
 */
function actorOf(body: unknown): Actor | null {
  if (!isRecord(body) || !isRecord(body.actor)) return null;
  const { userId, name, role } = body.actor;
  if (typeof userId !== "string" || !/^\d{17,20}$/.test(userId)) return null;
  if (typeof name !== "string" || !isStaffRole(role)) return null;
  return { userId, name: name.slice(0, 80), role };
}

const idOf = (value: string | undefined): number | null => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const isReply = (value: Actor | Reply): value is Reply => "status" in value;

/** Routes one request under `/guilds/:id/mod/`. Returns null for a path that matches nothing. */
export async function handleMod(request: ModRequest): Promise<Reply | null> {
  const { client, guild, state, method, segments, query, body } = request;
  const ctx: ModCtx = { client, guild };
  const [area, a, b] = segments;

  if (method === "GET") {
    if (area === "actions" && a === "context" && b === undefined) return actionContextFor(ctx, state);
    if (area === "members" && a === undefined) return listMembers(ctx, query);
    if (area === "members" && a !== undefined && b === undefined) return memberProfile(ctx, a);
    // The viewer is named by the dashboard from the signed-in session, never by the browser.
    if (area === "members" && a !== undefined && b === "messages") {
      return memberMessages(ctx, a, query.get("viewer"), query.get("owner") === "1");
    }
    if (area === "server-logs" && a === undefined) return listServerLog(ctx, state, query);
    if (area === "messages" && a === undefined) return listLoggedMessages(ctx, state, query);
    if (area === "member-search") return searchGuildMembers(ctx, query.get("q") ?? "");
    if (area === "infractions" && a === undefined) return listInfractions(ctx, query);
    if (area === "infractions" && a === "export" && b === undefined) return exportInfractions(ctx, query);
    if (area === "audit" && a === undefined) return listAudit(ctx, query);
    if (area === "stats") {
      const days = Math.min(365, Math.max(1, Math.trunc(Number(query.get("days"))) || 30));
      return modStats(ctx, days);
    }
    if (area === "staff" && a === undefined) return listStaff(ctx);
    return null;
  }

  const actor = actorOf(body) ?? refuse(400, "The request did not say who is making it.");
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
      return id === null ? refuse(400, "Bad case id") : voidInfraction(ctx, id, actor, payload.reason);
    }
    if (area === "infractions" && b === "restore") {
      const id = idOf(a);
      return id === null ? refuse(400, "Bad case id") : restoreInfraction(ctx, id, actor);
    }
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
