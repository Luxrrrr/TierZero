/**
 * Getting a signed-out visitor back to the page they asked for. A link from
 * Discord to a ticket or a case is the usual way in, and landing on the server
 * list after signing in loses it. Free of Next imports so the tests can reach it.
 */

/** The request header the proxy sets, naming the page that was asked for. */
export const PATH_HEADER = "x-tier0-path";

/**
 * A place to send someone after sign-in: a path on this dashboard and nothing
 * else. A full address, `//host` or `/\host` would let a link send a person who
 * just signed in to another site.
 */
export function safeNext(value: string | string[] | null | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || raw === "") return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if ([...raw].some((char) => char.charCodeAt(0) < 0x20)) return null;
  // Back to the sign-in or first-run screens would only go round in a circle.
  if (/^\/(login|setup|api)(\/|\?|$)/.test(raw)) return null;
  return raw;
}

export function loginHref(next: string | null): string {
  const safe = safeNext(next);
  return safe && safe !== "/guilds" ? `/login?next=${encodeURIComponent(safe)}` : "/login";
}

/** Pages that need a session, which the proxy sends straight to sign-in when there is no session cookie at all. */
export function needsSession(pathname: string): boolean {
  return /^\/(guilds|help|updates)(\/|$)/.test(pathname);
}

/** Auth.js names its cookie differently over https. */
export const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];
