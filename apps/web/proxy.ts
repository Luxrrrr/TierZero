import { NextResponse, type NextRequest } from "next/server";
import { PATH_HEADER, SESSION_COOKIES, loginHref, needsSession } from "./lib/login-redirect";
import { isExposedPlainHttp } from "./lib/transport";

/**
 * Nothing that signs in is served over plain HTTP at an address the internet can
 * reach. The public leaderboard has no sign-in, and ALLOW_INSECURE_HTTP is for
 * a setup the check cannot tell is safe.
 */
function blocksInsecure(request: NextRequest): boolean {
  if (process.env.ALLOW_INSECURE_HTTP === "true") return false;
  if (request.nextUrl.pathname.startsWith("/leaderboard/")) return false;
  return isExposedPlainHttp({
    host: request.headers.get("host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    protocol: request.nextUrl.protocol,
  });
}

/**
 * Remembers which page was asked for. Without a session cookie at all, a page
 * that needs one sends the visitor to sign in with that page attached, so a
 * link from Discord still lands where it pointed. Pages that find a session
 * that has run out read the same header to do the same.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const path = `${pathname}${search}`;

  if (blocksInsecure(request)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Sign-in is turned off on an unencrypted connection to a public address." }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/insecure", request.url));
  }

  if (needsSession(pathname) && !SESSION_COOKIES.some((name) => request.cookies.has(name))) {
    return NextResponse.redirect(new URL(loginHref(path), request.url));
  }

  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, path);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Static files and the notice itself never need it.
  matcher: ["/((?!_next/|insecure|favicon|icon|apple-icon).*)"],
};
