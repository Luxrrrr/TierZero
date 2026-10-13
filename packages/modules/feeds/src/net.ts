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

function isPublicV6(address: string): boolean {
  const lower = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped?.[1]) return isPublicV4(mapped[1]);
  if (lower === "::" || lower === "::1") return false;
  const first = parseInt(lower.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return false; // unique local
  if ((first & 0xffc0) === 0xfe80) return false; // link-local
  if ((first & 0xff00) === 0xff00) return false; // multicast
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
  accept?: string;
}

export interface FetchResult {
  status: number;
  body: string;
  url: string;
}

export async function safeFetch(rawUrl: string, options: FetchOptions = {}): Promise<FetchResult> {
  const { maxBytes = 2_000_000, timeoutMs = 10_000, accept = "*/*" } = options;
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const result = await once(current, { maxBytes, timeoutMs, accept });
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
  });
}
