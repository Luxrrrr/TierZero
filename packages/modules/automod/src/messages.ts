import { dashboardLinks, emptyEmbed, plainReply, viewCaseButton, type MessageBody, type MessageEmbed, type MessageVariable } from "@tier0/core";
import { describeLength } from "@tier0/module-moderation";
import { fill } from "./fill.js";
import { DEFAULT_AUTOMOD_WORDING, type AutomodWording } from "./texts.js";

export { describeLength };

/**
 * What automod says when a rule trips, as the dashboard offers it: the notice in
 * the channel, a direct message to the member and the log post.
 * Each `starting` body is what automod sent before they were editable.
 *
 * What a member wrote never reaches the channel. The reason is fixed wording;
 * the invite code, address or banned word that matched goes only to the log and
 * the infraction, both of which staff read.
 */

export type LoggedAction = "warn" | "delete" | "timeout";

const USER: MessageVariable = { name: "user", description: "The member who tripped the rule, as a mention", sample: "@spamlord_42" };
const USER_ID: MessageVariable = { name: "userId", description: "The member's user ID", sample: "123456789012345678" };
const RULE: MessageVariable = { name: "rule", description: "The rule that tripped, as it is named in Labels and text", sample: "invites" };
const RULE_KEY: MessageVariable = { name: "ruleKey", description: "The rule's own name, whatever it is called in Labels and text", sample: "invites" };
const ACTION: MessageVariable = { name: "action", description: "What was done, in words: delete, warn, timeout, or several such as delete and warn", sample: "delete" };
const REASON: MessageVariable = { name: "reason", description: "What the member did to trip it, worded so it is safe to show anyone, or a dash when there is nothing to add", sample: "Posted a Discord invite link" };
const DURATION: MessageVariable = { name: "duration", description: "How long the timeout lasts. Empty unless the member was timed out", sample: "10 minutes" };
const MATCH: MessageVariable = {
  name: "match",
  description: "What matched: the invite code, the address, or the banned words from your list, in code blocks so nothing turns into a link. Empty for rules that match nothing specific. Meant for the log, not the channel",
  sample: "`abcdef`",
};
const CASE: MessageVariable = { name: "case", description: "The case number automod's record of this was given", sample: "118" };
const CASE_URL: MessageVariable = {
  name: "caseUrl",
  description: "A link that opens this case in the dashboard, where staff can read the removed message. Empty when the bot does not know the dashboard's address yet, which leaves a link button that uses it out of the post",
  sample: "https://bot.example.com/guilds/123456789012345678/mod/members/123456789012345678?case=118",
};
const MEMBER_URL: MessageVariable = {
  name: "memberUrl",
  description: "A link that opens the member's record in the dashboard. Empty when the bot does not know the dashboard's address yet",
  sample: "https://bot.example.com/guilds/123456789012345678/mod/members/123456789012345678",
};
const REASON_NOTE: MessageVariable = {
  name: "reasonNote",
  description: "A colon, a space and the reason. Empty when there is nothing to add",
  sample: ": Posted a Discord invite link",
};
const OUTCOME: MessageVariable = {
  name: "outcome",
  description: "What actually happened, worded for the member: your message was removed, you were timed out, your message was removed and you were warned, and so on, or that message tripped automod when all that happened was a warning or nothing",
  sample: "your message was removed",
};
const PROBLEMS: MessageVariable = {
  name: "problems",
  description: "What the bot could not do, such as time the member out. Empty when everything it was set to do worked",
  sample: "Could not time out: missing permission",
};

export const NOTICE_VARIABLES: MessageVariable[] = [
  USER,
  USER_ID,
  RULE,
  RULE_KEY,
  ACTION,
  REASON,
  REASON_NOTE,
  OUTCOME,
  DURATION,
];

export const NOTICE_MESSAGE: MessageBody = plainReply("{user}, {outcome} ({rule}{reasonNote}).");

export const NOTICE_NOTE = "Posted in the channel where the message was, and removed again after the time set below. It can only mention the member it is about.";

/** Never the matched text: what a member wrote goes only to the log and the case, which staff read. */
export const DM_VARIABLES: MessageVariable[] = [USER, USER_ID, RULE, RULE_KEY, ACTION, REASON, REASON_NOTE, OUTCOME, DURATION];

export const DM_MESSAGE: MessageBody = plainReply("In {server}, {outcome} ({rule}{reasonNote}).");

export const DM_NOTE =
  "Sent privately to the member whose message tripped a rule, when it is switched on. It gives the rule's reason in general words and never quotes what they wrote. A member with direct messages closed does not get it.";

export const LOG_VARIABLES: MessageVariable[] = [USER, USER_ID, RULE, RULE_KEY, ACTION, REASON, MATCH, PROBLEMS, DURATION, CASE, CASE_URL, MEMBER_URL];

function logPost(color: string): MessageBody {
  const embed: MessageEmbed = {
    ...emptyEmbed(),
    color,
    description: "{user} tripped **{rule}**",
    timestamp: "now",
    // A field whose variable comes to nothing is left out, so these two only
    // show when there is something for staff to see.
    fields: [
      { name: "Action", value: "{action}", inline: true },
      { name: "Reason", value: "{reason}", inline: true },
      { name: "Matched", value: "{match}", inline: true },
      { name: "Not carried out", value: "{problems}", inline: false },
    ],
  };
  // The button is left out of the post while the dashboard's address is not known.
  return { ...plainReply(""), embeds: [embed], buttons: [viewCaseButton()] };
}

/** One post for each action, so each keeps the colour it has always had. */
export const LOG_MESSAGES: Record<LoggedAction, MessageBody> = {
  warn: logPost("#f5a623"),
  delete: logPost("#ed4245"),
  timeout: logPost("#992d22"),
};

export const LOG_NOTE =
  "Posted in the log channel when a rule trips. There is one for each thing a rule can do, so each can have its own colour. It never mentions anyone. The View in dashboard button is left out until the bot knows the dashboard's address (see Dashboard address in the moderation settings).";

/**
 * What the member is told, from what was done rather than from what the rule
 * was set to do. A warning on its own gets the same line as nothing at all, as
 * it always has: the notice is not where a warning is announced.
 */
export function describeOutcome(
  done: { deleted: boolean; warned?: boolean; timedOut: boolean },
  words: AutomodWording["outcomes"] = DEFAULT_AUTOMOD_WORDING.outcomes,
): string {
  const warned = done.warned === true;
  if (done.deleted && warned && done.timedOut) return words.removedWarnedTimedOut;
  if (done.deleted && warned) return words.removedWarned;
  if (done.deleted && done.timedOut) return words.removedTimedOut;
  if (warned && done.timedOut) return words.warnedTimedOut;
  if (done.deleted) return words.removed;
  if (done.timedOut) return words.timedOut;
  return warned ? words.warned : words.nothing;
}

const STRENGTH: readonly LoggedAction[] = ["timeout", "warn", "delete"];

/** What was actually done, in the order delete, warn, timeout. Falls back to what was asked for when nothing worked. */
export function effectiveActions(facts: Pick<TripFacts, "actions" | "deleted" | "warned" | "timedOut">): LoggedAction[] {
  const done: LoggedAction[] = [];
  if (facts.deleted) done.push("delete");
  if (facts.warned) done.push("warn");
  if (facts.timedOut) done.push("timeout");
  return done.length > 0 ? done : [...facts.actions];
}

/** Which of the three log posts to use: the one for the strongest thing done. */
export function loggedAs(facts: Pick<TripFacts, "actions" | "deleted" | "warned" | "timedOut">): LoggedAction {
  const done = effectiveActions(facts);
  return STRENGTH.find((action) => done.includes(action)) ?? "warn";
}

/** "delete", "delete and warn", "delete, warn and timeout". */
function readableList(actions: LoggedAction[], words: AutomodWording["actionWords"]): string {
  const named = actions.map((action) => words[action]);
  if (named.length <= 1) return named[0] ?? "";
  return `${named.slice(0, -1).join(`${words.comma} `)} ${words.and} ${named[named.length - 1]}`;
}

export interface TripFacts {
  userId: string;
  rule: string;
  /** What the rule is set to do. What really happened is in `deleted`, `warned` and `timedOut`. */
  actions: LoggedAction[];
  /** Safe to show anyone. */
  reason: string | undefined;
  /** What matched. Taken from the member's message, so staff-facing posts only. */
  detail?: string | undefined;
  /** For banned words, each entry of the list that matched. Shown instead of `detail` when present. */
  matches?: string[] | undefined;
  timeoutMs: number | undefined;
  /** Whether the message is gone, whether or not this module is the one that removed it. */
  deleted: boolean;
  /** The rule asked for a warning and the case that carries it was recorded. */
  warned: boolean;
  timedOut: boolean;
  /** Things the rule asked for that did not happen. Fixed wording, never the message. */
  problems?: string[];
  /** The infraction written for this trip, once it exists. */
  caseNumber?: number | undefined;
  /** Where the dashboard is opened, so the log can link to the case. Empty when not known. */
  dashboardBase?: string | undefined;
  guildId?: string | undefined;
}

const ZERO_WIDTH_SPACE = "​";

/**
 * Text that came from a member must not be able to ping when it is repeated.
 * The notice's allowed mentions already stop it pinging anyone but the member,
 * and reasons are fixed wording, so this is one of several guards: a zero-width
 * space is enough to stop Discord reading a mention.
 */
export function breakMentions(text: string): string {
  return text
    .replace(/<([@#])/g, `<${ZERO_WIDTH_SPACE}$1`)
    .replace(/@(everyone|here)/gi, `@${ZERO_WIDTH_SPACE}$1`);
}

/** Inline code, so Discord neither turns the text into a link nor unfurls it. */
export function codeSpan(text: string): string {
  return `\`${breakMentions(text).replace(/[`\r\n]+/g, " ")}\``;
}

/** The values the notice in the channel is filled from. Nothing here is taken from the offending message. */
export function tripValues(facts: TripFacts, wording: AutomodWording = DEFAULT_AUTOMOD_WORDING): Record<string, string> {
  const reason = facts.reason ? breakMentions(facts.reason) : undefined;
  const timedOut = facts.timedOut && facts.timeoutMs !== undefined;
  return {
    user: `<@${facts.userId}>`,
    userId: facts.userId,
    rule: ruleName(facts.rule, wording),
    ruleKey: facts.rule,
    action: readableList(effectiveActions({ ...facts, timedOut }), wording.actionWords),
    reason: reason ?? wording.fragments.noReason,
    reasonNote: reason ? fill(wording.fragments.reasonNote, { reason }) : "",
    outcome: describeOutcome({ deleted: facts.deleted, warned: facts.warned, timedOut }, wording.outcomes),
    duration: timedOut && facts.timeoutMs ? describeLength(facts.timeoutMs, wording.time) : "",
  };
}

/** What a rule is called to members and in the log. A rule this version does not know keeps its key. */
export function ruleName(rule: string, wording: AutomodWording = DEFAULT_AUTOMOD_WORDING): string {
  return Object.hasOwn(wording.ruleNames, rule) ? wording.ruleNames[rule as keyof AutomodWording["ruleNames"]] : rule;
}

const MATCHES_SHOWN = 10;
const MATCH_LENGTH = 80;

/**
 * What matched, ready for staff-facing text: each banned word on its own, or
 * the single thing another rule found. Kept short enough for an embed field.
 */
export function matchText(facts: Pick<TripFacts, "detail" | "matches">, wording: AutomodWording = DEFAULT_AUTOMOD_WORDING): string {
  const matches = facts.matches ?? [];
  if (matches.length > 0) {
    const shown = matches.slice(0, MATCHES_SHOWN).map((match) => codeSpan(match.slice(0, MATCH_LENGTH)));
    const more = matches.length - shown.length;
    return more > 0 ? `${shown.join(", ")} ${fill(wording.fragments.matchesMore, { count: more })}` : shown.join(", ");
  }
  return facts.detail ? codeSpan(facts.detail) : "";
}

/** The values the log post is filled from: the notice's, plus what staff need to act on it. */
export function logValues(facts: TripFacts, wording: AutomodWording = DEFAULT_AUTOMOD_WORDING): Record<string, string> {
  const links = dashboardLinks(facts.dashboardBase ?? "", facts.guildId ?? "", facts.userId, facts.caseNumber);
  return {
    ...tripValues(facts, wording),
    match: matchText(facts, wording),
    case: facts.caseNumber === undefined ? "" : String(facts.caseNumber),
    caseUrl: facts.guildId ? links.caseUrl : "",
    memberUrl: facts.guildId ? links.memberUrl : "",
    problems: (facts.problems ?? []).join("\n"),
  };
}
