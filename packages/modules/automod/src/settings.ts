import { s, type Infer } from "@tier0/core";
import {
  LOG_MESSAGES,
  LOG_NOTE,
  LOG_VARIABLES,
  NOTICE_MESSAGE,
  NOTICE_NOTE,
  NOTICE_VARIABLES,
} from "./messages.js";

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
  { value: "delete", label: "Delete the message", description: "Removes the message from the channel." },
  { value: "warn", label: "Warn the member", description: "Adds a warning to the member's record." },
  { value: "timeout", label: "Time the member out", description: "Mutes the member for the timeout length below." },
];

/**
 * Fields every rule shares: whether it runs, what it does when it trips, and
 * who it leaves alone. Pulled into a function instead of written out seven
 * times, so the rules cannot quietly drift from each other.
 */
function ruleFields(rule: RuleName, defaultTimeout: string) {
  const recommended = RECOMMENDED_ACTIONS[rule];
  return {
    enabled: s.boolean({ label: "On", default: false, guided: true }),
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
      max: "28d",
      when: { field: "actions", includes: "timeout" },
    }),
    exemptRoles: s.array(s.role(), { label: "Roles exempt from this rule" }),
    exemptChannels: s.array(s.channel({ types: ["text"] }), {
      label: "Channels exempt from this rule",
    }),
  };
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
  logMessages: s.object(
    {
      delete: s.message({
        label: "When a message is deleted",
        starting: LOG_MESSAGES.delete,
        variables: LOG_VARIABLES,
        note: LOG_NOTE,
      }),
      warn: s.message({
        label: "When a member is warned",
        starting: LOG_MESSAGES.warn,
        variables: LOG_VARIABLES,
        note: LOG_NOTE,
      }),
      timeout: s.message({
        label: "When a member is timed out",
        starting: LOG_MESSAGES.timeout,
        variables: LOG_VARIABLES,
        note: LOG_NOTE,
      }),
    },
    { label: "Log posts", when: { field: "logChannel" } },
  ),

  invites: s.object(
    {
      ...ruleFields("invites", "10m"),
      allowlist: s.array(s.string(), {
        label: "Allowed invite links",
        help: "Invite codes or links that are ignored, such as this server's own invite. Paste the code or the whole link.",
      }),
    },
    { label: "Invite links", upgrade: upgradeRule("invites") },
  ),

  links: s.object(
    {
      ...ruleFields("links", "10m"),
      allowlist: s.array(s.string(), {
        label: "Allowed domains",
        help: "Domains that are ignored, such as youtube.com. A pasted link works too, and a domain also covers its subdomains.",
      }),
    },
    { label: "Links", upgrade: upgradeRule("links") },
  ),

  capitals: s.object(
    {
      ...ruleFields("capitals", "10m"),
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
    },
    { label: "Excessive capitals", upgrade: upgradeRule("capitals") },
  ),

  repeatedText: s.object(
    {
      ...ruleFields("repeatedText", "10m"),
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
        max: "1h",
      }),
    },
    { label: "Repeated text", upgrade: upgradeRule("repeatedText") },
  ),

  mentions: s.object(
    {
      ...ruleFields("mentions", "10m"),
      limit: s.integer({
        label: "User and role mentions allowed in one message",
        min: 1,
        max: 100,
        default: 5,
      }),
    },
    { label: "Mass mentions", upgrade: upgradeRule("mentions") },
  ),

  bannedWords: s.object(
    {
      ...ruleFields("bannedWords", "10m"),
      words: s.array(s.string(), { label: "Banned words or phrases" }),
    },
    { label: "Banned words", upgrade: upgradeRule("bannedWords") },
  ),

  rateLimit: s.object(
    {
      ...ruleFields("rateLimit", "5m"),
      limit: s.integer({
        label: "Messages allowed in the window",
        min: 1,
        max: 100,
        default: 5,
      }),
      window: s.duration({
        label: "Window the message count is measured over",
        default: "10s",
        max: "5m",
      }),
    },
    { label: "Rate limit", upgrade: upgradeRule("rateLimit") },
  ),
});

export type AutomodSettings = Infer<typeof settings>;
