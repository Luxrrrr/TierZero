import { dashboardLinks, emptyEmbed, plainReply, viewCaseButton, type MessageBody, type MessageEmbed, type MessageVariable } from "@tier0/core";

/**
 * The two things automod says when a rule trips, as the dashboard offers them.
 * Each `starting` body is what automod sent before they were editable.
 *
 * What a member wrote never reaches the channel. The reason is fixed wording;
 * the invite code, address or banned word that matched goes only to the log and
 * the infraction, both of which staff read.
 */

export type LoggedAction = "warn" | "delete" | "timeout";

const USER: MessageVariable = { name: "user", description: "The member who tripped the rule, as a mention", sample: "@spamlord_42" };
const USER_ID: MessageVariable = { name: "userId", description: "The member's user ID", sample: "123456789012345678" };
const RULE: MessageVariable = { name: "rule", description: "The rule that tripped, as it is named in the settings", sample: "invites" };
const ACTION: MessageVariable = { name: "action", description: "What the rule does: delete, warn or timeout", sample: "delete" };
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
const PROBLEMS: MessageVariable = {
  name: "problems",
  description: "What the bot could not do, such as time the member out. Empty when everything it was set to do worked",
  sample: "Could not time out: missing permission",
};

export const NOTICE_VARIABLES: MessageVariable[] = [
  USER,
  USER_ID,
  RULE,
  ACTION,
  REASON,
  {
    name: "reasonNote",
    description: "A colon, a space and the reason. Empty when there is nothing to add",
    sample: ": Posted a Discord invite link",
  },
  {
    name: "outcome",
    description: "What actually happened, worded for the member: your message was removed, your message was removed and you were timed out, you were timed out, or that message tripped automod",
    sample: "your message was removed",
  },
  DURATION,
];

export const NOTICE_MESSAGE: MessageBody = plainReply("{user}, {outcome} ({rule}{reasonNote}).");

export const NOTICE_NOTE = "Posted in the channel where the message was, and removed again after 8 seconds. It can only mention the member it is about.";

export const LOG_VARIABLES: MessageVariable[] = [USER, USER_ID, RULE, ACTION, REASON, MATCH, PROBLEMS, DURATION, CASE, CASE_URL, MEMBER_URL];

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

const UNITS: readonly [string, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1_000],
];

/** "10 minutes", "2 hours": the largest unit that divides the length exactly. */
export function describeLength(ms: number): string {
  const whole = Math.max(1000, Math.round(ms / 1000) * 1000);
  for (const [name, size] of UNITS) {
    if (whole % size === 0) {
      const n = whole / size;
      return `${n} ${name}${n === 1 ? "" : "s"}`;
    }
  }
  return "1 second";
}

/** What the member is told, from what was done rather than from what the rule was set to do. */
export function describeOutcome(done: { deleted: boolean; timedOut: boolean }): string {
  if (done.deleted && done.timedOut) return "your message was removed and you were timed out";
  if (done.deleted) return "your message was removed";
  if (done.timedOut) return "you were timed out";
  return "that message tripped automod";
}

export interface TripFacts {
  userId: string;
  rule: string;
  /** What the rule is set to do, which picks the log post and its colour. */
  action: LoggedAction;
  /** Safe to show anyone. */
  reason: string | undefined;
  /** What matched. Taken from the member's message, so staff-facing posts only. */
  detail?: string | undefined;
  /** For banned words, each entry of the list that matched. Shown instead of `detail` when present. */
  matches?: string[] | undefined;
  timeoutMs: number | undefined;
  /** Whether the message is gone, whether or not this module is the one that removed it. */
  deleted: boolean;
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
export function tripValues(facts: TripFacts): Record<string, string> {
  const reason = facts.reason ? breakMentions(facts.reason) : undefined;
  const timedOut = facts.timedOut && facts.timeoutMs !== undefined;
  return {
    user: `<@${facts.userId}>`,
    userId: facts.userId,
    rule: facts.rule,
    action: facts.action,
    reason: reason ?? "-",
    reasonNote: reason ? `: ${reason}` : "",
    outcome: describeOutcome({ deleted: facts.deleted, timedOut }),
    duration: timedOut && facts.timeoutMs ? describeLength(facts.timeoutMs) : "",
  };
}

const MATCHES_SHOWN = 10;
const MATCH_LENGTH = 80;

/**
 * What matched, ready for staff-facing text: each banned word on its own, or
 * the single thing another rule found. Kept short enough for an embed field.
 */
export function matchText(facts: Pick<TripFacts, "detail" | "matches">): string {
  const matches = facts.matches ?? [];
  if (matches.length > 0) {
    const shown = matches.slice(0, MATCHES_SHOWN).map((match) => codeSpan(match.slice(0, MATCH_LENGTH)));
    const more = matches.length - shown.length;
    return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
  }
  return facts.detail ? codeSpan(facts.detail) : "";
}

/** The values the log post is filled from: the notice's, plus what staff need to act on it. */
export function logValues(facts: TripFacts): Record<string, string> {
  const links = dashboardLinks(facts.dashboardBase ?? "", facts.guildId ?? "", facts.userId, facts.caseNumber);
  return {
    ...tripValues(facts),
    match: matchText(facts),
    case: facts.caseNumber === undefined ? "" : String(facts.caseNumber),
    caseUrl: facts.guildId ? links.caseUrl : "",
    memberUrl: facts.guildId ? links.memberUrl : "",
    problems: (facts.problems ?? []).join("\n"),
  };
}
