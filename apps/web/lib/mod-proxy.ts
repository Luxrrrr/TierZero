import type { ModPermission } from "@tier0/core";

/**
 * The rules the mod API proxy applies before anything reaches the bot. Kept
 * free of Next.js so each one can be tested as the security decision it is.
 */

/** Top-level paths the browser may reach. Anything else is a 404 here and never forwarded. */
export const MOD_PROXY_ROOTS: readonly string[] = [
  "members",
  "notes",
  "infractions",
  "audit",
  "stats",
  "staff",
  "member-search",
  "actions",
];

export const MOD_PROXY_MAX_BODY_BYTES = 32 * 1024;

/**
 * The permission a request needs, or null when the path is not one the proxy
 * serves. The bot re-checks the role on every write, but it cannot on a read
 * because reads carry no actor, so every read restriction lives here.
 */
export function modProxyPermission(method: string, path: readonly string[]): ModPermission | null {
  const [first, second] = path;
  if (!first || !MOD_PROXY_ROOTS.includes(first)) return null;
  if (path.some((segment) => segment === "" || segment === "." || segment === "..")) return null;

  // The settings an action form needs. The root exists for this one read and
  // nothing else, so any other path or method under it stays a 404.
  if (first === "actions") {
    return path.length === 2 && second === "context" && (method === "GET" || method === "HEAD") ? "view" : null;
  }

  // Taking action changes Discord, so only a POST is served. Warning is the
  // lowest action permission and every staff role that can act holds it; the
  // bot checks the specific action against the role on each request.
  if (first === "members" && path[2] === "actions") {
    return path.length === 3 && method === "POST" ? "action.warn" : null;
  }

  // What a member said lately, to attach to an action. Any staff member may read it, and the bot narrows
  // it to the channels that person can read themselves.
  if (first === "members" && path[2] === "messages") {
    return path.length === 3 && (method === "GET" || method === "HEAD") ? "action.warn" : null;
  }

  // The export is the whole action log in one file, which is an
  // admin's view of the server rather than a moderator's.
  if (first === "infractions" && second === "export") return "audit.view";
  if (first === "audit") return "audit.view";
  if (first === "stats") return "stats.view";
  if (first === "staff") return method === "GET" || method === "HEAD" ? "view" : "staff.manage";
  return "view";
}

export interface OriginHeaders {
  origin: string | null;
  secFetchSite: string | null;
  host: string | null;
  forwardedHost: string | null;
}

/**
 * Whether a state-changing request came from the dashboard's own pages. The
 * session cookie rides along on any request the browser makes, so without
 * this a page on another site could post a note or remove an action as
 * whoever happens to be signed in.
 */
export function isSameOriginWrite(method: string, headers: OriginHeaders): boolean {
  if (method === "GET" || method === "HEAD") return true;

  if (headers.secFetchSite !== null && headers.secFetchSite !== "same-origin") return false;

  // Every current browser sends Origin on a non-GET fetch. A request without
  // one is not from a dashboard page, so there is nothing to allow.
  if (!headers.origin) return false;

  let originHost: string;
  try {
    originHost = new URL(headers.origin).host.toLowerCase();
  } catch {
    return false;
  }

  const hosts = [headers.host, headers.forwardedHost?.split(",")[0]?.trim() ?? null]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  return hosts.includes(originHost);
}

/** Byte length of a UTF-8 string, which is what the body cap is measured in. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** A read of one member's whole record, the only reply that carries audit entries and note text. */
export function isProfileRead(method: string, path: string[]): boolean {
  return method === "GET" && path.length === 2 && path[0] === "members";
}

/** A read of the messages the bot remembers for one member. */
export function isMemberMessagesRead(method: string, path: readonly string[]): boolean {
  return method === "GET" && path.length === 3 && path[0] === "members" && path[2] === "messages";
}
