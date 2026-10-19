import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import { FeedFailure } from "./failures.js";

const MAX_REDIRECTS = 3;

/**
 * Any member who can open the dashboard for a server can add a feed URL, and
 * the bot runs next to services that trust their callers (its own control API
 * among them). A feed is only ever fetched from the public internet.
 */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicV4(address);
  if (version === 6) return isPublicV6(address);
  return false;
}

function isPublicV4(address: string): boolean {
  const parts = address.split(".").map(Number);
  const [a, b] = parts;
  if (a === undefined || b === undefined) return false;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, including cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false; // protocol assignments, documentation
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a >= 224) return false; // multicast and reserved
  return true;
}

/**
 * The eight 16-bit groups of an IPv6 address that isIP already accepted. The
 * URL parser rewrites ::ffff:127.0.0.1 as ::ffff:7f00:1, so an address cannot
 * be judged from its text; it has to be read as numbers.
 */
function groupsOfV6(address: string): number[] | null {
  let text = address.toLowerCase().split("%")[0] ?? "";
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)?.[1];
  if (tail) {
    const [a = 0, b = 0, c = 0, d = 0] = tail.split(".").map(Number);
    text = `${text.slice(0, -tail.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...rest].map((group) => parseInt(group, 16));
  return groups.length === 8 && groups.every((group) => Number.isInteger(group)) ? groups : null;
}

function v4Of(high: number, low: number): string {
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function isPublicV6(address: string): boolean {
  const g = groupsOfV6(address);
  if (!g) return false;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;

  // Forms that carry an IPv4 address are only as public as that address is.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) return isPublicV4(v4Of(g6, g7)); // ::ffff:0:0/96
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0xffff && g5 === 0) return isPublicV4(v4Of(g6, g7)); // ::ffff:0:0:0/96
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return isPublicV4(v4Of(g6, g7)); // NAT64
  if (g0 === 0x2002) return isPublicV4(v4Of(g1, g2)); // 6to4

  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return false; // ::, ::1 and the IPv4-compatible range
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) return false; // NAT64 local use
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return false; // discard-only
  if (g0 === 0x2001 && g1 === 0) return false; // Teredo
  if (g0 === 0x2001 && g1 === 0xdb8) return false; // documentation
  if ((g0 & 0xfe00) === 0xfc00) return false; // unique local
  if ((g0 & 0xffc0) === 0xfe80) return false; // link-local
  if ((g0 & 0xffc0) === 0xfec0) return false; // deprecated site-local
  if ((g0 & 0xff00) === 0xff00) return false; // multicast
  return true;
}

/**
 * Resolves through the same path the connection uses, so the address that was
 * checked is the address that gets connected to. Checking first and fetching
 * second would leave a window for a hostname to change its answer in between.
 */
const guardedLookup: typeof dnsLookup = ((hostname: string, options: unknown, callback: unknown) => {
  const done = (typeof options === "function" ? options : callback) as (
    error: Error | null,
    address?: unknown,
    family?: number,
  ) => void;
  const wantsAll = typeof options === "object" && options !== null && (options as { all?: boolean }).all;

  dnsLookup(hostname, { all: true }, (error, addresses) => {
    if (error) return done(error);
    const allowed = addresses.filter((entry) => isPublicAddress(entry.address));
    if (allowed.length === 0) {
      return done(new FeedFailure("notPublic"));
    }
    if (wantsAll) return done(null, allowed);
    const [first] = allowed;
    return done(null, first?.address, first?.family);
  });
}) as typeof dnsLookup;

export interface FetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  /** The most time the whole fetch, redirects included, may take. A host that keeps sending a byte now and then never trips timeoutMs. */
  deadlineMs?: number;
  accept?: string;
}

export interface FetchResult {
  status: number;
  body: string;
  url: string;
}

export async function safeFetch(rawUrl: string, options: FetchOptions = {}): Promise<FetchResult> {
  const { maxBytes = 2_000_000, timeoutMs = 10_000, deadlineMs = 30_000, accept = "*/*" } = options;
  const until = Date.now() + deadlineMs;
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const remaining = until - Date.now();
    if (remaining <= 0) throw new FeedFailure("timeout");
    const result = await once(current, { maxBytes, timeoutMs, deadlineMs: remaining, accept });
    if (result.redirect === undefined) {
      return { status: result.status, body: result.body, url: current };
    }
    current = new URL(result.redirect, current).toString();
  }
  throw new FeedFailure("tooManyRedirects");
}

interface Hop {
  status: number;
  body: string;
  redirect?: string;
}

function once(rawUrl: string, options: Required<FetchOptions>): Promise<Hop> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      reject(new FeedFailure("invalidAddress"));
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      reject(new FeedFailure("unsupportedScheme"));
      return;
    }

    // The guarded lookup only runs for hostnames. An address written out in the
    // URL is connected to directly, so it has to be checked here.
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(literal) !== 0 && !isPublicAddress(literal)) {
      reject(new FeedFailure("notPublic"));
      return;
    }

    const client = url.protocol === "https:" ? https : http;
    const request = client.get(
      url,
      {
        lookup: guardedLookup,
        timeout: options.timeoutMs,
        headers: {
          accept: options.accept,
          "user-agent": "TierZero feed reader",
          "accept-encoding": "identity",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location) {
          response.resume();
          resolve({ status, body: "", redirect: location });
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            request.destroy(new FeedFailure("tooLarge"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new FeedFailure("timeout")));
    request.on("error", reject);
    const deadline = setTimeout(() => request.destroy(new FeedFailure("timeout")), options.deadlineMs);
    request.on("close", () => clearTimeout(deadline));
  });
}
