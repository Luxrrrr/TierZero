import { applyVariables, plainReply, s } from "@tier0/core";
import type { Field, MessageBody, MessageVariable, ReplyValues } from "@tier0/core";

/**
 * Every sentence and word the moderation module puts in front of people in
 * Discord, as one table. Each default here is the wording the module had before
 * any of it was editable, and the settings page, the checks and the dashboard's
 * own error messages all read from this file, so there is one copy of each.
 *
 * Two kinds of text live here. Messages are sent whole, so they are `s.message`
 * settings. Labels are short pieces that other text is built from (the word
 * "Banned", a unit of time, a modal's title), so they are plain strings with
 * the limit Discord puts on the place they end up.
 */

// -- variables ---------------------------------------------------------------

const v = (name: string, description: string, sample: string): MessageVariable => ({ name, description, sample });

const NAME = v("name", "The member's username", "spamlord_42");
const USER = v("user", "The member's username", "spamlord_42");
const CASE = v("case", "The case number", "118");
const NOTES_VAR = v("notes", "Extra things the moderator should know, such as that the member could not be sent a direct message, each with a space in front. Empty when there is nothing to add", " They could not be sent a direct message, most likely because they do not accept messages from the bot.");
const VERB = v("verb", "What the bot was trying to do, such as ban that member or lift that ban", "ban that member");
const ABILITY = v("action", "What the person tried to do, such as warn members, time members out or ban members", "ban members");
const CORRECTION_NOTE = v(
  "correctionNote",
  "A sentence saying whether the member was sent a correction, with a space in front. Empty when the member had not been messaged. Its wording is in Labels and text",
  " They had already been sent a message about it, so they were sent a correction.",
);

// -- messages ----------------------------------------------------------------

export interface MessageSpec {
  label: string;
  /** When it fires, shown under the setting on the dashboard. */
  help: string;
  /** The wording it has always had. */
  text: string;
  variables?: MessageVariable[];
  delivery?: "channel" | "dm";
}

/**
 * Refusals. The key is the code an ActionRefused carries, so the place that
 * replies can look up the owner's wording. `dashboard` is the sentence the
 * dashboard shows a moderator for the same refusal when it differs from the one
 * said in Discord, because the dashboard speaks about the bot and not as it.
 */
export const REFUSALS = {
  reasonRequired: {
    label: "A reason is required",
    help: "When Require a reason is on and a moderator leaves the reason empty.",
    text: "This server requires a reason for moderation actions.",
  },
  reasonTooLong: {
    label: "The reason is too long",
    help: "When a reason is longer than the limit.",
    text: "A reason can be at most {max} characters.",
    variables: [v("max", "The most characters a reason can have", "500")],
  },
  durationUnreadableTimeout: {
    label: "A timeout length cannot be read",
    help: "When the length typed for a timeout is not something like 10m, 2h or 7d.",
    text: "Duration must look like 10m, 2h or 7d.",
  },
  durationUnreadableBan: {
    label: "A ban length cannot be read",
    help: "When the length typed for a ban is not something like 1d or 7d.",
    text: "Duration must look like 1d or 7d.",
  },
  timeoutTooLong: {
    label: "A timeout is longer than Discord allows",
    help: "When a timeout is set for more than 28 days.",
    text: "Timeouts cannot be longer than 28 days - that's Discord's own limit.",
  },
  banTooLong: {
    label: "A temporary ban is too long",
    help: "When a temporary ban is set for more days than the limit.",
    text: "A temporary ban can last at most {maxDays} days. Leave the duration unset for a permanent ban.",
    variables: [v("maxDays", "The most days a temporary ban can last", "3650")],
  },
  targetSelf: {
    label: "Acting on yourself",
    help: "When a moderator picks themselves as the member.",
    text: "You cannot take a moderation action against yourself.",
  },
  targetBot: {
    label: "Acting on the bot",
    help: "When the bot is picked as the member.",
    text: "The bot cannot take a moderation action against itself.",
  },
  targetOwner: {
    label: "Acting on the server owner",
    help: "When the server owner is picked as the member.",
    text: "The server owner cannot be actioned.",
  },
  noPermission: {
    label: "Not allowed to take the action",
    help: "When the person asking has neither the Discord permission nor a staff place that allows the action.",
    text: "You are not allowed to {action} here. You need the matching Discord permission, or a place on this server's staff list at a level that allows it.",
    variables: [ABILITY],
  },
  notInServer: {
    label: "The moderator is not in the server",
    help: "When the person asking is not a member of this server, so their roles cannot be compared with the member's.",
    text: "You need to be a member of this server to take moderation actions here, because the bot compares your roles with theirs.",
  },
  actorRank: {
    label: "The member outranks the moderator",
    help: "When the member's highest role is equal to or above the moderator's.",
    text: "You cannot action someone with a role equal to or higher than your own.",
  },
  botRank: {
    label: "The member outranks the bot",
    help: "When the member's highest role is equal to or above the bot's, so Discord would refuse.",
    text: "My highest role is not above theirs, so Discord won't let me do that.",
    dashboard: "The bot's highest role is not above theirs, so Discord will not let it do that. Move the bot's role higher in the server's role settings.",
  },
  notAMember: {
    label: "The user is not in the server",
    help: "When the action needs a member who is still in the server and they have left.",
    text: "That user is not a member of this server.",
  },
  lookupFailed: {
    label: "The member could not be checked",
    help: "When Discord did not answer the question of whether the member is in the server.",
    text: "Could not check that member. Try again.",
  },
  actionInProgress: {
    label: "Another action is still running",
    help: "When a second action on the same member arrives while the first is being carried out.",
    text: "Another action on this member is in progress. Try again in a moment.",
  },
  alreadyBanned: {
    label: "The member is already banned",
    help: "When /ban is used on someone who is banned.",
    text: "{name} is already banned. Use /unban first to change it.",
    dashboard: "{name} is already banned. Lift the ban first to change it.",
    variables: [NAME],
  },
  notBanned: {
    label: "The member is not banned",
    help: "When /unban is used on someone who is not banned.",
    text: "{name} is not banned.",
    variables: [NAME],
  },
  cannotActOn: {
    label: "Discord would refuse (known in advance)",
    help: "When the member is an administrator, sits above the bot, or the bot lacks the permission. Shown before the member is sent anything.",
    text: "I cannot {verb}. They may be an administrator, my role may not be above theirs, or I may lack the permission.",
    dashboard: "The bot cannot {verb}. They may be an administrator, its role may not be above theirs, or it may lack the permission.",
    variables: [VERB],
  },
  discordFailedRank: {
    label: "Discord refused: the bot's rank",
    help: "When Discord refuses a timeout, kick or ban, most often because the bot's role is not above the member's.",
    text: "I could not {verb}. Check that my role is above theirs.{correctionNote}",
    dashboard: "The bot could not {verb}. Check that its role is above theirs.{correctionNote}",
    variables: [VERB, CORRECTION_NOTE],
  },
  discordFailedPermission: {
    label: "Discord refused: the bot's permissions",
    help: "When Discord refuses to clear a timeout or lift a ban.",
    text: "I could not {verb}. Check my permissions.{correctionNote}",
    dashboard: "The bot could not {verb}. Check its permissions.{correctionNote}",
    variables: [VERB, CORRECTION_NOTE],
  },
} satisfies Record<string, MessageSpec & { dashboard?: string }>;

export type RefusalCode = keyof typeof REFUSALS;

/** Right-click menu and staff checks. */
export const STAFF = {
  notStaff: {
    label: "Not on the staff list",
    help: "When someone who is not on this server's staff list uses /case, /history or a right-click action.",
    text: "Only moderators on this server's staff list can use this. Ask the server owner to add you on the Access tab of the dashboard.",
  },
  needsAdmin: {
    label: "The action needs an admin",
    help: "When a moderator picks a right-click action only admins may take.",
    text: "You need to be an admin to {action}. A moderator can warn and time members out.",
    variables: [ABILITY],
  },
  menuNotAMember: {
    label: "The message has no member behind it",
    help: "When a right-click action is used on a message sent by a webhook or an app.",
    text: "That message was not sent by a server member, so there is nobody to act on.",
  },
  menuSelf: {
    label: "Right-click: picking yourself",
    help: "When a moderator right-clicks themselves, before the form opens.",
    text: "You cannot take an action on yourself.",
  },
  menuBot: {
    label: "Right-click: picking the bot",
    help: "When someone right-clicks the bot, before the form opens.",
    text: "That is this bot. There is nothing to do.",
  },
  menuOutOfDate: {
    label: "The form is out of date",
    help: "When a form is submitted that this version of the bot no longer understands, such as one left open across an update.",
    text: "That form is out of date. Open the menu again.",
  },
} satisfies Record<string, MessageSpec>;

/** Looking things up. */
export const LOOKUPS = {
  caseNotFound: {
    label: "No such case",
    help: "When /case is given a number no case has.",
    text: "There is no case #{number}.",
    variables: [v("number", "The case number that was asked for", "118")],
  },
  noHistory: {
    label: "A member with no history",
    help: "When /history or the Member history menu is used on a member with no cases.",
    text: "{user} has no recorded history.",
    variables: [USER],
  },
} satisfies Record<string, MessageSpec>;

/** /purge. */
export const PURGE = {
  purgeNeedsPermission: {
    label: "Missing the Manage Messages permission",
    help: "When someone without Manage Messages runs /purge, for a server where the command has been made available to more people.",
    text: "You need the Manage Messages permission to delete messages.",
  },
  purgeWrongChannel: {
    label: "Not a text channel",
    help: "When /purge is used somewhere that is not a server text channel.",
    text: "This command only works in a server text channel.",
  },
  purgeNothingEligible: {
    label: "Everything is too old",
    help: "When none of the messages picked are less than 14 days old, which is all Discord lets a bot delete in bulk.",
    text: "None of those messages can be bulk deleted: Discord only allows deleting messages sent in the last 14 days.",
  },
  purgeFailed: {
    label: "The messages could not be deleted",
    help: "When Discord refuses the deletion.",
    text: "I could not delete those messages. Check my permissions in this channel.",
  },
} satisfies Record<string, MessageSpec>;

/** What moderators are told once something has been done. */
export const CONFIRMATIONS = {
  timeoutCleared: {
    label: "A timeout was cleared",
    help: "After /timeout clear. The replies to /warn, /timeout set, /kick, /ban and /unban are on the Commands page.",
    text: "Cleared {user}'s timeout. Case #{case}.",
    variables: [USER, CASE],
  },
  contextWarned: {
    label: "Right-click: member warned",
    help: "After a warning from the right-click menu on a member or a message.",
    text: "Warned {name}. Case #{case}.{notes}",
    variables: [NAME, CASE, NOTES_VAR],
  },
  contextTimedOut: {
    label: "Right-click: member timed out",
    help: "After a timeout from the right-click menu on a member or a message.",
    text: "Timed out {name} until {until}. Case #{case}.{notes}",
    variables: [NAME, v("until", "When the timeout ends, as a Discord date", "Oct 18, 4:12 PM"), CASE, NOTES_VAR],
  },
  contextKicked: {
    label: "Right-click: member kicked",
    help: "After a kick from the right-click menu on a member or a message.",
    text: "Kicked {name}. Case #{case}.{notes}",
    variables: [NAME, CASE, NOTES_VAR],
  },
  contextBanned: {
    label: "Right-click: member banned",
    help: "After a ban from the right-click menu on a member or a message.",
    text: "Banned {name}.{expiry} Case #{case}.{notes}",
    variables: [NAME, v("expiry", "A sentence about when a temporary ban ends, with a space in front. Empty for a permanent ban", " It expires in 7 days."), CASE, NOTES_VAR],
  },
} satisfies Record<string, MessageSpec>;

/** Direct messages to a member other than the one about the action itself. */
export const DIRECT = {
  correction: {
    label: "Correction after a failed action",
    help: "Sent to a member who was told about an action when Discord then refused to carry it out. It says nothing happened.",
    text: "Correction: the message you were just sent about being {action} was sent in error. Nothing happened to you.",
    variables: [v("action", "What the earlier message said was done, in lower case: warned, timed out, kicked, banned or unbanned", "banned")],
    delivery: "dm",
  },
} satisfies Record<string, MessageSpec>;

export const REPLIES = {
  refusals: REFUSALS,
  staff: STAFF,
  lookups: LOOKUPS,
  purge: PURGE,
  confirmations: CONFIRMATIONS,
  direct: DIRECT,
} as const;

export type ReplyGroup = keyof typeof REPLIES;

export type Replies = { [G in ReplyGroup]: { [K in keyof (typeof REPLIES)[G]]: MessageBody } };

/** The group titles and the one line under each on the settings page. */
export const REPLY_GROUP_TITLES: Record<ReplyGroup, { label: string; help: string }> = {
  refusals: { label: "Actions that are refused", help: "What a moderator is told when an action cannot go ahead." },
  staff: { label: "Staff checks and the right-click menu", help: "Who may use the commands, and the checks made before a right-click form opens." },
  lookups: { label: "Cases and history", help: "What /case and /history say when there is nothing to show." },
  purge: { label: "Purge", help: "What /purge says when it cannot do its job. The reply when it works is on the Commands page." },
  confirmations: { label: "Confirmations", help: "What a moderator is told once the action has been taken." },
  direct: { label: "Direct messages", help: "Messages sent to the member besides the one about the action. That one is Direct message to the member, above." },
};

/** The sentence for a refusal, filled in. The dashboard gets its own wording where it differs. */
export function refusalSentence(code: RefusalCode, values: ReplyValues, origin: "command" | "dashboard" = "command"): string {
  const entry: { text: string; dashboard?: string } = REFUSALS[code];
  const text = origin === "dashboard" && entry.dashboard !== undefined ? entry.dashboard : entry.text;
  return applyVariables(text, stringValues(values));
}

export const stringValues = (values: ReplyValues): Record<string, string> =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));

/** The default body of one message, for the place that sends it to fall back on. */
export function defaultBody(group: ReplyGroup, key: string): MessageBody {
  const specs: Record<string, MessageSpec> = REPLIES[group];
  const spec = specs[key];
  if (!spec) throw new Error(`No moderation message named ${group}.${key}`);
  return plainReply(spec.text);
}

function messageGroup<S extends Record<string, MessageSpec>>(specs: S, title: { label: string; help: string }) {
  const entries = Object.entries(specs).map(([key, spec]) => [
    key,
    s.message({
      label: spec.label,
      help: spec.help,
      starting: plainReply(spec.text),
      variables: spec.variables ?? [],
      compact: true,
      ...(spec.delivery ? { delivery: spec.delivery } : {}),
    }),
  ]);
  return s.object(Object.fromEntries(entries) as { [K in keyof S]: Field<MessageBody> }, title);
}

/** The "Replies and errors" settings, one subgroup for each kind of message. */
export function repliesShape() {
  return {
    refusals: messageGroup(REFUSALS, REPLY_GROUP_TITLES.refusals),
    staff: messageGroup(STAFF, REPLY_GROUP_TITLES.staff),
    lookups: messageGroup(LOOKUPS, REPLY_GROUP_TITLES.lookups),
    purge: messageGroup(PURGE, REPLY_GROUP_TITLES.purge),
    confirmations: messageGroup(CONFIRMATIONS, REPLY_GROUP_TITLES.confirmations),
    direct: messageGroup(DIRECT, REPLY_GROUP_TITLES.direct),
  };
}

// -- labels ------------------------------------------------------------------

export interface TextSpec {
  label: string;
  help?: string;
  text: string;
  /** The limit of the place the text ends up, which Discord sets. */
  max: number;
  placeholders?: string[];
}

const ACTIONS = {
  warned: { label: "Warning", text: "Warned", max: 40, help: "Names a warning in the mod log, in direct messages and in /history. Written in lower case where it follows a sentence, such as You were warned." },
  timedOut: { label: "Timeout", text: "Timed out", max: 40 },
  timeoutCleared: { label: "Timeout lifted", text: "Timeout cleared", max: 40 },
  kicked: { label: "Kick", text: "Kicked", max: 40 },
  banned: { label: "Ban", text: "Banned", max: 40 },
  unbanned: { label: "Ban lifted", text: "Unbanned", max: 40 },
  automodWarn: { label: "Automod warning", text: "Automod warn", max: 40, help: "Names the case an Automod rule makes when it warns." },
  automodTimeout: { label: "Automod timeout", text: "Automod timeout", max: 40 },
  automodDelete: { label: "Automod deletion", text: "Automod message delete", max: 40 },
  automodOther: { label: "Any other Automod case", text: "Automod {kind}", max: 40, placeholders: ["kind"], help: "{kind} is what the case is called in the database." },
  automod: { label: "Automod as the moderator", text: "Automod", max: 40, help: "Shown as the moderator on a case an Automod rule made." },
  noReason: { label: "No reason", text: "No reason given", max: 100, help: "Shown wherever a case has no reason." },
  memberFallback: { label: "A member who cannot be looked up", text: "the member", max: 40, help: "Used in the middle of a sentence." },
  memberFallbackStart: { label: "The same, at the start of a sentence", text: "That member", max: 40 },
} satisfies Record<string, TextSpec>;

const ABILITIES = {
  warn: { label: "Warning", text: "warn members", max: 60, help: "Completes You are not allowed to ... here." },
  timeout: { label: "Timeouts", text: "time members out", max: 60 },
  timeoutClear: { label: "Lifting timeouts", text: "clear timeouts", max: 60 },
  kick: { label: "Kicking", text: "kick members", max: 60 },
  ban: { label: "Banning", text: "ban members", max: 60 },
  unban: { label: "Lifting bans", text: "lift bans", max: 60 },
} satisfies Record<string, TextSpec>;

const VERBS = {
  timeout: { label: "Timing out", text: "time that member out", max: 60, help: "Completes I could not ... when Discord refuses." },
  timeoutClear: { label: "Lifting a timeout", text: "clear that timeout", max: 60 },
  kick: { label: "Kicking", text: "kick that member", max: 60 },
  ban: { label: "Banning", text: "ban that member", max: 60 },
  unban: { label: "Lifting a ban", text: "lift that ban", max: 60 },
} satisfies Record<string, TextSpec>;

const NOTES = {
  reasonNote: { label: "Reason, after a sentence", text: "Reason: {reason}", max: 200, placeholders: ["reason"], help: "What {reasonNote} becomes in the mod log and direct messages when there is a reason. Left out when there is none." },
  expiryNote: { label: "Expiry, after a sentence", text: "This expires {when}.", max: 200, placeholders: ["when"], help: "What {expiryNote} becomes for a timeout or temporary ban. {when} is the time, counted from now." },
  banExpires: { label: "A temporary ban's end", text: "It expires {when}.", max: 200, placeholders: ["when"], help: "Added to the reply to /ban and to the right-click ban when the ban is temporary." },
  warnNotInServer: { label: "Warned someone who has left", text: "They are not in the server, so the warning is on their record only.", max: 300, help: "A note added to the confirmation. Moderators see it in the right-click confirmation and on the dashboard." },
  banNotInServer: { label: "Banned someone who has left", text: "They are not in the server, so the ban stops them from joining again.", max: 300 },
  dmWithheld: { label: "No message sent to someone who has left", text: "They are not in the server, so they were not sent a direct message.", max: 300 },
  dmFailed: { label: "Direct message could not be sent", text: "They could not be sent a direct message, most likely because they do not accept messages from the bot.", max: 300 },
  modLogMissing: { label: "Mod log channel is gone", text: "The mod log channel no longer exists, so nothing was posted. Choose another in the Moderation settings.", max: 300 },
  modLogFailed: { label: "Mod log post failed", text: "The mod log post failed. Check that the bot can send messages in the mod log channel.", max: 300 },
  correctionSent: { label: "Correction sent", text: "They had already been sent a message about it, so they were sent a correction.", max: 300, help: "Added to a refusal when the member had already been messaged and was then sent a correction." },
  correctionFailed: { label: "Correction could not be sent", text: "They had already been sent a message about it and the correction could not be delivered.", max: 300 },
} satisfies Record<string, TextSpec>;

const TIME = {
  dayOne: { label: "One day", text: "{n} day", max: 40, placeholders: ["n"], help: "How a length reads in {duration}. {n} is the number." },
  dayMany: { label: "Several days", text: "{n} days", max: 40, placeholders: ["n"] },
  hourOne: { label: "One hour", text: "{n} hour", max: 40, placeholders: ["n"] },
  hourMany: { label: "Several hours", text: "{n} hours", max: 40, placeholders: ["n"] },
  minuteOne: { label: "One minute", text: "{n} minute", max: 40, placeholders: ["n"] },
  minuteMany: { label: "Several minutes", text: "{n} minutes", max: 40, placeholders: ["n"] },
  secondOne: { label: "One second", text: "{n} second", max: 40, placeholders: ["n"] },
  secondMany: { label: "Several seconds", text: "{n} seconds", max: 40, placeholders: ["n"] },
} satisfies Record<string, TextSpec>;

const HISTORY = {
  line: {
    label: "A line of /history",
    text: "**#{case}** {action}{reversed} - {reason} - {date}",
    max: 300,
    placeholders: ["case", "action", "reversed", "reason", "date"],
    help: "One case in the list. {reversed} is the next setting with a space in front, or empty. {date} is a Discord date.",
  },
  reversed: { label: "A reversed case", text: "(reversed)", max: 40, help: "Added after the action for a case that has since been undone." },
  caseReversed: { label: "A reversed case, in /case", text: "This action has since been reversed.", max: 200, help: "Shown at the foot of /case for a case that has since been undone. It fills {reversedNote} in the reply to /case." },
  more: { label: "When the list is cut short", text: "...and {count} more.", max: 100, placeholders: ["count"], help: "Closes a long list, saying how many cases were left off." },
} satisfies Record<string, TextSpec>;

const COUNTS = {
  messageOne: { label: "One message", text: "{count} message", max: 60, placeholders: ["count"], help: "How a number of messages reads in the reply to /purge." },
  messageMany: { label: "Several messages", text: "{count} messages", max: 60, placeholders: ["count"] },
  skippedOne: { label: "One message left because it is old", text: "{count} message was left because it is older than 14 days.", max: 200, placeholders: ["count"], help: "Added to the reply to /purge for messages Discord does not let a bot delete in bulk." },
  skippedMany: { label: "Several messages left because they are old", text: "{count} messages were left because they are older than 14 days.", max: 200, placeholders: ["count"] },
} satisfies Record<string, TextSpec>;

const MENU = {
  menuWarn: { label: "Warn, in a form's title", text: "Warn", max: 30, help: "The first word of the title of the form a right-click action opens." },
  menuTimeout: { label: "Timeout, in a form's title", text: "Time out", max: 30 },
  menuKick: { label: "Kick, in a form's title", text: "Kick", max: 30 },
  menuBan: { label: "Ban, in a form's title", text: "Ban", max: 30 },
  modalTitle: { label: "Form title", text: "{verb} {name}", max: 45, placeholders: ["verb", "name"], help: "Shortened to Discord's limit of 45 characters once filled in." },
  reasonLabel: { label: "Reason box", text: "Reason", max: 45 },
  reasonPlaceholder: { label: "Reason hint on a member", text: "Why", max: 100 },
  reasonPlaceholderMessage: { label: "Reason hint on a message", text: "Why. The message is saved with the case.", max: 100 },
  timeoutLabel: { label: "Timeout length box", text: "How long", max: 45 },
  timeoutPlaceholder: { label: "Timeout length hint", text: "10m, 2h or 7d. Empty uses the server's default.", max: 100 },
  banLabel: { label: "Ban length box", text: "How long (empty is permanent)", max: 45 },
  banPlaceholder: { label: "Ban length hint", text: "1d or 7d. Empty is permanent.", max: 100 },
} satisfies Record<string, TextSpec>;

const REASONS = {
  tempBanExpired: {
    label: "A temporary ban ending",
    text: "Temporary ban expired",
    max: 512,
    help: "The reason when the bot lifts a temporary ban by itself. It goes in the server's audit log, on the case and in the direct message.",
  },
} satisfies Record<string, TextSpec>;

export const LABELS = {
  actions: ACTIONS,
  abilities: ABILITIES,
  verbs: VERBS,
  notes: NOTES,
  time: TIME,
  history: HISTORY,
  counts: COUNTS,
  menu: MENU,
  reasons: REASONS,
} as const;

export type Wording = { [G in keyof typeof LABELS]: { [K in keyof (typeof LABELS)[G]]: string } };

function defaultsOf(): Wording {
  const out: Record<string, Record<string, string>> = {};
  for (const [group, specs] of Object.entries(LABELS) as [string, Record<string, TextSpec>][]) {
    out[group] = Object.fromEntries(Object.entries(specs).map(([key, spec]) => [key, spec.text]));
  }
  return out as unknown as Wording;
}

/** What every label says until an owner changes it. The checks that run without a server's settings use it. */
export const DEFAULT_WORDING: Wording = defaultsOf();

const LABEL_GROUP_TITLES: Record<keyof typeof LABELS, { label: string; help: string }> = {
  actions: { label: "Names of actions", help: "What each action is called wherever it is shown to members and moderators in Discord. The dashboard keeps its own names." },
  abilities: { label: "What an action lets you do", help: "Fills in You are not allowed to ... here and You need to be an admin to ...." },
  verbs: { label: "What the bot could not do", help: "Fills in I could not ... when Discord refuses an action." },
  notes: { label: "Phrases added to other text", help: "Short sentences that other messages are built from. The space between them is added for you." },
  time: { label: "Lengths of time", help: "How a length such as 10 minutes is written." },
  history: { label: "The /history list", help: "How each line of the list is laid out." },
  counts: { label: "Purge counts", help: "How the reply to /purge counts messages." },
  menu: { label: "Right-click forms", help: "The titles, boxes and hints of the forms the right-click actions open. Discord limits each, shown as you type." },
  reasons: { label: "Reasons the bot writes", help: "Reasons the bot gives for something it does without a moderator." },
};

export function labelGroup<S extends Record<string, TextSpec>>(specs: S, title: { label: string; help: string }) {
  const entries = Object.entries(specs).map(([key, spec]) => [
    key,
    spec.placeholders
      ? s.template({ label: spec.label, ...(spec.help ? { help: spec.help } : {}), default: spec.text, max: spec.max, placeholders: spec.placeholders })
      : s.string({ label: spec.label, ...(spec.help ? { help: spec.help } : {}), default: spec.text, max: spec.max }),
  ]);
  return s.object(Object.fromEntries(entries) as { [K in keyof S]: Field<string> }, title);
}

/** The "Labels and text" settings. */
export function labelsShape() {
  return {
    actions: labelGroup(ACTIONS, LABEL_GROUP_TITLES.actions),
    abilities: labelGroup(ABILITIES, LABEL_GROUP_TITLES.abilities),
    verbs: labelGroup(VERBS, LABEL_GROUP_TITLES.verbs),
    notes: labelGroup(NOTES, LABEL_GROUP_TITLES.notes),
    time: labelGroup(TIME, LABEL_GROUP_TITLES.time),
    history: labelGroup(HISTORY, LABEL_GROUP_TITLES.history),
    counts: labelGroup(COUNTS, LABEL_GROUP_TITLES.counts),
    menu: labelGroup(MENU, LABEL_GROUP_TITLES.menu),
    reasons: labelGroup(REASONS, LABEL_GROUP_TITLES.reasons),
  };
}

/** Fills a label's own `{name}` pieces. */
export const fillLabel = (text: string, values: ReplyValues): string => applyVariables(text, stringValues(values));

/** The lengths-of-time labels as a group of their own, for another module whose messages also say how long something lasts. */
export function timeWordsGroup() {
  return labelGroup(TIME, LABEL_GROUP_TITLES.time);
}
