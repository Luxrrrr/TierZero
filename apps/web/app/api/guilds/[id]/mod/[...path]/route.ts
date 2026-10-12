import { NextResponse } from "next/server";
import { modRequest, ControlApiError } from "../../../../../../lib/control-api";
import type { MemberProfile } from "@tier0/core";
import { requireStaff } from "../../../../../../lib/mod-access";
import { redactProfile } from "../../../../../../lib/profile-redact";
import {
  isMemberMessagesRead,
  isProfileRead,
  isSameOriginWrite,
  modProxyPermission,
  MOD_PROXY_MAX_BODY_BYTES,
  utf8Length,
} from "../../../../../../lib/mod-proxy";

/**
 * The browser's only way to the mod dashboard's data. It checks who is asking
 * and then forwards to the bot, adding the actor from the session. The bot
 * checks the role again for each write, so this is a first gate and not the
 * only one; for reads it is the only one.
 */

type Params = { params: Promise<{ id: string; path: string[] }> };

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

async function readBody(request: Request): Promise<Record<string, unknown> | "too-large" | "invalid"> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MOD_PROXY_MAX_BODY_BYTES) return "too-large";

  const text = await request.text().catch(() => "");
  if (utf8Length(text) > MOD_PROXY_MAX_BODY_BYTES) return "too-large";
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

  const permission = modProxyPermission(method, path);
  if (!permission) return fail(404, "There is nothing at this address.");

  const access = await requireStaff(id, permission);
  if (!access.ok) return fail(access.status, access.message);

  const url = new URL(request.url);
  // The bot is told who is asking, because it limits the list to channels that person can read. The browser
  // cannot name itself: whatever query it sent is dropped for this read.
  const target = isMemberMessagesRead(method, path)
    ? `${path.map(encodeURIComponent).join("/")}?viewer=${encodeURIComponent(access.actor.userId)}&owner=${access.role === "owner" ? "1" : "0"}`
    : `${path.map(encodeURIComponent).join("/")}${url.search}`;

  let body: unknown;
  if (method !== "GET") {
    const sent = await readBody(request);
    if (sent === "too-large") return fail(413, "That is too long to save. Shorten it and try again.");
    if (sent === "invalid") return fail(400, "The request could not be read. Reload the page and try again.");
    // Whatever the browser claimed about who is acting is replaced.
    body = { ...sent, actor: access.actor };
  }

  try {
    const reply = await modRequest(id, target, { method, body });
    if (reply.file) {
      const headers = new Headers({
        "content-type": reply.file.contentType,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      if (reply.file.disposition) headers.set("content-disposition", reply.file.disposition);
      return new Response(reply.file.text, { status: reply.status, headers });
    }
    // The bot sends the whole profile; what this role may read is decided here,
    // so a moderator cannot get the audit trail or deleted note text by calling
    // the API directly instead of opening the page.
    if (isProfileRead(method, path) && reply.status === 200) {
      return NextResponse.json(redactProfile(reply.body as MemberProfile, access.role), { status: reply.status });
    }
    return NextResponse.json(reply.body, { status: reply.status });
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
export const PATCH = (request: Request, context: Params) => handle("PATCH", request, context);
export const PUT = (request: Request, context: Params) => handle("PUT", request, context);
export const DELETE = (request: Request, context: Params) => handle("DELETE", request, context);
