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

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

/**
 * What to record against a source after a failure. Our own failures use the
 * server's wording; anything else is a system error whose message is passed on
 * as it came, cut short.
 */
export function describeFailure(error: unknown, texts: FailureTexts = DEFAULT_FAILURES): string {
  if (error instanceof FeedFailure) return fill(texts[error.code], error.values);
  if (error instanceof Error) return truncate(error.message, 200);
  return texts.unknown;
}
