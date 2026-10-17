import { applyVariables } from "@tier0/core";

/**
 * Why a source could not be read or posted, as the short lowercase phrase shown
 * beside it ("problem: the site answered with status 500"). The code is what the
 * network and parsing layers throw; the wording is looked up from the server's
 * settings where the failure is recorded, so those layers never need them.
 */
export const DEFAULT_FAILURES = {
  tooManyRedirects: "too many redirects",
  invalidAddress: "that is not a valid address",
  unsupportedScheme: "only http and https addresses are supported",
  notPublic: "that address is not on the public internet",
  tooLarge: "the response was larger than the limit",
  timeout: "the server took too long to answer",
  rateLimited: "the site is limiting how often it can be checked (status 429). Try a longer check interval",
  siteStatus: "the site answered with status {status}",
  steamStatus: "Steam answered with status {status}",
  steamNotJson: "Steam answered with something that was not JSON",
  steamUnexpected: "Steam answered with something unexpected",
  notReadable: "the address did not return a readable feed",
  notAFeed: "the address did not return an RSS or Atom feed",
  channelGone: "the channel it posts in no longer exists, or is not a text channel",
  postFailed: "the post could not be sent. Check that the bot can send messages and embed links in that channel",
  notFound: "that address could not be found. Check it is spelled right",
  refused: "the site refused the connection. It may be down, so it will be tried again at the next check",
  connectionLost: "the connection to the site was cut off. It will be tried again at the next check",
  badCertificate: "the site's security certificate is not valid, so it was not read",
  unknown: "something went wrong",
} as const;

export type FailureCode = keyof typeof DEFAULT_FAILURES;
export type FailureTexts = Record<FailureCode, string>;

const fill = (template: string, values: Record<string, string | number>): string =>
  applyVariables(template, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])));

export class FeedFailure extends Error {
  constructor(
    readonly code: FailureCode,
    readonly values: Record<string, string | number> = {},
  ) {
    // The default wording doubles as the message, for logs and for code that never sees settings.
    super(fill(DEFAULT_FAILURES[code], values));
  }
}

/** The network errors an owner can act on, by the code Node gives them. */
const SYSTEM_CODES: Record<string, FailureCode> = {
  ENOTFOUND: "notFound",
  EAI_AGAIN: "notFound",
  EAI_NONAME: "notFound",
  ECONNREFUSED: "refused",
  EHOSTUNREACH: "refused",
  ENETUNREACH: "refused",
  ECONNRESET: "connectionLost",
  EPIPE: "connectionLost",
  ECONNABORTED: "connectionLost",
  ETIMEDOUT: "timeout",
  UND_ERR_SOCKET: "connectionLost",
  EPROTO: "badCertificate",
};

const CERTIFICATE = /^(?:CERT_|ERR_TLS_|ERR_SSL_|UNABLE_TO_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT|HOSTNAME_MISMATCH)/;

/** Which failure a system error is, or null for one with no wording of its own. */
export function systemFailure(error: unknown): FailureCode | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== "string") return null;
  return SYSTEM_CODES[code] ?? (CERTIFICATE.test(code) ? "badCertificate" : null);
}

/**
 * What to record against a source after a failure, in the server's wording.
 * A network error is named for what the owner can do about it; anything else
 * is logged as it came and recorded as "something went wrong".
 */
export function describeFailure(error: unknown, texts: FailureTexts = DEFAULT_FAILURES): string {
  if (error instanceof FeedFailure) return fill(texts[error.code], error.values);
  const code = systemFailure(error);
  if (code) return texts[code];
  console.warn("[feeds] unexpected failure:", error);
  return texts.unknown;
}

/** A recorded failure as the start of a sentence, for a status line on its own. */
export const sentence = (text: string): string => (text === "" ? text : text.charAt(0).toUpperCase() + text.slice(1));
