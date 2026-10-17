import type { Client, Guild } from "discord.js";
import { prisma } from "@tier0/db";
import { canTicket, parseTicketListFilters, readUpdatedSince } from "@tier0/core";
import { accessFor, actorOf, SNOWFLAKE, viewerFacts } from "./access.js";
import { messagesPage, ticketDetail } from "./detail.js";
import { accessTarget, ticketIdOf } from "./dto.js";
import { countTickets, findMembers, listTickets, panelList, statsDaysOf, ticketsAccess, ticketsContext, ticketStats, transcript } from "./reads.js";
import { moduleServices, type TicketCtx, type TicketServices } from "./runtime.js";
import { fail, MODULE_OFF, NO_ACCESS, ok, OTHER_TYPE, SETTINGS_UNREADABLE, type Reply, type TicketEnv } from "./types.js";
import { deleteTranscript, isTicketAction, postPanelFor, refusedText, writeTicket } from "./writes.js";

/** The parts of the guild state the ticket routes use, so a test can hand in a plain object. */
export interface TicketState {
  context(guild: Guild, moduleId: string): Promise<unknown>;
  isEnabled(guildId: string, moduleId: string): Promise<boolean>;
}

export interface TicketsRequest {
  client: Client;
  guild: Guild;
  state: TicketState;
  method: string;
  /** The path after `/guilds/:id/tickets/`, split on slashes. */
  segments: string[];
  query: URLSearchParams;
  body: unknown;
  /** The module's functions; tests replace them. */
  services?: TicketServices;
}

const MODULE_ID = "tickets";

/**
 * Routes one request under `/guilds/:id/tickets/`. Returns null for a path
 * that matches nothing.
 *
 * Every route, reads included, is checked against the viewer here. Reads name
 * the viewer in `viewer=`, writes in `actor`; the dashboard fills both in from
 * the signed-in session and the control API is only reachable with the shared
 * secret, so a browser cannot name someone else.
 */
export async function handleTickets(request: TicketsRequest): Promise<Reply | null> {
  const { client, guild, state, method, segments, query, body } = request;
  const [area, a, b, ...extra] = segments;
  if (extra.length > 0 || !isKnownRoute(method, area, a, b)) return null;

  const isRead = method === "GET";
  const claimedId = isRead ? query.get("viewer") : actorOf(body)?.userId;
  if (!claimedId || !SNOWFLAKE.test(claimedId)) return fail(400, "The request did not say who is making it.");

  const ctx = (await state.context(guild, MODULE_ID)) as TicketCtx | null;
  if (!ctx) return fail(409, SETTINGS_UNREADABLE);

  const viewer = await viewerFacts(guild, claimedId);
  const access = accessFor(viewer, ctx.settings);
  if (access.level === null) return fail(403, NO_ACCESS);

  const enabled = await state.isEnabled(guild.id, MODULE_ID);
  if (!isRead && !enabled) return fail(409, MODULE_OFF);

  const env: TicketEnv = { client, guild, ctx, services: request.services ?? moduleServices, viewer, access, enabled };
  const actor = isRead ? null : actorOf(body, viewer);

  if (isRead && area === "access") return ticketsAccess(env);
  if (isRead && area === "context") return ticketsContext(env);
  if (isRead && area === "list") return listTickets(env, parseTicketListFilters(query));
  if (isRead && area === "count") return countTickets(env, parseTicketListFilters(query));
  if (isRead && area === "members") return findMembers(env, query);
  if (isRead && area === "stats") return ticketStats(env, statsDaysOf(query.get("days")));

  if (area === "panels") {
    if (!canTicket(access, "settings")) return fail(403, refusedText("settings"));
    if (isRead) return panelList(env);
    return postPanelFor(env, a!, actor!);
  }

  const ticketId = ticketIdOf(a);
  if (ticketId === null) return fail(400, "That is not a ticket number.");
  const row = await prisma.ticket.findFirst({ where: { id: ticketId, guildId: guild.id } });
  if (!row) return fail(404, "That ticket was not found in this server.");
  if (!canTicket(access, "view", accessTarget(row))) return fail(403, OTHER_TYPE);

  if (isRead) {
    if (b === undefined) return ok(await ticketDetail(env, row));
    if (b === "messages") {
      const after = query.get("after");
      const cursor = after === null || after === "" ? null : ticketIdOf(after);
      if (after !== null && after !== "" && cursor === null) return fail(400, "The message cursor is not valid. Reload the ticket.");
      const since = readUpdatedSince(query.get("updatedSince"));
      if (!since.ok) return fail(400, "The change cursor is not valid. Reload the ticket.");
      return ok(await messagesPage(row, cursor, since.value, ctx.settings.transcripts));
    }
    return transcript(env, row, b === "transcript.html" ? "html" : "txt");
  }

  if (method === "DELETE") return deleteTranscript(env, row, actor!);
  return writeTicket(env, row, b as Parameters<typeof writeTicket>[2], actor!, body);
}

/** The route table, checked before anything is looked up so an unknown path is a plain 404. */
export function isKnownRoute(method: string, area: string | undefined, a: string | undefined, b: string | undefined): boolean {
  if (method === "GET") {
    if (area === "access" || area === "context" || area === "list" || area === "count" || area === "members" || area === "stats" || area === "panels") {
      return a === undefined && b === undefined;
    }
    if (area === "items" && a !== undefined) {
      return b === undefined || b === "messages" || b === "transcript.html" || b === "transcript.txt";
    }
    return false;
  }
  if (method === "POST") {
    if (area === "panels") return a !== undefined && a !== "" && b === "post";
    return area === "items" && a !== undefined && isTicketAction(b);
  }
  if (method === "DELETE") return area === "items" && a !== undefined && b === "transcript";
  return false;
}
