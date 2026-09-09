/**
 * Pure rule evaluation. Nothing here touches discord.js, the database, or the
 * network, because this runs once for every message in every guild the bot
 * is in and has to stay cheap. A handler wires this up to actual Discord
 * calls; this file only ever answers "what, if anything, should happen".
 */
import type { AutomodSettings } from "./settings.js";

export type RuleAction = "delete" | "warn" | "timeout";

export type RuleName =
  | "invites"
  | "links"
  | "capitals"
  | "repeatedText"
  | "mentions"
  | "bannedWords"
  | "rateLimit";

export interface RecentMessage {
  content: string;
  timestamp: number;
}

export interface EvaluationInput {
  content: string;
  authorRoles: string[];
  authorIsBot: boolean;
  authorIsModerator: boolean;
  channelId: string;
  /** Current time, in the same clock as `history` timestamps. */
  now: number;
  /**
   * This member's earlier messages in this guild, not including the one
   * being evaluated, oldest first. The caller decides how much history to
   * keep; this file just reads whatever it is given.
   */
  history: RecentMessage[];
  settings: AutomodSettings;
}

export interface EvaluationVerdict {
  triggered: boolean;
  rule?: RuleName;
  action?: RuleAction;
  reason?: string;
  /** Present only when `action` is "timeout". */
  timeoutMs?: number;
  /** Every rule that tripped, even though only the most severe is acted on. */
  matchedRules: RuleName[];
}

interface RuleMatch {
  rule: RuleName;
  action: RuleAction;
  reason: string;
  timeoutMs?: number;
}

interface Exemptions {
  exemptRoles: string[];
  exemptChannels: string[];
}

function isExempt(input: EvaluationInput, rule: Exemptions): boolean {
  if (input.authorIsModerator && input.settings.exemptModerators) return true;
  if (input.settings.exemptChannels.includes(input.channelId)) return true;
  if (input.settings.exemptRoles.some((role) => input.authorRoles.includes(role))) return true;
  if (rule.exemptChannels.includes(input.channelId)) return true;
  if (rule.exemptRoles.some((role) => input.authorRoles.includes(role))) return true;
  return false;
}

function toMatch(
  rule: RuleName,
  ruleSettings: { action: string; timeoutDuration: number },
  reason: string,
): RuleMatch {
  const action = ruleSettings.action as RuleAction;
  return {
    rule,
    action,
    reason,
    timeoutMs: action === "timeout" ? ruleSettings.timeoutDuration : undefined,
  };
}

// -- invites -----------------------------------------------------------

const INVITE_PATTERN = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/([a-z0-9-]+)/gi;

function extractInviteCodes(content: string): string[] {
  const codes: string[] = [];
  for (const match of content.matchAll(INVITE_PATTERN)) {
    const code = match[1];
    if (code) codes.push(code.toLowerCase());
  }
  return codes;
}

// An operator pastes a link, a bare code, or their own invite with a trailing
// slash; all three should match the same allowlist entry.
function normalizeInviteEntry(entry: string): string {
  const trimmed = entry.trim().toLowerCase().replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

function checkInvites(input: EvaluationInput): RuleMatch | null {
  const rule = input.settings.invites;
  if (!rule.enabled || isExempt(input, rule)) return null;

  const codes = extractInviteCodes(input.content);
  if (codes.length === 0) return null;

  const allowlist = new Set(rule.allowlist.map(normalizeInviteEntry));
  const disallowed = codes.find((code) => !allowlist.has(code));
  if (!disallowed) return null;

  return toMatch("invites", rule, `Posted a Discord invite link (${disallowed})`);
}

// -- links ---------------------------------------------------------------

const URL_PATTERN = /https?:\/\/([^\s/?#]+)/gi;

function extractHosts(content: string): string[] {
  const hosts: string[] = [];
  for (const match of content.matchAll(URL_PATTERN)) {
    const host = match[1];
    if (host) hosts.push(host.toLowerCase());
  }
  return hosts;
}

function normalizeDomainEntry(entry: string): string {
  return entry.trim().toLowerCase().replace(/^www\./, "");
}

function domainAllowed(host: string, allowlist: string[]): boolean {
  const bare = host.replace(/^www\./, "").replace(/:\d+$/, "");
  return allowlist.some((allowed) => bare === allowed || bare.endsWith(`.${allowed}`));
}

function checkLinks(input: EvaluationInput): RuleMatch | null {
  const rule = input.settings.links;
  if (!rule.enabled || isExempt(input, rule)) return null;

  const hosts = extractHosts(input.content);
  if (hosts.length === 0) return null;

  const allowlist = rule.allowlist.map(normalizeDomainEntry);
  const disallowed = hosts.find((host) => !domainAllowed(host, allowlist));
  if (!disallowed) return null;

  return toMatch("links", rule, `Posted a link to ${disallowed}`);
}

// -- capitals --------------------------------------------------------------

function checkCapitals(input: EvaluationInput): RuleMatch | null {
  const rule = input.settings.capitals;
  if (!rule.enabled || isExempt(input, rule)) return null;

  // Digits, punctuation and spaces do not count either way, so "OK!!!" gets
  // judged on its two letters, not its five characters.
  const letters = input.content.replace(/[^a-zA-Z]/g, "");
  if (letters.length < rule.minLength) return null;

  const upper = letters.replace(/[^A-Z]/g, "").length;
  const percent = (upper / letters.length) * 100;
  if (percent < rule.thresholdPercent) return null;

  return toMatch("capitals", rule, `Message was ${Math.round(percent)}% capital letters`);
}

// -- repeated text -----------------------------------------------------

function normalizeForRepeat(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

function checkRepeatedText(input: EvaluationInput): RuleMatch | null {
  const rule = input.settings.repeatedText;
  if (!rule.enabled || isExempt(input, rule)) return null;

  const runLength = Math.max(rule.maxCharacterRepeat - 1, 1);
  const wall = new RegExp(`(.)\\1{${runLength},}`, "u");
  if (wall.test(input.content)) {
    return toMatch(
      "repeatedText",
      rule,
      `Message repeats one character ${rule.maxCharacterRepeat} or more times in a row`,
    );
  }

  const normalized = normalizeForRepeat(input.content);
  if (normalized.length === 0) return null;

  const windowStart = input.now - rule.repeatWindow;
  const priorCopies = input.history.filter(
    (message) =>
      message.timestamp >= windowStart && normalizeForRepeat(message.content) === normalized,
  ).length;
  const totalCopies = priorCopies + 1;
  if (totalCopies < rule.repeatMessageCount) return null;

  return toMatch("repeatedText", rule, `Sent the same message ${totalCopies} times in a row`);
}

// -- mentions ----------------------------------------------------------

const USER_MENTION = /<@!?\d{17,20}>/g;
const ROLE_MENTION = /<@&\d{17,20}>/g;

function countMentions(content: string): number {
  const users = content.match(USER_MENTION)?.length ?? 0;
  const roles = content.match(ROLE_MENTION)?.length ?? 0;
  return users + roles;
}

function checkMentions(input: EvaluationInput): RuleMatch | null {
  const rule = input.settings.mentions;
  if (!rule.enabled || isExempt(input, rule)) return null;

  const count = countMentions(input.content);
  if (count <= rule.limit) return null;

  return toMatch(
    "mentions",
    rule,
    `Mentioned ${count} users or roles, more than the limit of ${rule.limit}`,
  );
}

// -- banned words ------------------------------------------------------

// Obfuscation handling is kept shallow by design: fold common leetspeak
// substitutions and collapse a letter stretched three or more times
// ("fuuuuck" -> "fuck"), then match with \b on both sides. \b is what keeps
// "assassin" out of a filter for "ass" - it only fires at a transition
// between a word character and a non-word one, and "ass" sits in the middle
// of a run of letters there, not at an edge. This does not try to catch
// spaced-out or punctuated evasion ("a s s", "a-s-s") either: closing that gap
// means either stripping whitespace (which glues unrelated words together and
// reintroduces the "assassin" problem from the other direction) or maintaining
// a much heavier tokenizer, and a false positive that deletes a real message
// is worse than a determined user getting one slur past the filter.
const LEET_MAP: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  $: "s",
  "@": "a",
  "!": "i",
  "|": "i",
};

export function normalizeForBannedWords(content: string): string {
  const substituted = [...content.toLowerCase()].map((ch) => LEET_MAP[ch] ?? ch).join("");
  return substituted.replace(/([a-z])\1{2,}/g, "$1");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checkBannedWords(input: EvaluationInput): RuleMatch | null {
  const rule = input.settings.bannedWords;
  if (!rule.enabled || isExempt(input, rule) || rule.words.length === 0) return null;

  const normalized = normalizeForBannedWords(input.content);
  const hit = rule.words.find((word) => {
    const target = normalizeForBannedWords(word).trim();
    if (!target) return false;
    return new RegExp(`\\b${escapeRegExp(target)}\\b`, "u").test(normalized);
  });
  if (!hit) return null;

  return toMatch("bannedWords", rule, "Used a banned word or phrase");
}

// -- rate limit ----------------------------------------------------------

function checkRateLimit(input: EvaluationInput): RuleMatch | null {
  const rule = input.settings.rateLimit;
  if (!rule.enabled || isExempt(input, rule)) return null;

  const windowStart = input.now - rule.window;
  const count = input.history.filter((message) => message.timestamp >= windowStart).length + 1;
  if (count <= rule.limit) return null;

  const seconds = Math.round(rule.window / 1000);
  return toMatch(
    "rateLimit",
    rule,
    `Sent ${count} messages in ${seconds}s, more than the limit of ${rule.limit}`,
  );
}

// -- evaluation ------------------------------------------------------------

const CHECKS: Array<(input: EvaluationInput) => RuleMatch | null> = [
  checkInvites,
  checkLinks,
  checkCapitals,
  checkRepeatedText,
  checkMentions,
  checkBannedWords,
  checkRateLimit,
];

const SEVERITY: Record<RuleAction, number> = { warn: 1, delete: 2, timeout: 3 };

/**
 * Runs every rule against one message and returns the single action to take.
 * A message that trips several rules is acted on once, at the severity of
 * the worst rule it tripped. It never fires once per rule.
 */
export function evaluateMessage(input: EvaluationInput): EvaluationVerdict {
  if (input.authorIsBot) return { triggered: false, matchedRules: [] };

  const matches: RuleMatch[] = [];
  for (const check of CHECKS) {
    const match = check(input);
    if (match) matches.push(match);
  }

  if (matches.length === 0) return { triggered: false, matchedRules: [] };

  matches.sort((a, b) => SEVERITY[b.action] - SEVERITY[a.action]);
  const top = matches[0];
  if (!top) return { triggered: false, matchedRules: [] };

  return {
    triggered: true,
    rule: top.rule,
    action: top.action,
    reason: top.reason,
    timeoutMs: top.timeoutMs,
    matchedRules: matches.map((match) => match.rule),
  };
}
