/**
 * What the dashboard says when the bot refuses something or cannot be reached.
 *
 * The bot answers a refusal with `{ error }` or `{ errors: [{ path, message }] }`,
 * and its own wording is often an internal one ("guild not found"). A server
 * owner should only ever read a sentence that says what went wrong and what to
 * do, so everything a dashboard page shows from a failed request goes through
 * here. Used on the server (the control API client) and in the browser (the
 * pages reading the dashboard's own routes), so it imports nothing.
 */

export interface FieldProblem {
  path: string;
  message: string;
}

export interface BotFailure {
  status: number;
  /** One sentence for an owner. */
  message: string;
  /** Problems the bot tied to particular settings, for the form to show under each. */
  fieldErrors?: FieldProblem[];
}

const BY_STATUS: Record<number, string> = {
  400: "The bot could not use that change. Reload the page and try again.",
  401: "Your sign-in has run out. Reload the page and sign in again.",
  403: "You do not have access to change that on this server.",
  404: "The bot could not find that. Reload the page to see what is there now.",
  409: "That changed somewhere else in the meantime. Reload the page, then try again.",
  413: "That is too large for the bot to accept. Make it shorter and try again.",
  422: "Some of these settings are not valid. Check the highlighted fields.",
  429: "The bot is busy. Wait a minute, then try again.",
  500: "The bot ran into a problem with that. Try again, and check the bot's log if it keeps happening.",
  502: "The dashboard could not reach the bot. Check the bot is running, then try again.",
  503: "The dashboard could not reach the bot. Check the bot is running, then try again.",
  504: "The bot took too long to answer. Try again in a moment.",
};

const FALLBACK = "The bot did not accept that. Try again in a moment.";

/** Known internal answers from the bot, by what they start with, in owner wording. */
const KNOWN: { match: RegExp; message: string }[] = [
  { match: /^guild not found/i, message: "The bot is not in this server any more. Invite it again from Your servers." },
  { match: /^unknown module/i, message: "This feature is not part of this install any more. Reload the page." },
  { match: /^enabled must be/i, message: "The bot could not use that change. Reload the page and try again." },
  { match: /^invalid json|^unexpected token|is not valid json/i, message: "The bot could not read that change. Reload the page and try again." },
];

/** Node and network error codes that leak through a message, in plain words. */
const SYSTEM: { match: RegExp; message: (found: RegExpMatchArray) => string }[] = [
  {
    match: /getaddrinfo (?:ENOTFOUND|EAI_AGAIN) (\S+?)\.?(?=\s|$)/i,
    message: (found) => `the address ${found[1] ?? ""} could not be found. Check it is spelled right`,
  },
  { match: /\bENOTFOUND\b/, message: () => "that address could not be found. Check it is spelled right" },
  { match: /\bECONNREFUSED\b/, message: () => "the other end refused the connection. Check the address and try again later" },
  { match: /\bECONNRESET\b|socket hang up/i, message: () => "the connection was cut off. Try again later" },
  { match: /\bETIMEDOUT\b|\bUND_ERR_CONNECT_TIMEOUT\b/, message: () => "the other end did not answer in time. Try again later" },
  {
    match: /\bCERT_|certificate|\bSSL\b|\bTLS\b|self[- ]signed/i,
    message: () => "the site's security certificate could not be checked. Check the address starts with https:// and is correct",
  },
  { match: /fetch failed/i, message: () => "the connection failed. Try again later" },
];

/**
 * Rewrites the system error codes inside a message meant for an owner, keeping
 * whatever the module said around them: "Nothing was sent: getaddrinfo
 * ENOTFOUND example.com" keeps "Nothing was sent:".
 */
export function plainSystemText(text: string): string {
  for (const rule of SYSTEM) {
    const found = text.match(rule.match);
    if (!found || found.index === undefined) continue;
    let before = text.slice(0, found.index).trimEnd();
    // Node's own prefix, as in "connect ECONNREFUSED", is part of the code.
    if (/^[a-z]+$/.test(before)) before = "";
    const replacement = rule.message(found);
    if (before === "") return `${capitalize(replacement)}.`;
    const joined = /[:.]$/.test(before) ? `${before} ${replacement}` : `${before}: ${replacement}`;
    return `${joined}.`;
  }
  return text;
}

/**
 * Whether the bot's own text already reads as a sentence for a person, as a
 * module's refusal does ("Leveling is off on this server."), rather than as an
 * internal code ("guild not found").
 */
export function readsAsSentence(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 8 || trimmed.length > 400) return false;
  if (!/^[A-Z]/.test(trimmed)) return false;
  if (/[{}[\]<>]|\bat \S+:\d+|Error:|\bE[A-Z]{3,}\b/.test(trimmed)) return false;
  return /[.!?]$/.test(trimmed) || trimmed.includes(" ");
}

/** The bot's `{ error }` text, or a sentence picked from the status when it says nothing usable. */
export function ownerMessage(status: number, said: string | undefined): string {
  const text = said?.trim() ?? "";
  if (text !== "") {
    const known = KNOWN.find((rule) => rule.match.test(text));
    if (known) return known.message;
    const cleaned = plainSystemText(text);
    if (cleaned !== text) return cleaned;
    if (readsAsSentence(text)) return /[.!?]$/.test(text) ? text : `${text}.`;
  }
  return BY_STATUS[status] ?? (status >= 500 ? (BY_STATUS[500] as string) : FALLBACK);
}

/**
 * Reads a failed response's body, whatever shape it came in: `{ error }`,
 * `{ errors }`, plain text, or nothing at all.
 */
export function failureFromBody(status: number, body: string): BotFailure {
  let error: string | undefined;
  let fieldErrors: FieldProblem[] | undefined;
  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown; errors?: unknown };
      if (typeof parsed.error === "string") error = parsed.error;
      else if (typeof parsed.message === "string") error = parsed.message;
      if (Array.isArray(parsed.errors)) {
        const valid = parsed.errors.filter(isFieldProblem);
        if (valid.length > 0) fieldErrors = valid;
      }
    } catch {
      error = undefined;
    }
  } else if (trimmed !== "" && !trimmed.startsWith("<")) {
    // Plain text, but never an HTML error page someone's proxy produced.
    error = trimmed;
  }
  const failure: BotFailure = { status, message: ownerMessage(status, error) };
  if (fieldErrors) failure.fieldErrors = fieldErrors;
  return failure;
}

/** For a page in the browser: what a failed fetch of the dashboard's own routes means. */
export async function readFailure(res: Response): Promise<BotFailure> {
  const body = await res.text().catch(() => "");
  return failureFromBody(res.status, body);
}

/** When fetch itself throws: the dashboard's own server could not be reached. */
export const UNREACHABLE = "The dashboard could not be reached. Check your connection, then try again.";

function isFieldProblem(value: unknown): value is FieldProblem {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FieldProblem>;
  return typeof candidate.path === "string" && typeof candidate.message === "string";
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
