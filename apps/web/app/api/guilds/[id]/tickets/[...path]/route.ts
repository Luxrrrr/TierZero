import { NextResponse } from "next/server";
import { ControlApiError, ticketsRequest } from "../../../../../../lib/control-api";
import { isTicketManager, ticketSession } from "../../../../../../lib/tickets-access";
import { isSameOriginWrite, utf8Length } from "../../../../../../lib/mod-proxy";
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

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

async function readBody(request: Request, limit: number): Promise<Record<string, unknown> | "too-large" | "invalid"> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) return "too-large";

  const text = await request.text().catch(() => "");
  if (utf8Length(text) > limit) return "too-large";
  if (text.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "invalid";
    return parsed as Record<string, unknown>;
  } catch {
    return "invalid";
  }
}

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
    return fail(403, "This request did not come from the dashboard. Reload the page and try again.");
  }

  const needed = GUILD_ID.test(id) ? ticketProxyClass(method, path) : null;
  if (!needed) return fail(404, "There is nothing at this address.");

  const session = await ticketSession();
  if (!session.ok) return fail(session.status, session.message);
  if (needed === "manager" && !(await isTicketManager(session.userId, id))) {
    return fail(403, "Only a member with Manage Server can do that.");
  }

  let body: unknown;
  if (method !== "GET") {
    const sent = await readBody(request, ticketProxyBodyLimit(method, path));
    if (sent === "too-large") return fail(413, "That is too long to send. Shorten it and try again.");
    if (sent === "invalid") return fail(400, "The request could not be read. Reload the page and try again.");
    // Whatever the browser claimed about who is acting is replaced.
    body = { ...sent, actor: session.actor };
  }

  const target = ticketTarget(path, new URL(request.url).searchParams, session.discordUserId, method);
  const download = transcriptDownload(method, path);

  try {
    const reply = await ticketsRequest(id, target, { method, body, timeoutMs: ticketProxyTimeoutMs(method, path) });
    if (download && reply.file) {
      const filename = downloadFileName(reply.file.disposition, download.filename);
      return new Response(reply.file.text, { status: 200, headers: transcriptHeaders(download.format, filename) });
    }
    // A file on any other path, or JSON where a transcript was expected, is not passed on as a page.
    if (reply.file) return fail(502, "The bot sent an answer the dashboard did not expect. Reload the page and try again.");
    return NextResponse.json(reply.body, { status: reply.status, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ControlApiError) {
      if (error.status === 504) return fail(504, "The bot took too long to answer. Try again in a moment.");
      if (error.status === 503) return fail(503, "The bot is offline or unreachable. Check that it is running, then try again.");
      return fail(error.status, error.message);
    }
    return fail(502, "The bot could not be reached. Check that it is running, then try again.");
  }
}

export const GET = (request: Request, context: Params) => handle("GET", request, context);
export const POST = (request: Request, context: Params) => handle("POST", request, context);
export const DELETE = (request: Request, context: Params) => handle("DELETE", request, context);
