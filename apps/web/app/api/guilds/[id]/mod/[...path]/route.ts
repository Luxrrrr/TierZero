import { NextResponse } from "next/server";
import { readJsonObjectLimited } from "../../../../../../lib/body-limit";
import { modRequest } from "../../../../../../lib/control-api";
import { botErrorResponse, failure } from "../../../../../../lib/api-helpers";
import type { MemberProfile } from "@tier0/shared-moderation";
import { requireStaff } from "../../../../../../lib/mod-access";
import { redactProfile } from "../../../../../../lib/profile-redact";
import {
  isMemberMessagesRead,
  isMessageLogRead,
  isProfileRead,
  isSameOriginWrite,
  modProxyPermission,
  MOD_PROXY_MAX_BODY_BYTES,
} from "../../../../../../lib/mod-proxy";

/**
 * The browser's only way to the mod dashboard's data. It checks who is asking
 * and then forwards to the bot, adding the actor from the session. The bot
 * checks the role again for each write, so this is a first gate and not the
 * only one; for reads it is the only one.
 */

type Params = { params: Promise<{ id: string; path: string[] }> };

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

  const permission = modProxyPermission(method, path);
  if (!permission) return failure(404, "There is nothing at this address.");

  const access = await requireStaff(id, permission);
  if (!access.ok) return failure(access.status, access.message);

  const url = new URL(request.url);
  // The bot is told who is asking, because it limits the list to channels that person can read. The browser
  // cannot name itself: whatever query it sent is dropped for this read.
  const viewer = `viewer=${encodeURIComponent(access.actor.userId)}&owner=${access.role === "owner" ? "1" : "0"}`;
  let target = `${path.map(encodeURIComponent).join("/")}${url.search}`;
  if (isMemberMessagesRead(method, path)) {
    // The log takes the viewer's filters too. Anything the browser sent under these names is dropped.
    const filters = new URLSearchParams(isMessageLogRead(method, path) ? url.search : "");
    for (const key of ["viewer", "owner", "role"]) filters.delete(key);
    const extra = filters.toString();
    target = `${path.map(encodeURIComponent).join("/")}?${viewer}&role=${access.role}${extra ? `&${extra}` : ""}`;
  }

  let body: unknown;
  if (method !== "GET") {
    const read = await readJsonObjectLimited(request, MOD_PROXY_MAX_BODY_BYTES);
    if (!read.ok) {
      return read.reason === "too-large"
        ? failure(413, "That is too long to save. Shorten it and try again.")
        : failure(400, "The request could not be read. Reload the page and try again.");
    }
    const sent = read.value;
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
    return botErrorResponse(error);
  }
}

export const GET = (request: Request, context: Params) => handle("GET", request, context);
export const POST = (request: Request, context: Params) => handle("POST", request, context);
export const PATCH = (request: Request, context: Params) => handle("PATCH", request, context);
export const PUT = (request: Request, context: Params) => handle("PUT", request, context);
export const DELETE = (request: Request, context: Params) => handle("DELETE", request, context);
