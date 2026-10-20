import { NextResponse } from "next/server";
import { readJsonObjectLimited } from "../../../../../../lib/body-limit";
import { messagesRequest } from "../../../../../../lib/control-api";
import { auth } from "../../../../../../lib/auth";
import { requireGuildAccess } from "../../../../../../lib/authz";
import { authzFailureResponse, botErrorResponse, failure } from "../../../../../../lib/api-helpers";
import { isSameOriginWrite } from "../../../../../../lib/mod-proxy";

/**
 * The browser's way to the message library and to sending. Who may use it is
 * the same as for the rest of a server's settings: someone who can manage the
 * server. Writes must come from a dashboard page, because a send posts as the
 * bot and a page on another site must not be able to trigger one.
 */

type Params = { params: Promise<{ id: string; path?: string[] }> };

/** Ten full embeds are well under this. It stops a pasted file being forwarded to the bot. */
const MAX_BODY_BYTES = 200_000;

/** The paths that exist, so the route is not a window onto the whole control API. */
function allowed(method: string, path: string[]): boolean {
  const [area, id, extra] = path;
  const isId = id !== undefined && /^\d+$/.test(id);
  if (method === "GET" && area === "templates" && isId && extra === "sends") return path.length === 3;
  if (extra !== undefined) return false;
  if (method === "GET") return path.length === 0 || (path.length === 1 && (area === "emojis" || area === "schedules" || area === "sends"));
  if (method === "POST") return (area === "folders" || area === "templates" || area === "send" || area === "edit" || area === "schedules") && id === undefined;
  if (method === "PATCH") return (area === "folders" || area === "templates") && isId;
  if (method === "DELETE") return (area === "folders" || area === "templates" || area === "schedules" || area === "sends") && isId;
  return false;
}

async function handle(method: string, request: Request, { params }: Params) {
  const { id, path = [] } = await params;

  if (
    !isSameOriginWrite(method, {
      origin: request.headers.get("origin"),
      secFetchSite: request.headers.get("sec-fetch-site"),
      host: request.headers.get("host"),
      forwardedHost: request.headers.get("x-forwarded-host"),
    })
  ) {
    return failure(403, "This request did not come from the dashboard. Reload the page and try again.");
  }
  if (!allowed(method, path)) return failure(404, "There is nothing at this address.");

  const access = await requireGuildAccess(id);
  if (!access.ok) return authzFailureResponse(access);

  let body: unknown;
  if (method === "POST" || method === "PATCH") {
    const read = await readJsonObjectLimited(request, MAX_BODY_BYTES);
    if (!read.ok) {
      return read.reason === "too-large"
        ? failure(413, "That message is too large to save.")
        : failure(400, "The request could not be read. Reload the page and try again.");
    }
    body = read.value;
    // A send says who sent it, for the {sender} variable, and who is sending, because the bot checks they may send there.
    // The browser cannot name itself.
    if (path[0] === "send" || path[0] === "edit" || path[0] === "schedules") {
      const session = await auth();
      body = { ...read.value, sender: session?.user?.name ?? "the dashboard", actor: access.discordUserId };
    }
  }

  try {
    const reply = await messagesRequest(id, path.map(encodeURIComponent).join("/"), { method, body });
    return NextResponse.json(reply.body, { status: reply.status });
  } catch (error) {
    return botErrorResponse(error);
  }
}

export const GET = (request: Request, context: Params) => handle("GET", request, context);
export const POST = (request: Request, context: Params) => handle("POST", request, context);
export const PATCH = (request: Request, context: Params) => handle("PATCH", request, context);
export const DELETE = (request: Request, context: Params) => handle("DELETE", request, context);
