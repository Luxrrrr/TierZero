import { s } from "@tier0/core";
import type { Infer } from "@tier0/core";
import {
  APPEAL_DENIED_DM,
  APPEAL_ACCEPTED_DM,
  APPEAL_POST,
  APPEAL_POST_VARIABLES,
  APPEAL_REPLIES,
  APPEAL_DECISION_VARIABLES,
  DM_MESSAGE,
  DM_MESSAGE_BEFORE_CONTEXT,
  DM_NOTE,
  DM_VARIABLES,
  LOCKDOWN_NOTICE,
  LOCKDOWN_VARIABLES,
  MODLOG_MESSAGE,
  MODLOG_NOTE,
  MODLOG_VARIABLES,
  RAID_ALERT,
  RAID_ALERT_VARIABLES,
  UNLOCK_NOTICE,
} from "./messages.js";
import { labelsShape, repliesShape } from "./texts.js";

export const ESCALATION_ACTIONS = ["timeout", "kick", "ban"] as const;
export type EscalationAction = (typeof ESCALATION_ACTIONS)[number];

const escalationRule = s.object({
  id: s.string({ generated: true }),
  enabled: s.boolean({ label: "On", default: true }),
  name: s.string({
    label: "Name",
    optional: true,
    max: 60,
    help: "Shown on the case the rule makes. Left empty, the case says what the rule counts.",
  }),
  warns: s.integer({ label: "Warnings", min: 2, max: 50, default: 3, help: "How many warnings set this rule off." }),
  windowDays: s.integer({
    label: "Within the last (days)",
    min: 0,
    max: 3650,
    default: 30,
    help: "Only warnings from this many days ago up to now count. 0 counts every warning on the record.",
  }),
  action: s.choice({
    label: "Then",
    default: "timeout",
    options: [
      { value: "timeout", label: "Time out" },
      { value: "kick", label: "Kick" },
      { value: "ban", label: "Ban" },
    ],
  }),
  timeoutDuration: s.duration({ label: "Timeout length", default: "1h", min: "1m", max: "28d", when: { field: "action", equals: "timeout" } }),
  banDuration: s.duration({
    label: "Ban length",
    optional: true,
    min: "1h",
    max: "3650d",
    help: "Leave it empty for a permanent ban.",
    when: { field: "action", equals: "ban" },
  }),
});

const reasonPreset = s.object({
  name: s.string({ label: "Name", min: 1, max: 60, help: "What a moderator picks. In Discord it is what they type or choose in the reason box." }),
  reason: s.string({ label: "Reason", min: 1, max: 500, multiline: true, help: "Saved on the case and sent to the member, as any reason is." }),
  duration: s.duration({
    label: "Length",
    optional: true,
    min: "1m",
    max: "3650d",
    help: "Optional. A timeout or temporary ban starts at this length when the preset is picked. A timeout is never longer than 28 days.",
  }),
});

export const moderationSettings = s.object({
  modLogChannel: s.channel({
    types: ["text"],
    optional: true,
    guided: true,
    section: "general",
    label: "Mod log channel",
    help: "Where warn, timeout, kick, ban and unban actions are posted. Left unset, nothing is posted.",
  }),
  modLogMessage: s.message({
    label: "Mod log post",
    section: "general",
    starting: MODLOG_MESSAGE,
    variables: MODLOG_VARIABLES,
    note: MODLOG_NOTE,
    when: { field: "modLogChannel" },
  }),
  dashboardUrl: s.string({
    optional: true,
    origin: true,
    section: "general",
    label: "Dashboard address",
    help: "The address you open this dashboard at, such as https://bot.example.com. Leave it blank and the bot uses the address you last opened the dashboard at. It is used for the View in dashboard button on mod log posts.",
  }),
  dmOnAction: s.boolean({
    default: true,
    guided: true,
    section: "general",
    label: "Direct message the member when action is taken",
    help: "The moderator's reason is sent to the member exactly as written, and it is also the reason kept on the case. Keep notes meant only for staff out of it.",
  }),
  dmIncludeMessages: s.boolean({
    default: true,
    section: "general",
    label: "Include the messages in the direct message",
    help: "When a moderator attaches messages to an action, or uses a right-click action on a message, the member sees those messages in the direct message, as they wrote them, with the reason. Turn this off to send the reason only.",
    when: { field: "dmOnAction", equals: true },
  }),
  dmShowModerator: s.boolean({
    default: false,
    section: "general",
    label: "Show who took the action",
    help: "Adds the moderator's display name to the direct message. Off by default, so members cannot single out the moderator who acted. Actions the bot takes by itself never show a name.",
    when: { field: "dmOnAction", equals: true },
  }),
  dmMessage: s.message({
    label: "Direct message to the member",
    section: "general",
    starting: DM_MESSAGE,
    replaces: [DM_MESSAGE_BEFORE_CONTEXT],
    variables: DM_VARIABLES,
    delivery: "dm",
    help: "{reason} is the reason the moderator typed, sent as written. {evidence} holds the messages that led to the action. A message you saved before {evidence} existed does not show them until you add it, but the default does. {moderator} and {moderatorId} are available if you want them shown whatever Show who took the action says.",
    note: DM_NOTE,
    when: { field: "dmOnAction", equals: true },
  }),
  defaultTimeoutDuration: s.duration({
    default: "10m",
    min: "1m",
    max: "28d",
    guided: true,
    section: "general",
    label: "Default timeout length",
    help: "Used when a moderator runs /timeout set without specifying a duration.",
  }),
  requireReason: s.boolean({
    default: false,
    section: "general",
    label: "Require a reason for moderation actions",
  }),
  deleteMessagesByDefault: s.boolean({
    default: false,
    section: "general",
    label: "Delete the message by default when acting on it",
    help: "When a moderator warns, times out, kicks or bans someone over a message, the choice to delete that message too starts on. They can still change it each time. The messages are only deleted after the action went through, and the copy kept with the case stays readable.",
  }),
  deleteMessageDays: s.integer({
    min: 0,
    max: 7,
    default: 0,
    section: "general",
    label: "Days of the banned member's messages to delete",
  }),
  reasonPresets: s.array(reasonPreset, {
    label: "Reason presets",
    section: "reasons",
    item: "reason preset",
    max: 25,
    help: "Common reasons kept ready. Moderators pick one in the dashboard's action form, in the right-click forms, and as a suggestion in the reason box of /warn, /timeout, /kick and /ban. Typing a preset's name as the reason uses it too.",
  }),
  warnExpiry: s.duration({
    label: "Warnings stop counting after",
    optional: true,
    min: "1d",
    max: "3650d",
    section: "escalation",
    help: "Leave it empty and warnings count for good. An expired warning stays on the record, marked expired, but no longer counts in a member's warn total or toward escalation.",
  }),
  escalation: s.object(
    {
      rules: s.array(escalationRule, {
        label: "Rules",
        item: "rule",
        max: 10,
        help: "After every warning, a moderator's or automod's, the bot counts the member's warnings. When a rule's count is reached, the bot takes its action by itself, as a case of its own that says which rule fired. When several rules are reached, the one needing the most warnings wins, then the one listed first. A rule fires once for each run of warnings that reaches it.",
      }),
      exemptRoles: s.array(s.role(), {
        label: "Roles never escalated",
        help: "Members with any of these roles are never acted on by a rule. Staff on the Access list and anyone the bot cannot act on are always left alone.",
      }),
    },
    { label: "Automatic escalation", section: "escalation" },
  ),
  joinAlert: s.object(
    {
      enabled: s.boolean({ label: "On", default: false }),
      joins: s.integer({ label: "Joins", min: 3, max: 500, default: 10, help: "How many members joining set off the alert." }),
      window: s.duration({ label: "Within", default: "30s", min: "5s", max: "10m" }),
      lockdown: s.boolean({
        label: "Lock the server down as well",
        default: false,
        help: "Locks every channel a lockdown covers, the same as Lock all on the Raid tools tab. Unlock it there or with /lockdown end.",
      }),
      lockdownLength: s.duration({
        label: "Lift the lockdown after",
        optional: true,
        min: "1m",
        max: "7d",
        help: "The channels reopen by themselves after this. Anyone can set off a join alert by joining in numbers, so a length is safer than leaving it empty, which keeps the server locked until someone unlocks it.",
        when: { field: "lockdown", equals: true },
      }),
      message: s.message({
        label: "Alert in the mod log channel",
        starting: RAID_ALERT,
        variables: RAID_ALERT_VARIABLES,
        help: "Posted in the mod log channel when the alert goes off. Nothing is posted while no mod log channel is set.",
      }),
    },
    {
      label: "Join-rate alert",
      section: "raid",
      collapsible: true,
      summary: ["enabled", "joins", "window", "lockdown"],
    },
  ),
  lockdown: s.object(
    {
      exemptChannels: s.array(s.channel({ types: ["text", "voice", "forum"] }), {
        label: "Channels a lockdown leaves alone",
        help: "Locking every channel skips these, such as the rules channel or a channel for staff. Channels members cannot see are always skipped.",
      }),
      notify: s.boolean({ label: "Post a notice in each channel it locks and unlocks", default: true }),
      lockedNotice: s.message({
        label: "Notice when a channel is locked",
        starting: LOCKDOWN_NOTICE,
        variables: LOCKDOWN_VARIABLES,
        compact: true,
        when: { field: "notify", equals: true },
      }),
      unlockedNotice: s.message({
        label: "Notice when a channel is unlocked",
        starting: UNLOCK_NOTICE,
        variables: LOCKDOWN_VARIABLES,
        compact: true,
        when: { field: "notify", equals: true },
      }),
    },
    { label: "Lockdown", section: "raid", collapsible: true },
  ),
  appeals: s.object(
    {
      enabled: s.boolean({
        label: "Let banned members appeal",
        default: false,
        help: "Adds an appeal button to the direct message a member gets when they are banned. Bans made before this was on have no button. Appeals are read and decided on the Appeals tab.",
      }),
      buttonLabel: s.string({ label: "Button text", default: "Appeal this ban", min: 1, max: 80, when: { field: "enabled", equals: true } }),
      channel: s.channel({
        types: ["text"],
        optional: true,
        label: "Post new appeals in",
        help: "A staff channel told about each new appeal. Left unset, the mod log channel is used, and nothing is posted when neither is set.",
        when: { field: "enabled", equals: true },
      }),
      cooldown: s.duration({
        label: "Wait after a denied appeal",
        default: "7d",
        min: "0s",
        max: "365d",
        help: "How long a member must wait before appealing the same ban again. 0s lets them appeal again straight away.",
        when: { field: "enabled", equals: true },
      }),
      formTitle: s.string({ label: "Form title", default: "Appeal your ban", min: 1, max: 45, when: { field: "enabled", equals: true } }),
      formQuestion: s.string({ label: "Question", default: "Why should the ban be lifted?", min: 1, max: 45, when: { field: "enabled", equals: true } }),
      formPlaceholder: s.string({
        label: "Hint in the answer box",
        default: "Say what happened and why you should be let back in.",
        max: 100,
        optional: true,
        when: { field: "enabled", equals: true },
      }),
      post: s.message({
        label: "Post about a new appeal",
        starting: APPEAL_POST,
        variables: APPEAL_POST_VARIABLES,
        compact: true,
        when: { field: "enabled", equals: true },
      }),
      acceptedMessage: s.message({
        label: "Direct message when an appeal is accepted",
        starting: APPEAL_ACCEPTED_DM,
        variables: APPEAL_DECISION_VARIABLES,
        delivery: "dm",
        compact: true,
        when: { field: "enabled", equals: true },
      }),
      deniedMessage: s.message({
        label: "Direct message when an appeal is denied",
        starting: APPEAL_DENIED_DM,
        variables: APPEAL_DECISION_VARIABLES,
        delivery: "dm",
        compact: true,
        when: { field: "enabled", equals: true },
      }),
      replies: s.object(
        Object.fromEntries(
          Object.entries(APPEAL_REPLIES).map(([key, spec]) => [
            key,
            s.message({ label: spec.label, help: spec.help, starting: spec.starting, variables: spec.variables, delivery: "dm", compact: true }),
          ]),
        ) as { [K in keyof typeof APPEAL_REPLIES]: ReturnType<typeof s.message> },
        { label: "Replies to the member", help: "What the member is told after pressing the button or sending the form." },
      ),
    },
    { label: "Ban appeals", section: "appeals" },
  ),
  replies: s.object(repliesShape(), {
    label: "Replies and errors",
    section: "messages",
    help: "What the bot says back to moderators in Discord: refusals, confirmations and empty states. The replies to /warn, /timeout set, /kick, /ban, /unban, /case, /history and /purge are on the Commands page.",
    collapsible: true,
  }),
  labels: s.object(labelsShape(), {
    label: "Labels and text",
    section: "messages",
    help: "The short pieces other text is built from: the names of actions, lengths of time, and the titles and boxes of the right-click forms.",
    collapsible: true,
  }),
});

export type ModerationSettings = Infer<typeof moderationSettings>;
export type EscalationRule = ModerationSettings["escalation"]["rules"][number];
export type ReasonPreset = ModerationSettings["reasonPresets"][number];
