import { NextResponse } from "next/server";
import { ControlApiError } from "./control-api";
import { ownerMessage } from "./bot-errors";
import type { AuthzFail } from "./authz";
import { isSameOriginRequest } from "./mod-proxy";
import { readJsonLimited } from "./body-limit";

/** The answer to a write that did not come from a dashboard page, or null when it did. */
export function crossOriginWriteResponse(request: Request): NextResponse | null {
  if (isSameOriginRequest(request)) return null;
  return NextResponse.json({ error: "This request did not come from the dashboard. Reload the page and try again." }, { status: 403 });
}

/** Turns a failed authz check into the response a route handler should return. */
export function authzFailureResponse(failure: AuthzFail): NextResponse {
  return NextResponse.json({ error: failure.message }, { status: failure.status });
}

/**
 * Runs a control-API call and maps failures to a response with a status and
 * message a dashboard user can act on, rather than a stack trace or a bare 500
 * when the bot process is down.
 */
export async function proxyControlApi<T>(work: () => Promise<T>): Promise<NextResponse> {
  try {
    return NextResponse.json(await work());
  } catch (error) {
    if (error instanceof ControlApiError) {
      const body = error.fieldErrors?.length
        ? { errors: error.fieldErrors }
        : { error: error.message };
      return NextResponse.json(body, { status: error.status });
    }
    // A missing setting in .env or a bug here: the detail is for the
    // operator's log, not for whoever pressed the button.
    console.error("[dashboard] control API call failed:", error);
    return NextResponse.json({ error: ownerMessage(502, undefined) }, { status: 502 });
  }
}

/**
 * Reads a request body as JSON, or answers 400 when it is not. A malformed
 * body is the caller's mistake and must not surface as an unhandled 500.
 */
export async function readRequestJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  const read = await readJsonLimited(request);
  if (read.ok) return read;
  return read.reason === "too-large"
    ? { ok: false, response: failure(413, "That is too large to save. Shorten it and try again.") }
    : { ok: false, response: failure(400, "The change could not be read. Reload the page and try again.") };
}

/** A JSON error answer, in the shape every route uses. */
export function failure(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

/** What a browser is told when the bot did not answer properly. Shared by the proxies that pass a bot answer straight through. */
export function botErrorResponse(error: unknown): NextResponse {
  if (error instanceof ControlApiError) {
    if (error.status === 504) return failure(504, "The bot took too long to answer. Try again in a moment.");
    if (error.status === 503) return failure(503, "The bot is offline or unreachable. Check that it is running, then try again.");
    return failure(error.status, error.message);
  }
  return failure(502, "The bot could not be reached. Check that it is running, then try again.");
}
