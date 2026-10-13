/**
 * Pure rule evaluation. Nothing here touches discord.js, the database, or the
 * network, because this runs once for every message in every guild the bot
 * is in and has to stay cheap. A handler wires this up to actual Discord
 * calls; this file only ever answers "what, if anything, should happen".
 */
import { createHash } from "node:crypto";
import { fill } from "./fill.js";
import type { AutomodSettings, RuleAction, RuleName } from "./settings.js";

export type { RuleAction, RuleName };

/**
 * What is remembered of an earlier message. Only equality matters for the
 * repeated-text rule, so a short digest stands in for the text and a member
 * who pastes long messages does not cost the process their full length.
 */
export interface RecentMessage {
  fingerprint: string;
  timestamp: number;
}

function normalizeForRepeat(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Two messages repeat each other exactly when their fingerprints are equal. */
export function fingerprintOf(content: string): string {
  return createHash("sha1").update(normalizeForRepeat(content)).digest("base64").slice(0, 16);
}

export interface EvaluationInput {
  content: string;
  authorRoles: string[];
  authorIsBot: boolean;
  authorIsModerator: boolean;
  channelId: string;
  /**
   * The channel a thread belongs to, when the message is in one. Threads have
   * ids of their own, so without this a channel exempted in the settings would
   * stop applying the moment someone opened a thread in it.
   */
  parentChannelId?: string | null;
  /**
   * True when the message was edited rather than just sent. An edit is read for
   * what it now says but is not another message, so the rules that count
   * messages leave it out.
   */
  isEdit?: boolean;
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
  /** Everything the winning rule is set to do, in the order delete, warn, timeout. */
  actions?: RuleAction[];
  /** What was wrong, in words that are safe to show anyone. Never quotes the message. */
  reason?: string;
  /**
   * The specific thing that matched, such as an invite code or a host. For
   * staff only: it comes from the offending message, so it must not appear in
   * anything the channel can read.
   */
  detail?: string;
  /**
   * For banned words, each entry of the owner's list that matched, as the owner
   * wrote it. Staff only, like `detail`, which joins them.
   */
  matches?: string[];
  /** Present only when `actions` includes "timeout". */
  timeoutMs?: number;
  /** Every rule that tripped, even though only the most severe is acted on. */
  matchedRules: RuleName[];
}

interface RuleMatch {
  rule: RuleName;
  actions: RuleAction[];
  reason: string;
  detail?: string;
  matches?: string[];
  timeoutMs?: number;
}

interface Exemptions {
  exemptRoles: string[];
  exemptChannels: string[];
}

function isExempt(input: EvaluationInput, rule: Exemptions): boolean {
  if (input.authorIsModerator && input.settings.exemptModerators) return true;
  const channels = input.parentChannelId ? [input.channelId, input.parentChannelId] : [input.channelId];
  if (channels.some((id) => input.settings.exemptChannels.includes(id))) return true;
  if (input.settings.exemptRoles.some((role) => input.authorRoles.includes(role))) return true;
  if (channels.some((id) => rule.exemptChannels.includes(id))) return true;
  if (rule.exemptRoles.some((role) => input.authorRoles.includes(role))) return true;
  return false;
}

const ACTION_ORDER: readonly RuleAction[] = ["delete", "warn", "timeout"];

function toMatch(
  rule: RuleName,
  ruleSettings: { actions: string[]; timeoutDuration: number },
  reason: string,
  detail?: string,
): RuleMatch {
  const actions = ACTION_ORDER.filter((action) => ruleSettings.actions.includes(action));
  return {
    rule,
    actions,
    reason,
    ...(detail ? { detail } : {}),
    timeoutMs: actions.includes("timeout") ? ruleSettings.timeoutDuration : undefined,
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
// slash or a tracking query; all of them should match the same allowlist entry.
export function normalizeInviteEntry(entry: string): string {
  const trimmed = (entry.trim().toLowerCase().split(/[?#]/)[0] ?? "").replace(/\/+$/, "");
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

  return toMatch("invites", rule, input.settings.labels.reasons.invites, disallowed);
}

// -- links ---------------------------------------------------------------

const URL_PATTERN = /https?:\/\/([^\s/?#]+)/gi;

// Letters and digits in any script, joined by single dots or hyphens, with an
// optional port. Anything else in the address part of a link is not a host a
// browser would visit; it is usually someone trying to smuggle markup or a
// mention into text that gets repeated later.
const LABEL = "[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]*[\\p{L}\\p{N}])?";
const HOSTNAME = new RegExp(`^${LABEL}(?:\\.${LABEL})*(?::\\d{1,5})?$`, "u");
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>'"*_~|`]+$/;

/** The host of every link in `content`, or null for an address that is not a valid host. */
function extractHosts(content: string): Array<string | null> {
  const hosts: Array<string | null> = [];
  for (const match of content.matchAll(URL_PATTERN)) {
    const raw = match[1];
    if (!raw) continue;
    // A link wrapped in <>, () or ** arrives with that punctuation attached.
    const host = raw.replace(TRAILING_PUNCTUATION, "").toLowerCase();
    hosts.push(host.length > 0 && host.length <= 255 && HOSTNAME.test(host) ? host : null);
  }
  return hosts;
}

// An operator pastes whatever they copied: https://youtube.com/,
// youtube.com/watch?v=1, www.youtube.com:443. Only the host is meaningful.
export function normalizeDomainEntry(entry: string): string {
  const host =
    entry
      .trim()
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
      .split(/[/?#]/)[0] ?? "";
  return host
    .replace(/^.*@/, "")
    .replace(/:\d*$/, "")
    .replace(/^\*\./, "")
    .replace(/^www\./, "")
    .replace(/\.+$/, "");
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

  const allowlist = rule.allowlist.map(normalizeDomainEntry).filter((entry) => entry !== "");
  const disallowed = hosts.find((host) => host === null || !domainAllowed(host, allowlist));
  if (disallowed === undefined) return null;

  const { reasons, fragments } = input.settings.labels;
  return toMatch("links", rule, reasons.links, disallowed ?? fragments.invalidAddress);
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

  return toMatch("capitals", rule, fill(input.settings.labels.reasons.capitals, { percent: Math.round(percent) }));
}

// -- repeated text -----------------------------------------------------

function checkRepeatedText(input: EvaluationInput): RuleMatch | null {
  const rule = input.settings.repeatedText;
  if (!rule.enabled || isExempt(input, rule)) return null;

  const runLength = Math.max(rule.maxCharacterRepeat - 1, 1);
  const wall = new RegExp(`(.)\\1{${runLength},}`, "u");
  if (wall.test(input.content)) {
    return toMatch("repeatedText", rule, fill(input.settings.labels.reasons.repeatedCharacter, { limit: rule.maxCharacterRepeat }));
  }

  // An edit is not another copy, and the message it replaced is in the history.
  if (input.isEdit) return null;
  if (normalizeForRepeat(input.content).length === 0) return null;

  const fingerprint = fingerprintOf(input.content);
  const windowStart = input.now - rule.repeatWindow;
  const priorCopies = input.history.filter(
    (message) => message.timestamp >= windowStart && message.fingerprint === fingerprint,
  ).length;
  const totalCopies = priorCopies + 1;
  if (totalCopies < rule.repeatMessageCount) return null;

  return toMatch("repeatedText", rule, fill(input.settings.labels.reasons.repeatedMessage, { count: totalCopies }));
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

  return toMatch("mentions", rule, fill(input.settings.labels.reasons.mentions, { count, limit: rule.limit }));
}

// -- banned words ------------------------------------------------------

// Obfuscation handling is kept shallow by design: fold common leetspeak
// substitutions and collapse a letter stretched three or more times
// ("fuuuuck" -> "fuck"). A word only counts when it is not part of a longer
// run of letters or digits, which is what keeps "assassin" out of a filter for
// "ass". That test uses Unicode classes rather than \b because \b only knows
// ASCII word characters: it never fires at the edge of a Cyrillic or accented
// word, so a filter for one would match nothing at all.
// This does not try to catch spaced-out or punctuated evasion ("a s s",
// "a-s-s") either: closing that gap means either stripping whitespace (which
// glues unrelated words together and reintroduces the "assassin" problem from
// the other direction) or maintaining a much heavier tokenizer, and a false
// positive that deletes a real message is worse than a determined user getting
// one slur past the filter.
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
  const substituted = [...content.toLowerCase().normalize("NFC")].map((ch) => LEET_MAP[ch] ?? ch).join("");
  return substituted.replace(/(\p{L})\1{2,}/gu, "$1");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWord(text: string, word: string): boolean {
  if (!word) return false;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}\\p{M}])${escapeRegExp(word)}(?![\\p{L}\\p{N}\\p{M}])`,
    "u",
  );
  return pattern.test(text);
}

function checkBannedWords(input: EvaluationInput): RuleMatch | null {
  const rule = input.settings.bannedWords;
  if (!rule.enabled || isExempt(input, rule) || rule.words.length === 0) return null;

  // Folding turns "!" and "@" into letters, so "damn!" becomes "damni" and
  // would slip through. The plain text is tried as well, which is what lets
  // trailing punctuation sit next to a word without hiding it.
  const plain = input.content.toLowerCase().normalize("NFC");
  const folded = normalizeForBannedWords(input.content);
  const hits = rule.words.filter((word) => {
    const plainWord = word.toLowerCase().normalize("NFC").trim();
    const foldedWord = normalizeForBannedWords(word).trim();
    return containsWord(plain, plainWord) || containsWord(folded, foldedWord);
  });
  if (hits.length === 0) return null;

  // The list's own entries are reported, never the member's text around them.
  const matches = [...new Set(hits.map((word) => word.trim()))];
  return { ...toMatch("bannedWords", rule, input.settings.labels.reasons.bannedWords, matches.join(", ")), matches };
}

// -- rate limit ----------------------------------------------------------

function checkRateLimit(input: EvaluationInput): RuleMatch | null {
  const rule = input.settings.rateLimit;
  // An edit was already counted when it was first sent.
  if (!rule.enabled || isExempt(input, rule) || input.isEdit) return null;

  const windowStart = input.now - rule.window;
  const count = input.history.filter((message) => message.timestamp >= windowStart).length + 1;
  if (count <= rule.limit) return null;

  const seconds = Math.round(rule.window / 1000);
  return toMatch("rateLimit", rule, fill(input.settings.labels.reasons.rateLimit, { count, seconds, limit: rule.limit }));
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

/** A set that times the member out outranks one that warns, which outranks deleting alone. */
function severity(actions: readonly RuleAction[]): number {
  if (actions.includes("timeout")) return 3;
  return actions.includes("warn") ? 2 : 1;
}

/**
 * Runs every rule against one message and returns what to do about it. A
 * message that trips several rules is acted on once, with the whole set of the
 * worst rule it tripped, and ties go to the rule that comes first. Sets from
 * different rules are never combined.
 */
export function evaluateMessage(input: EvaluationInput): EvaluationVerdict {
  if (input.authorIsBot) return { triggered: false, matchedRules: [] };

  const matches: RuleMatch[] = [];
  for (const check of CHECKS) {
    const match = check(input);
    if (match) matches.push(match);
  }

  if (matches.length === 0) return { triggered: false, matchedRules: [] };

  matches.sort((a, b) => severity(b.actions) - severity(a.actions));
  const top = matches[0];
  if (!top) return { triggered: false, matchedRules: [] };

  return {
    triggered: true,
    rule: top.rule,
    actions: top.actions,
    reason: top.reason,
    ...(top.detail ? { detail: top.detail } : {}),
    ...(top.matches ? { matches: top.matches } : {}),
    timeoutMs: top.timeoutMs,
    matchedRules: matches.map((match) => match.rule),
  };
}
