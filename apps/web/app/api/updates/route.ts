import { NextResponse } from "next/server";
import { auth } from "../../../lib/auth";
import { isInstanceOwner } from "../../../lib/instance";
import { isSameOriginWrite } from "../../../lib/mod-proxy";
import { getUpdateStatus, setUpdateChecks } from "../../../lib/updates";

/**
 * Owner-only controls for the Updates page: check now, and switch checking on or off. Reading the page itself
 * needs only a sign-in, but these change what the install does, so they are the owner's.
 */
async function guard(request: Request): Promise<NextResponse | null> {
  if (
    !isSameOriginWrite(request.method, {
      origin: request.headers.get("origin"),
      secFetchSite: request.headers.get("sec-fetch-site"),
      host: request.headers.get("host"),
      forwardedHost: request.headers.get("x-forwarded-host"),
    })
  ) {
    return NextResponse.json({ error: "This request did not come from the dashboard. Reload the page and try again." }, { status: 403 });
  }
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!(await isInstanceOwner(session.user.id))) return NextResponse.json({ error: "Only the owner of this install can do that." }, { status: 403 });
  return null;
}

/** POST -> asks GitHub again now, and returns what it found. */
export async function POST(request: Request) {
  const refused = await guard(request);
  if (refused) return refused;
  const status = await getUpdateStatus({ force: true });
  return NextResponse.json({ checkedAt: status.checkedAt, error: status.error, updateAvailable: status.updateAvailable });
}

/** PUT { enabled } -> turns update checks on or off. Off means this install makes no request to GitHub. */
export async function PUT(request: Request) {
  const refused = await guard(request);
  if (refused) return refused;
  const body: unknown = await request.json().catch(() => null);
  const enabled = typeof body === "object" && body !== null ? (body as { enabled?: unknown }).enabled : undefined;
  if (typeof enabled !== "boolean") return NextResponse.json({ error: "Say whether checking should be on or off." }, { status: 400 });
  await setUpdateChecks(enabled);
  return NextResponse.json({ enabled });
}
