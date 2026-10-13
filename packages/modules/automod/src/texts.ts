import { DEFAULT_WORDING, labelGroup, timeWordsGroup, type TextSpec, type Wording as ModerationWording } from "@tier0/module-moderation";

/**
 * The short pieces automod builds its notice, its direct message and its log
 * from, each with the wording it has always had. They are plain strings
 * because other text is made from them (the outcome phrase, the rule's name,
 * the reason), not sent on their own. The messages that are sent are in
 * messages.ts.
 *
 * A rule's key (`rateLimit`) is what the code and the stored case know it by.
 * Its name here is only what members and staff are shown in Discord, and by
 * default it is the key itself, as the notice has always shown it.
 */

const OUTCOMES = {
  removedWarnedTimedOut: { label: "Removed, warned and timed out", text: "your message was removed, and you were warned and timed out", max: 200, help: "What {outcome} says, worded for the member, depending on what really happened. Not what the rule is set to do: an action that failed is left out." },
  removedWarned: { label: "Removed and warned", text: "your message was removed and you were warned", max: 200 },
  removedTimedOut: { label: "Removed and timed out", text: "your message was removed and you were timed out", max: 200 },
  warnedTimedOut: { label: "Warned and timed out", text: "you were warned and timed out", max: 200 },
  removed: { label: "Removed", text: "your message was removed", max: 200 },
  timedOut: { label: "Timed out", text: "you were timed out", max: 200 },
  warned: { label: "Warned only", text: "that message tripped automod", max: 200, help: "A warning on its own is not announced in the channel, so by default it reads like nothing happened." },
  nothing: { label: "Nothing could be done", text: "that message tripped automod", max: 200 },
} as const satisfies Record<string, TextSpec>;

const ACTION_WORDS = {
  delete: { label: "Delete", text: "delete", max: 40, help: "The words {action} lists, as in delete, warn and timeout." },
  warn: { label: "Warn", text: "warn", max: 40 },
  timeout: { label: "Time out", text: "timeout", max: 40 },
  comma: { label: "Between the first ones", text: ",", max: 10, help: "Put between all but the last two. A space is added after it." },
  and: { label: "Before the last", text: "and", max: 20, help: "Put before the last one. Spaces are added around it." },
} as const satisfies Record<string, TextSpec>;

const FRAGMENTS = {
  noReason: { label: "When there is no reason", text: "-", max: 40, help: "What {reason} says when there is nothing to add." },
  reasonNote: { label: "Reason, after a sentence", text: ": {reason}", max: 100, placeholders: ["reason"], help: "What {reasonNote} becomes when there is a reason. Left out when there is none." },
  matchesMore: { label: "More banned words matched", text: "and {count} more", max: 100, placeholders: ["count"], help: "Ends the list of what matched in the log when there are too many to show." },
  invalidAddress: { label: "A link with no readable address", text: "an invalid address", max: 100, help: "What the log says matched when a link's address could not be read." },
} as const satisfies Record<string, TextSpec>;

const RULE_NAMES = {
  invites: { label: "Invite links", text: "invites", max: 60, help: "What {rule} says when this rule trips. {ruleKey} is always the name shown here by default." },
  links: { label: "Links", text: "links", max: 60 },
  capitals: { label: "Excessive capitals", text: "capitals", max: 60 },
  repeatedText: { label: "Repeated text", text: "repeatedText", max: 60 },
  mentions: { label: "Mass mentions", text: "mentions", max: 60 },
  bannedWords: { label: "Banned words", text: "bannedWords", max: 60 },
  rateLimit: { label: "Rate limit", text: "rateLimit", max: 60 },
} as const satisfies Record<string, TextSpec>;

const REASONS = {
  invites: { label: "Invite links", text: "Posted a Discord invite link", max: 200, help: "What {reason} says when this rule trips. It is safe to show anyone and never quotes the message." },
  links: { label: "Links", text: "Posted a link to a site that isn't allowed", max: 200 },
  capitals: { label: "Excessive capitals", text: "Message was {percent}% capital letters", max: 200, placeholders: ["percent"] },
  repeatedCharacter: { label: "Repeated character", text: "Message repeats one character {limit} or more times in a row", max: 200, placeholders: ["limit"] },
  repeatedMessage: { label: "Repeated message", text: "Sent the same message {count} times in a row", max: 200, placeholders: ["count"] },
  mentions: { label: "Mass mentions", text: "Mentioned {count} users or roles, more than the limit of {limit}", max: 200, placeholders: ["count", "limit"] },
  bannedWords: { label: "Banned words", text: "Used a banned word or phrase", max: 200 },
  rateLimit: { label: "Rate limit", text: "Sent {count} messages in {seconds}s, more than the limit of {limit}", max: 200, placeholders: ["count", "seconds", "limit"] },
} as const satisfies Record<string, TextSpec>;

const PROBLEMS = {
  deleteMissingPermission: { label: "Deleting: no permission", text: "Could not delete the message: missing permission", max: 200, help: "Lines of {problems} in the log, and in the case. For staff." },
  deleteRefused: { label: "Deleting: refused", text: "Could not delete the message: Discord refused the request", max: 200 },
  timeoutMissingPermission: { label: "Timing out: no permission", text: "Could not time out: missing permission, or the member outranks the bot", max: 200 },
  timeoutRefused: { label: "Timing out: refused", text: "Could not time out: Discord refused the request", max: 200 },
} as const satisfies Record<string, TextSpec>;

const AUDIT = {
  timeoutReason: {
    label: "Reason on a timeout",
    text: "Automod: {rule}",
    max: 512,
    placeholders: ["rule", "ruleKey"],
    help: "The reason Discord's audit log shows when automod times a member out.",
  },
} as const satisfies Record<string, TextSpec>;

export const AUTOMOD_LABELS = {
  outcomes: OUTCOMES,
  actionWords: ACTION_WORDS,
  fragments: FRAGMENTS,
  ruleNames: RULE_NAMES,
  reasons: REASONS,
  problems: PROBLEMS,
  audit: AUDIT,
} as const;

export type AutomodWording = { [G in keyof typeof AUTOMOD_LABELS]: { [K in keyof (typeof AUTOMOD_LABELS)[G]]: string } } & {
  time: ModerationWording["time"];
};

function defaults(): AutomodWording {
  const out: Record<string, Record<string, string>> = {};
  for (const [group, specs] of Object.entries(AUTOMOD_LABELS) as [string, Record<string, TextSpec>][]) {
    out[group] = Object.fromEntries(Object.entries(specs).map(([key, spec]) => [key, spec.text]));
  }
  out.time = { ...DEFAULT_WORDING.time };
  return out as unknown as AutomodWording;
}

/** What every label says until an owner changes it. */
export const DEFAULT_AUTOMOD_WORDING: AutomodWording = defaults();

const TITLES: Record<keyof typeof AUTOMOD_LABELS, { label: string; help: string }> = {
  outcomes: { label: "What happened, worded for the member", help: "Fills in {outcome} in the notice and the direct message." },
  actionWords: { label: "Names of the actions", help: "Fills in {action}, as in delete and warn." },
  fragments: { label: "Small pieces", help: "The dash for no reason, the reason after a sentence, and the like." },
  ruleNames: { label: "Names of the rules", help: "How each rule is named to members and in the log. The stored case keeps the rule's own key." },
  reasons: { label: "What the member did", help: "The reason shown for each rule. It never quotes the message." },
  problems: { label: "When something could not be done", help: "Shown to staff in the log when the bot was set to do something and could not." },
  audit: { label: "Reasons written to Discord's audit log", help: "What the server's audit log says about what automod did." },
};

/** The "Labels and text" settings. */
export function labelsShape() {
  return {
    outcomes: labelGroup(OUTCOMES, TITLES.outcomes),
    actionWords: labelGroup(ACTION_WORDS, TITLES.actionWords),
    fragments: labelGroup(FRAGMENTS, TITLES.fragments),
    ruleNames: labelGroup(RULE_NAMES, TITLES.ruleNames),
    reasons: labelGroup(REASONS, TITLES.reasons),
    problems: labelGroup(PROBLEMS, TITLES.problems),
    audit: labelGroup(AUDIT, TITLES.audit),
    time: timeWordsGroup(),
  };
}
