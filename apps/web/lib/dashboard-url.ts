/**
 * Working out which address the dashboard is being opened on, and whether it
 * should become the base for links the bot posts. Pure, so the rules can be
 * tested without a request or a database.
 */

export interface RequestAddressHeaders {
  host: string | null;
  forwardedHost: string | null;
  forwardedProto: string | null;
}

const HOST_PATTERN = /^(?:[a-z0-9]|[a-z0-9][a-z0-9.-]*[a-z0-9]|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;

function firstValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first ? first : null;
}

/**
 * The origin a request was made to, or null when the headers do not describe a
 * plain http(s) host. The forwarded values win because behind a proxy `host` is
 * the proxy's own upstream name. Anything with a path, query, credentials or
 * whitespace in the host is refused rather than cleaned up.
 */
export function originFromHeaders(headers: RequestAddressHeaders): string | null {
  const host = firstValue(headers.forwardedHost) ?? firstValue(headers.host);
  if (!host || !HOST_PATTERN.test(host)) return null;

  const proto = (firstValue(headers.forwardedProto) ?? "http").toLowerCase();
  if (proto !== "http" && proto !== "https") return null;

  try {
    const url = new URL(`${proto}://${host}`);
    return url.origin;
  } catch {
    return null;
  }
}

/** A stored value reduced to its origin, or null when it is empty or not an http(s) address. */
export function normaliseOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Addresses only the machine itself can open, which are useless in a link sent to a Discord channel. */
export function isLocalOrigin(origin: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    hostname === "0.0.0.0" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}

/**
 * Whether the address the instance owner just used should replace the stored
 * one. A local address only fills an empty slot and never displaces a public
 * one; among public addresses the one the owner last used wins, so moving the
 * dashboard to a new domain needs no setting changed. The caller must already
 * have established that the viewer is the instance owner.
 */
export function shouldStoreDashboardUrl(stored: string | null | undefined, candidate: string | null): boolean {
  const next = normaliseOrigin(candidate);
  if (!next) return false;

  const current = normaliseOrigin(stored);
  if (!current) return true;
  if (current === next) return false;
  if (isLocalOrigin(next)) return false;
  return true;
}
