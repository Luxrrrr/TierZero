import {
  ticketListQuery,
  type TicketContextDto,
  type TicketDetailDto,
  type TicketListFilters,
  type TicketMessagesPage,
  type TicketPage,
  type TicketPanelStatusDto,
  type TicketStatsDto,
} from "@tier0/core";
import { ControlApiError, ticketsRequest } from "./control-api";

/**
 * Typed reads of the ticket workspace, for server components. Each names the
 * viewer, the signed-in user's Discord id from `requireTicketViewer`, because
 * the bot answers every read for that person: a handler's list holds only the
 * types they handle. Writes go through the browser to
 * `/api/guilds/:id/tickets/...`, which adds who is making them. A refusal from
 * the bot becomes a ControlApiError carrying its status.
 */

async function read<T>(guildId: string, path: string, viewerId: string, query = ""): Promise<T> {
  const viewer = `viewer=${encodeURIComponent(viewerId)}`;
  const { status, body } = await ticketsRequest(guildId, `${path}?${query ? `${query}&` : ""}${viewer}`);
  if (status < 200 || status >= 300) {
    const message = (body as { error?: string } | null)?.error ?? `The bot answered ${status}.`;
    throw new ControlApiError(status, message);
  }
  return body as T;
}

const ticketPath = (ticketId: number, rest = "") => `items/${encodeURIComponent(String(ticketId))}${rest}`;

export const ticketsContext = (guildId: string, viewerId: string) => read<TicketContextDto>(guildId, "context", viewerId);

export const ticketsList = (guildId: string, viewerId: string, filters: Partial<TicketListFilters> = {}) =>
  read<TicketPage>(guildId, "list", viewerId, ticketListQuery(filters));

export const ticketDetail = (guildId: string, viewerId: string, ticketId: number) =>
  read<TicketDetailDto>(guildId, ticketPath(ticketId), viewerId);

/** Stored messages, oldest first. `after` is the cursor of the previous page, to read only what is new. */
export const ticketMessages = (guildId: string, viewerId: string, ticketId: number, after?: string | null) =>
  read<TicketMessagesPage>(guildId, ticketPath(ticketId, "/messages"), viewerId, after ? `after=${encodeURIComponent(after)}` : "");

export const ticketStats = (guildId: string, viewerId: string, days: number) =>
  read<TicketStatsDto>(guildId, "stats", viewerId, `days=${encodeURIComponent(String(days))}`);

/** Managers only; the bot refuses anyone else with a 403. */
export const ticketPanels = (guildId: string, viewerId: string) => read<TicketPanelStatusDto[]>(guildId, "panels", viewerId);
