import { NextResponse, type NextRequest } from "next/server";
import { PATH_HEADER, SESSION_COOKIES, loginHref, needsSession } from "./lib/login-redirect";

/**
 * Remembers which page was asked for. Without a session cookie at all, a page
 * that needs one sends the visitor to sign in with that page attached, so a
 * link from Discord still lands where it pointed. Pages that find a session
 * that has run out read the same header to do the same.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const path = `${pathname}${search}`;

  if (needsSession(pathname) && !SESSION_COOKIES.some((name) => request.cookies.has(name))) {
    return NextResponse.redirect(new URL(loginHref(path), request.url));
  }

  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, path);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Static files and the auth routes never need it.
  matcher: ["/((?!_next/|api/|favicon|icon|apple-icon).*)"],
};
