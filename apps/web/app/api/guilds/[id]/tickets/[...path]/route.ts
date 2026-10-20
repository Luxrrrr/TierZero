import { NextResponse } from "next/server";
import { readJsonObjectLimited } from "../../../../../../lib/body-limit";
import { ticketsRequest } from "../../../../../../lib/control-api";
import { botErrorResponse, failure } from "../../../../../../lib/api-helpers";
import { isTicketManager, ticketSession } from "../../../../../../lib/tickets-access";
import { isSameOriginWrite } from "../../../../../../lib/mod-proxy";
import {
  downloadFileName,
  ticketProxyBodyLimit,
  ticketProxyClass,
  ticketProxyTimeoutMs,
  ticketTarget,
  transcriptDownload,
  transcriptHeaders,
} from "../../../../../../lib/tickets-proxy";

/**
 * The browser's only way to the ticket workspace's data. It checks the request
 * came from a dashboard page, that the path is one the bot serves, and who is
 * signed in, and then forwards with that person as the viewer or the actor.
 * The bot works out what they may do from their roles and checks it on every
 * route; the routes that need Manage Server are also checked here.
 */

type Params = { params: Promise<{ id: string; path: string[] }> };

const GUILD_ID = /^\d{17,20}$/;

async function handle(method: string, request: Request, { params }: Params) {
  const { id, path } = await params;

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

  const needed = GUILD_ID.test(id) ? ticketProxyClass(method, path) : null;
  if (!needed) return failure(404, "There is nothing at this address.");

  const session = await ticketSession();
  if (!session.ok) return failure(session.status, session.message);
  if (needed === "manager" && !(await isTicketManager(session.userId, id))) {
    return failure(403, "Only a member with Manage Server can do that.");
  }

  let body: unknown;
  if (method !== "GET") {
    const read = await readJsonObjectLimited(request, ticketProxyBodyLimit(method, path));
    if (!read.ok) {
      return read.reason === "too-large"
        ? failure(413, "That is too long to send. Shorten it and try again.")
        : failure(400, "The request could not be read. Reload the page and try again.");
    }
    const sent = read.value;
    // Whatever the browser claimed about who is acting is replaced.
    body = { ...sent, actor: session.actor };
  }

  const search = new URL(request.url).searchParams;
  const target = ticketTarget(path, search, session.discordUserId, method);
  const download = transcriptDownload(method, path);

  try {
    const reply = await ticketsRequest(id, target, { method, body, timeoutMs: ticketProxyTimeoutMs(method, path, search), signal: request.signal });
    if (download && reply.file) {
      const filename = downloadFileName(reply.file.disposition, download.filename);
      return new Response(reply.file.text, { status: 200, headers: transcriptHeaders(download.format, filename) });
    }
    // A file on any other path, or JSON where a transcript was expected, is not passed on as a page.
    if (reply.file) return failure(502, "The bot sent an answer the dashboard did not expect. Reload the page and try again.");
    return NextResponse.json(reply.body, { status: reply.status, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return botErrorResponse(error);
  }
}

export const GET = (request: Request, context: Params) => handle("GET", request, context);
export const POST = (request: Request, context: Params) => handle("POST", request, context);
export const DELETE = (request: Request, context: Params) => handle("DELETE", request, context);
