/**
 * How the dashboard reads the entries automod records. Each one has an action
 * starting with `automod-` and a reason of the form `<rule>: <detail>` or just
 * `<rule>`; there is no separate column for the rule, so it is parsed here.
 * Pure, so server and client components and the tests can share it.
 */

export const AUTOMOD_PREFIX = "automod-";

export function isAutomodAction(action: string): boolean {
  return action.startsWith(AUTOMOD_PREFIX);
}

/** Keyed by the lower-cased rule name, the same folding the bot uses when it counts hits per rule. */
const RULE_LABEL: Record<string, string> = {
  invites: "Invites",
  links: "Links",
  capitals: "Capitals",
  repeatedtext: "Repeated text",
  mentions: "Mentions",
  bannedwords: "Banned words",
  ratelimit: "Message rate",
  unknown: "Unknown rule",
  other: "Other rules",
};

/** A readable name for a rule, including ones this version has never heard of. */
export function ruleLabel(rule: string): string {
  const key = rule.trim().toLowerCase();
  const known = RULE_LABEL[key];
  if (known) return known;
  const words = rule
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .toLowerCase();
  return words === "" ? RULE_LABEL.unknown! : words.charAt(0).toUpperCase() + words.slice(1);
}

export interface AutomodReason {
  /** Lower-cased rule key, or null when the reason does not start with something that looks like a rule name. */
  rule: string | null;
  /** The text after the rule, or the whole reason when no rule was found. Null when there is nothing left. */
  detail: string | null;
}

/** Longest text before a colon that is still taken to be a rule name rather than a sentence. */
const RULE_NAME_MAX = 32;

export function parseAutomodReason(reason: string | null | undefined): AutomodReason {
  const text = (reason ?? "").trim();
  if (text === "") return { rule: null, detail: null };

  const colon = text.indexOf(":");
  const head = (colon === -1 ? text : text.slice(0, colon)).trim();
  const key = head.toLowerCase();
  const looksLikeRule = head !== "" && head.length <= RULE_NAME_MAX && /^[A-Za-z][A-Za-z0-9_-]*$/.test(head);

  if (!looksLikeRule && !(key in RULE_LABEL)) return { rule: null, detail: text };
  const detail = colon === -1 ? "" : text.slice(colon + 1).trim();
  return { rule: key, detail: detail === "" ? null : detail };
}

const AUTOMOD_ACTION_LABEL: Record<string, string> = {
  "automod-warn": "Automod warn",
  "automod-timeout": "Automod timeout",
  "automod-delete": "Automod message delete",
};

/** The label for an automod action, falling back to a tidied form of an unrecognised `automod-` kind. */
export function automodActionLabel(action: string): string | null {
  if (!isAutomodAction(action)) return null;
  const known = AUTOMOD_ACTION_LABEL[action];
  if (known) return known;
  const kind = action.slice(AUTOMOD_PREFIX.length).replace(/[-_]+/g, " ").trim();
  return kind === "" ? "Automod" : `Automod ${kind}`;
}
