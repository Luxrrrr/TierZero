import type { Client, Guild } from "discord.js";
import type { TicketAccess, TicketError } from "@tier0/core";
import type { Reply } from "../mod/types.js";
import type { ViewerFacts } from "./access.js";
import type { TicketCtx, TicketServices } from "./runtime.js";

export type { Reply };

/** What every ticket handler is given once the viewer has been let in. */
export interface TicketEnv {
  client: Client;
  guild: Guild;
  ctx: TicketCtx;
  services: TicketServices;
  viewer: ViewerFacts;
  access: TicketAccess;
  /** The Tickets feature is switched on in this server. */
  enabled: boolean;
}

type Status = 400 | 403 | 404 | 409 | 429 | 503;

const CODES: Record<Status, NonNullable<TicketError["code"]>> = {
  400: "invalid",
  403: "forbidden",
  404: "notFound",
  409: "conflict",
  429: "rateLimited",
  503: "unavailable",
};

export const ok = (body: unknown): Reply => ({ status: 200, body });

export function fail(status: Status, error: string): Reply {
  const body: TicketError = { error, code: CODES[status] };
  return { status, body };
}

export const MODULE_OFF =
  "The Tickets feature is switched off in this server. Turn it on under Tickets in the dashboard to work tickets from here; what is already stored can still be read.";
export const SETTINGS_UNREADABLE =
  "The Tickets settings for this server could not be read. Open them in the dashboard and save them again.";
export const NO_ACCESS =
  "You do not handle any ticket type in this server. A member with Manage Server can add one of your roles as handlers of a type, or as an admin role.";
export const OTHER_TYPE = "You do not handle this type of ticket.";
