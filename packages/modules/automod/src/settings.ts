import { s, type Field, type Infer } from "@tier0/core";
import { PATTERN_MAX_LENGTH, patternProblem } from "./patterns.js";
import {
  DM_MESSAGE,
  DM_NOTE,
  DM_VARIABLES,
  LOG_MESSAGES,
  LOG_NOTE,
  LOG_VARIABLES,
  NOTICE_MESSAGE,
  NOTICE_NOTE,
  NOTICE_VARIABLES,
} from "./messages.js";
import { labelsShape } from "./texts.js";

export type RuleAction = "delete" | "warn" | "timeout";

export type RuleName =
  | "invites"
  | "links"
  | "capitals"
  | "repeatedText"
  | "mentions"
  | "bannedWords"
  | "rateLimit";

/**
 * What each rule does out of the box, and what the dashboard marks as the
 * suggested pick. One table so the choice reads as a decision: the lighter
 * rules only remove the message, the ones that point at a person or a flood
 * warn or time out as well. Rules start switched off either way.
 */
export const RECOMMENDED_ACTIONS: Record<RuleName, readonly RuleAction[]> = {
  invites: ["delete", "warn"],
  links: ["delete"],
  capitals: ["delete"],
  repeatedText: ["delete", "warn"],
  mentions: ["delete", "timeout"],
  bannedWords: ["delete", "warn"],
  rateLimit: ["delete", "timeout"],
};

/**
 * What a rule did before it could do several things at once. Used only to read
 * settings saved back then, and for a rule that was switched on but never had
 * its action saved, so that upgrading changes nothing for a running server.
 */
const LEGACY_DEFAULT: Record<RuleName, string> = {
  invites: "delete",
  links: "delete",
  capitals: "warn",
  repeatedText: "delete",
  mentions: "timeout",
  bannedWords: "delete",
  rateLimit: "timeout",
};

// The old "timeout" preset deleted the message as well; a plain "warn" never did.
const LEGACY_ACTIONS: Record<string, RuleAction[]> = {
  delete: ["delete"],
  warn: ["warn"],
  timeout: ["delete", "timeout"],
};

/**
 * Turns the single `action` a rule used to store into the `actions` list. It
 * runs on every read, so a value that already has `actions` is left as it is.
 */
export function upgradeRule(rule: RuleName) {
  return (stored: Record<string, unknown>): Record<string, unknown> => {
    const { action, ...rest } = stored;
    if (rest.actions !== undefined) return rest;
    const legacy = typeof action === "string" ? action : rest.enabled === true ? LEGACY_DEFAULT[rule] : undefined;
    const actions = legacy === undefined ? undefined : LEGACY_ACTIONS[legacy];
    return actions ? { ...rest, actions } : rest;
  };
}

const ACTION_OPTIONS: Array<{ value: RuleAction; label: string; description: string }> = [
  { value: "delete", label: "Delete", description: "Removes the message." },
  { value: "warn", label: "Warn", description: "Adds a warning to their record." },
  { value: "timeout", label: "Time out", description: "Mutes them for the timeout length." },
];

/**
 * Fields every rule starts with: whether it runs and what it does when it
 * trips. Pulled into a function instead of written out seven times, so the
 * rules cannot quietly drift from each other. The rule's own tuning follows,
 * then `ruleExemptions`, so the page reads from the common settings to the
 * rare ones.
 */
function ruleHead(rule: RuleName, defaultTimeout: string) {
  const recommended = RECOMMENDED_ACTIONS[rule];
  return {
    // Every rule's switch is in one essential set, so automod reads "Needs setup" while all are off, naming the rules.
    enabled: s.boolean({ label: "On", default: false, guided: true, essential: "rules" }),
    actions: s.array(
      s.choice({
        options: ACTION_OPTIONS.map((option) => ({ ...option, recommended: recommended.includes(option.value) })),
      }),
      {
        label: "What to do when it trips",
        help: "Pick any combination. The suggested ones are marked.",
        min: 1,
        unique: true,
        default: [...recommended],
      },
    ),
    timeoutDuration: s.duration({
      label: "Timeout length",
      default: defaultTimeout,
      min: "1m",
      max: "28d",
      when: { field: "actions", includes: "timeout" },
    }),
    countTowardEscalation: s.boolean({
      label: "Count its warnings toward automatic escalation",
      default: true,
      help: "Warnings from this rule count toward the escalation rules in the Moderation settings, as a moderator's do.",
      when: { field: "actions", includes: "warn" },
    }),
  };
}

/**
 * A string setting with one more rule than its builder knows, applied when it
 * is saved and on every read. The rules used here only look at the text, so
 * what passed when it was saved still passes when it is read back.
 */
function checked(field: Field<string>, problem: (value: string) => string | null): Field<string> {
  return {
    ...field,
    parse(input, path = "") {
      const result = field.parse(input, path);
      if (!result.ok) return result;
      const found = problem(result.value);
      return found ? { ok: false, errors: [{ path, message: found }] } : result;
    },
  };
}

/** Who a rule leaves alone, last because most servers never touch it. */
function ruleExemptions() {
  return {
    exemptRoles: s.array(s.role(), { label: "Roles exempt from this rule" }),
    exemptChannels: s.array(s.channel({ types: ["text"] }), {
      label: "Channels exempt from this rule",
    }),
  };
}

/**
 * Every rule is a collapsed section whose header shows what it does, so the
 * page can be scanned without opening seven cards.
 */
function ruleOptions(label: string, rule: RuleName) {
  return { label, collapsible: true, summary: ["actions", "timeoutDuration"], upgrade: upgradeRule(rule) };
}

export const settings = s.object({
  exemptRoles: s.array(s.role(), {
    guided: true,
    label: "Roles automod never acts on",
    help: "Members with any of these roles are ignored by every rule below.",
  }),
  exemptChannels: s.array(s.channel({ types: ["text"] }), {
    label: "Channels automod never acts in",
  }),
  exemptModerators: s.boolean({
    label: "Exempt members who can manage messages or time others out",
    default: true,
  }),
  logChannel: s.channel({
    types: ["text"],
    optional: true,
    guided: true,
    label: "Post automod actions in",
  }),
  noticeMessage: s.message({
    label: "Notice in the channel",
    starting: NOTICE_MESSAGE,
    variables: NOTICE_VARIABLES,
    note: NOTICE_NOTE,
  }),
  noticeLifetime: s.duration({
    label: "How long the notice stays",
    default: "8s",
    max: "5m",
    help: "Then the bot removes it again. Anything under 2 seconds is taken as 2, and 0s keeps the notice.",
  }),
  dmOnAction: s.boolean({
    label: "Also message the member privately",
    default: false,
    help: "Sends the member a direct message when one of their messages trips a rule, so they know why without the whole channel seeing. It never quotes what they wrote. A member with direct messages closed is skipped.",
  }),
  dmMessage: s.message({
    label: "Direct message to the member",
    starting: DM_MESSAGE,
    variables: DM_VARIABLES,
    delivery: "dm",
    note: DM_NOTE,
    when: { field: "dmOnAction", equals: true },
  }),
  logMessages: s.object(
    {
      delete: s.message({
        label: "When a message is deleted",
        starting: LOG_MESSAGES.delete,
        variables: LOG_VARIABLES,
        note: LOG_NOTE,
        compact: true,
      }),
      warn: s.message({
        label: "When a member is warned",
        starting: LOG_MESSAGES.warn,
        variables: LOG_VARIABLES,
        note: LOG_NOTE,
        compact: true,
      }),
      timeout: s.message({
        label: "When a member is timed out",
        starting: LOG_MESSAGES.timeout,
        variables: LOG_VARIABLES,
        note: LOG_NOTE,
        compact: true,
      }),
    },
    { label: "Log posts", when: { field: "logChannel" } },
  ),

  invites: s.object(
    {
      ...ruleHead("invites", "10m"),
      allowlist: s.array(s.string(), {
        label: "Allowed invite links",
        help: "Invite codes or links that are ignored, such as this server's own invite. Paste the code or the whole link.",
      }),
      ...ruleExemptions(),
    },
    ruleOptions("Invite links", "invites"),
  ),

  links: s.object(
    {
      ...ruleHead("links", "10m"),
      allowlist: s.array(s.string(), {
        label: "Allowed domains",
        help: "Domains that are ignored, such as youtube.com. A pasted link works too, and a domain also covers its subdomains.",
      }),
      ...ruleExemptions(),
    },
    ruleOptions("Links", "links"),
  ),

  capitals: s.object(
    {
      ...ruleHead("capitals", "10m"),
      thresholdPercent: s.integer({
        label: "Percentage of capital letters that trips this rule",
        min: 1,
        max: 100,
        default: 70,
      }),
      minLength: s.integer({
        label: "Shortest message this rule considers",
        min: 1,
        max: 2000,
        default: 10,
      }),
      ...ruleExemptions(),
    },
    ruleOptions("Excessive capitals", "capitals"),
  ),

  repeatedText: s.object(
    {
      ...ruleHead("repeatedText", "10m"),
      maxCharacterRepeat: s.integer({
        label: "Longest run of one repeated character allowed",
        min: 3,
        max: 100,
        default: 10,
      }),
      repeatMessageCount: s.integer({
        label: "Copies of the same message before this trips",
        min: 2,
        max: 20,
        default: 4,
      }),
      repeatWindow: s.duration({
        label: "Window the repeated messages must fall within",
        default: "30s",
        min: "1s",
        max: "1h",
      }),
      ...ruleExemptions(),
    },
    ruleOptions("Repeated text", "repeatedText"),
  ),

  mentions: s.object(
    {
      ...ruleHead("mentions", "10m"),
      limit: s.integer({
        label: "User and role mentions allowed in one message",
        min: 1,
        max: 100,
        default: 5,
      }),
      ...ruleExemptions(),
    },
    ruleOptions("Mass mentions", "mentions"),
  ),

  bannedWords: s.object(
    {
      ...ruleHead("bannedWords", "10m"),
      // Not checked on save: lists saved before wildcards existed may hold any number of *, and a check
      // that failed on read would switch automod off. A word with more than two is matched as written.
      words: s.array(s.string(), {
        label: "Banned words or phrases",
        help: "A * in a word stands for a few characters with no space, so free*nitro also catches freenitro and free-nitro. Up to two * in one word; a word with more is matched exactly as written.",
      }),
      patterns: s.array(checked(s.string({ max: PATTERN_MAX_LENGTH }), patternProblem), {
        label: "Patterns",
        max: 50,
        help: "Regular expressions, for owners who know them, matched without regard to case. Patterns that could take too long are refused when you save: repeating a group that repeats or is optional, such as (a+)+ or (a?b?)+, references back to a group, lookahead and lookbehind, and long runs of optional parts. A repeat such as + or * covers at most 32 characters.",
      }),
      ...ruleExemptions(),
    },
    ruleOptions("Banned words", "bannedWords"),
  ),

  rateLimit: s.object(
    {
      ...ruleHead("rateLimit", "5m"),
      limit: s.integer({
        label: "Messages allowed in the window",
        min: 1,
        max: 100,
        default: 5,
      }),
      window: s.duration({
        label: "Window the message count is measured over",
        default: "10s",
        min: "1s",
        max: "5m",
      }),
      ...ruleExemptions(),
    },
    ruleOptions("Rate limit", "rateLimit"),
  ),

  labels: s.object(labelsShape(), {
    label: "Labels and text",
    help: "The short pieces the notice, the direct message and the log are built from: how each rule is named, what the member did, and what happened to them.",
    collapsible: true,
  }),
});

export type AutomodSettings = Infer<typeof settings>;
