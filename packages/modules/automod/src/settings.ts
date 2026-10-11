import { s, type Infer } from "@tier0/core";

/**
 * Fields every rule shares: whether it runs, what it does when it trips, and
 * who it leaves alone. Pulled into a function instead of written out seven
 * times, so the rules cannot quietly drift from each other.
 */
function ruleFields(defaultAction: "delete" | "warn" | "timeout", defaultTimeout: string) {
  return {
    enabled: s.boolean({ label: "On", default: false, guided: true }),
    action: s.choice({
      label: "What to do when it trips",
      options: [
        { value: "delete", label: "Delete the message" },
        { value: "warn", label: "Warn the member" },
        { value: "timeout", label: "Delete the message and time the member out" },
      ],
      default: defaultAction,
    }),
    timeoutDuration: s.duration({
      label: "Timeout length",
      default: defaultTimeout,
      max: "28d",
      when: { field: "action", equals: "timeout" },
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

  invites: s.object(
    {
      ...ruleFields("delete", "10m"),
      allowlist: s.array(s.string(), {
        label: "Allowed invite links",
        help: "Invite codes or links that are ignored, such as this server's own invite.",
      }),
    },
    { label: "Invite links" },
  ),

  links: s.object(
    {
      ...ruleFields("delete", "10m"),
      allowlist: s.array(s.string(), {
        label: "Allowed domains",
        help: "Domains that are ignored, such as youtube.com.",
      }),
    },
    { label: "Links" },
  ),

  capitals: s.object(
    {
      ...ruleFields("warn", "10m"),
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
    { label: "Excessive capitals" },
  ),

  repeatedText: s.object(
    {
      ...ruleFields("delete", "10m"),
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
    { label: "Repeated text" },
  ),

  mentions: s.object(
    {
      ...ruleFields("timeout", "10m"),
      limit: s.integer({
        label: "User and role mentions allowed in one message",
        min: 1,
        max: 100,
        default: 5,
      }),
    },
    { label: "Mass mentions" },
  ),

  bannedWords: s.object(
    {
      ...ruleFields("delete", "10m"),
      words: s.array(s.string(), { label: "Banned words or phrases" }),
    },
    { label: "Banned words" },
  ),

  rateLimit: s.object(
    {
      ...ruleFields("timeout", "5m"),
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
    { label: "Rate limit" },
  ),
});

export type AutomodSettings = Infer<typeof settings>;
