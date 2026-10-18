
/**
 * The rules the ticket API proxy applies before anything reaches the bot. Kept
 * free of Next.js so each one can be tested as the security decision it is.
 *
 * Unlike the mod proxy, this one does not decide most permissions: who may
 * work a ticket depends on their roles in the server and the ticket's type,
 * which only the bot knows, and the bot checks the viewer on every route,
 * reads included. What the proxy adds is the signed-in user in place of
 * whatever the browser claimed, and a first gate on the few routes that need
 * Manage Server.
 */

import { TICKET_REPLY_FILES_BYTES_MAX, TICKET_WAIT_MAX_SECONDS } from "@tier0/core";

/** Top-level paths the browser may reach. Anything else is a 404 here and never forwarded. */
export const TICKET_PROXY_ROOTS: readonly string[] = ["access", "context", "list", "count", "members", "stats", "templates", "panels", "create", "items"];

/** The reads at the top level, each one path long and open to anyone the bot lets into the workspace. */
const WORKSPACE_READS: readonly string[] = ["access", "context", "list", "count", "members", "stats", "templates"];

export const TICKET_PROXY_MAX_BODY_BYTES = 32 * 1024;

/**
 * A reply may carry files, sent as base64 inside the JSON, which makes them a
 * third bigger. The bot checks the files themselves against Discord's limits;
 * this only lets a request that size through on that one route.
 */
export const TICKET_PROXY_MAX_REPLY_BODY_BYTES = Math.ceil((TICKET_REPLY_FILES_BYTES_MAX * 4) / 3) + 64 * 1024;

const isReplyWrite = (method: string, path: readonly string[]) =>
  method === "POST" && path.length === 3 && path[0] === "items" && path[2] === "reply";

/** The largest body a request may send, by route. */
export function ticketProxyBodyLimit(method: string, path: readonly string[]): number {
  return isReplyWrite(method, path) ? TICKET_PROXY_MAX_REPLY_BODY_BYTES : TICKET_PROXY_MAX_BODY_BYTES;
}

/** A read held with `wait` gets this long on top of the wait itself before the proxy gives up on the bot. */
const WAIT_GRACE_MS = 10_000;

/**
 * How long the bot may take. A reply with files waits for Discord to take the
 * upload, which a slow link stretches. The two reads that can be held with
 * `wait` get the longest wait they may ask for, and a little more, and no
 * other route does.
 */
export function ticketProxyTimeoutMs(method: string, path: readonly string[], search?: URLSearchParams): number | undefined {
  if (isReplyWrite(method, path)) return 60_000;
  if (search && isRead(method) && waitedSeconds(path, search) > 0) return TICKET_WAIT_MAX_SECONDS * 1000 + WAIT_GRACE_MS;
  return undefined;
}

/** Whether a path is one of the two reads that may be held. */
function mayWait(path: readonly string[]): boolean {
  return (path.length === 1 && path[0] === "count") || (path.length === 3 && path[0] === "items" && path[2] === "messages");
}

/** The seconds a request asks to be held, 0 for a route that cannot be held or a `wait` that is not a whole number. */
function waitedSeconds(path: readonly string[], search: URLSearchParams): number {
  const wait = search.get("wait");
  return mayWait(path) && wait !== null && WHOLE_NUMBER.test(wait) ? Math.min(Number(wait), TICKET_WAIT_MAX_SECONDS) : 0;
}

/**
 * `workspace`: anyone signed in may ask, and the bot decides from their roles.
 * `manager`: Manage Server or the instance owner, checked here as well as in the bot.
 */
export type TicketProxyClass = "workspace" | "manager";

export const TICKET_WRITE_ACTIONS: readonly string[] = [
  "reply",
  "claim",
  "unclaim",
  "priority",
  "notes",
  "members",
  "transfer",
  "close",
  "reopen",
  "rename",
  "request-close",
];

const TICKET_ID = /^[1-9]\d{0,8}$/;
const WHOLE_NUMBER = /^[0-9]{1,6}$/;
const PANEL_ID = /^[A-Za-z0-9_-]{1,32}$/;
const isRead = (method: string) => method === "GET" || method === "HEAD";

/**
 * The class of permission a request needs, or null when the path is not one
 * the proxy serves. The table matches the bot's route table exactly, so a path
 * the bot would not answer is never forwarded.
 */
export function ticketProxyClass(method: string, path: readonly string[]): TicketProxyClass | null {
  const [first, second, third] = path;
  if (!first || !TICKET_PROXY_ROOTS.includes(first)) return null;
  if (path.some((segment) => segment === "" || segment === "." || segment === ".." || /[/\\]/.test(segment))) return null;

  if (WORKSPACE_READS.includes(first)) {
    return path.length === 1 && isRead(method) ? "workspace" : null;
  }

  // Opening a ticket as staff: the bot checks the viewer handles the type.
  if (first === "create") return path.length === 1 && method === "POST" ? "workspace" : null;

  if (first === "panels") {
    if (path.length === 1) return isRead(method) ? "manager" : null;
    return path.length === 3 && method === "POST" && PANEL_ID.test(second!) && third === "post" ? "manager" : null;
  }

  // items/:id and what hangs off it.
  if (!second || !TICKET_ID.test(second) || path.length > 3) return null;
  if (path.length === 2) return isRead(method) ? "workspace" : null;
  if (isRead(method)) {
    return third === "messages" || third === "transcript.html" || third === "transcript.txt" ? "workspace" : null;
  }
  if (method === "DELETE") return third === "transcript" ? "manager" : null;
  if (method === "POST") return TICKET_WRITE_ACTIONS.includes(third!) ? "workspace" : null;
  return null;
}

/** Query keys the browser may pass through, per read. `viewer` is never among them: the proxy sets it. */
const LIST_QUERY = ["status", "type", "priority", "claimed", "opener", "q", "sort", "page", "rating", "handler", "from", "to", "after"];

/** The keys that name a number of seconds or a version, passed on only when they are whole numbers. */
const NUMBER_KEYS: readonly string[] = ["wait", "version", "detailVersion"];
const VERSION_NUMBER = /^[0-9]{1,16}$/;

function passable(key: string, value: string): boolean {
  if (!NUMBER_KEYS.includes(key)) return true;
  return key === "wait" ? WHOLE_NUMBER.test(value) : VERSION_NUMBER.test(value);
}

const PASSED_QUERY: Record<string, readonly string[]> = {
  list: LIST_QUERY,
  count: [...LIST_QUERY, "wait", "version"],
  members: ["q", "ids"],
  stats: ["days"],
  messages: ["after", "updatedSince", "wait", "detailVersion"],
};

/**
 * The path and query forwarded to the bot. Only the keys a route reads are
 * kept, and the viewer is the signed-in user, whatever the browser sent.
 */
export function ticketTarget(path: readonly string[], search: URLSearchParams, viewerId: string, method: string): string {
  const route = path[0] === "items" ? (path[2] === "messages" ? "messages" : "") : (path[0] ?? "");
  const query = new URLSearchParams();
  if (isRead(method)) {
    for (const key of PASSED_QUERY[route] ?? []) {
      for (const value of search.getAll(key)) if (passable(key, value)) query.append(key, value);
    }
    query.set("viewer", viewerId);
  }
  const text = query.toString();
  return `${path.map(encodeURIComponent).join("/")}${text ? `?${text}` : ""}`;
}

/** A transcript download, with the file name the browser is given. Null for any other path. */
export function transcriptDownload(method: string, path: readonly string[]): { format: "html" | "txt"; filename: string } | null {
  if (!isRead(method) || path.length !== 3 || path[0] !== "items" || !TICKET_ID.test(path[1] ?? "")) return null;
  if (path[2] === "transcript.html") return { format: "html", filename: `ticket-${path[1]}-transcript.html` };
  if (path[2] === "transcript.txt") return { format: "txt", filename: `ticket-${path[1]}-transcript.txt` };
  return null;
}

/**
 * The file name the bot gave a download, which carries the number members
 * see, or the fallback made from the address when it gave none.
 */
export function downloadFileName(disposition: string | null | undefined, fallback: string): string {
  const named = /filename="([^"]{1,120})"/.exec(disposition ?? "")?.[1];
  return named && /^[A-Za-z0-9._-]+$/.test(named) ? named : fallback;
}

/**
 * Served with the HTML transcript. The document holds what members wrote, so
 * it is treated as hostile even though it is escaped: `sandbox` gives it an
 * opaque origin with scripts off, so even a flaw in the escaping could not
 * reach the dashboard's cookies or call its API, and it is always a download.
 */
export const TRANSCRIPT_HTML_CSP =
  "sandbox; default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function transcriptHeaders(format: "html" | "txt", filename: string): Record<string, string> {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  return {
    "content-type": format === "html" ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
    "content-disposition": `attachment; filename="${safe}"`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cross-origin-resource-policy": "same-origin",
    "content-security-policy": format === "html" ? TRANSCRIPT_HTML_CSP : "sandbox; default-src 'none'",
  };
}
