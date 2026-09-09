import { NextResponse } from "next/server";
import { ControlApiError } from "./control-api";
import type { AuthzFail } from "./authz";

/** Turns a failed authz check into the response a route handler should return. */
export function authzFailureResponse(failure: AuthzFail): NextResponse {
  return NextResponse.json({ error: failure.message }, { status: failure.status });
}

/**
 * Runs a control-API call and maps failures to a response with a status and
 * message a dashboard user can act on. Leaking a stack trace or a bare 500
 * bare 500 when the bot process is down.
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
    const message = error instanceof Error ? error.message : "The bot's control API is unreachable.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
