/**
 * Whether a request reached the dashboard in a way that exposes a sign-in.
 * Plain HTTP is fine on the machine itself, on a home network and on Tailscale,
 * which is how most installs are used. Plain HTTP to an address anyone on the
 * internet can reach sends the session cookie in the clear. The browser reports
 * the address it used honestly, and that is the only party this protects, so
 * the Host header is enough. Free of Next imports so the tests can reach it.
 */

const PRIVATE_SUFFIXES = [".local", ".lan", ".home", ".home.arpa", ".internal", ".localdomain", ".ts.net"];

/** The name or address in a Host header, without the port or the IPv6 brackets. */
export function hostnameOf(host: string): string {
  const trimmed = host.trim().toLowerCase();
  const bracketed = /^\[([^\]]*)\]/.exec(trimmed);
  const name = bracketed ? (bracketed[1] ?? "") : trimmed.replace(/:\d*$/, "");
  return name.replace(/\.$/, "");
}

function isPrivateV4(a: number, b: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // Tailscale and other carrier-grade NAT
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return a === 192 && b === 168;
}

function isPrivateV6(address: string): boolean {
  if (address === "::" || address === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(address)) return true; // unique local
  if (/^fe[89ab][0-9a-f]:/.test(address)) return true; // link-local
  const mapped = /^::ffff:(?:(\d+)\.(\d+)\.\d+\.\d+|([0-9a-f]{1,4}):[0-9a-f]{1,4})$/.exec(address);
  if (!mapped) return false;
  if (mapped[1] !== undefined) return isPrivateV4(Number(mapped[1]), Number(mapped[2]));
  const high = parseInt(mapped[3] ?? "0", 16);
  return isPrivateV4(high >> 8, high & 255);
}

/** A name or address that only exists on this machine, this network or Tailscale. */
export function isPrivateHost(hostname: string): boolean {
  if (hostname === "") return false;
  if (hostname.includes(":")) return isPrivateV6(hostname);
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (v4) return isPrivateV4(Number(v4[1]), Number(v4[2]));
  if (!hostname.includes(".")) return true; // localhost, a machine's own name
  return PRIVATE_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

/**
 * True when the dashboard was opened over plain HTTP at an address the wider
 * internet can reach. A proxy or tunnel that terminates HTTPS says so in
 * X-Forwarded-Proto, which Cloudflare Tunnel sends on its own.
 */
export function isExposedPlainHttp(request: { host: string | null; forwardedProto: string | null; protocol: string }): boolean {
  const proto = (request.forwardedProto?.split(",")[0]?.trim() || request.protocol).replace(/:$/, "").toLowerCase();
  if (proto === "https") return false;
  return !isPrivateHost(hostnameOf(request.host ?? ""));
}
