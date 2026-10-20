import { REPLY_COLOR, embedReply, emptyButton, emptyEmbed, plainReply, type MessageBody, type MessageVariable, type ResponseTemplate } from "@tier0/core";
import { viewCaseButton } from "@tier0/shared-moderation";
import { EVIDENCE_SAMPLE } from "./evidence-text.js";

/**
 * The messages the moderation module sends, as the dashboard offers them. Each
 * `starting` body is what the module sent before these were editable, so a
 * server that changes nothing sees no difference.
 */

const MEMBER: MessageVariable = { name: "member", description: "The member the action was taken on, as a mention", sample: "@spamlord_42" };
const MEMBER_ID: MessageVariable = { name: "memberId", description: "The member's user ID", sample: "123456789012345678" };
const MODERATOR: MessageVariable = { name: "moderator", description: "The moderator who took the action, as a mention", sample: "@Ada" };
const MODERATOR_ID: MessageVariable = { name: "moderatorId", description: "The moderator's user ID", sample: "234567890123456789" };
const ACTION: MessageVariable = { name: "action", description: "What was done, in lower case so it reads in a sentence: warned, timed out, kicked, banned, unbanned or timeout cleared", sample: "timed out" };
const ACTION_TITLE: MessageVariable = { name: "actionTitle", description: "The same, with a capital: Warned, Timed out, Kicked, Banned, Unbanned or Timeout cleared", sample: "Timed out" };
const REASON: MessageVariable = { name: "reason", description: "The reason given, or \"No reason given\"", sample: "Spamming links in #general" };
const REASON_NOTE: MessageVariable = {
  name: "reasonNote",
  description: "\" Reason: \" and the reason, with a space in front so it follows a sentence. Empty when no reason was given",
  sample: " Reason: Spamming links in #general",
};
const EXPIRES: MessageVariable = {
  name: "expires",
  description: "When a timeout or temporary ban ends, as a date and how long from now. Empty for anything that does not expire",
  sample: "Oct 18, 2026 4:12 PM (in 3 days)",
};
const EXPIRES_RELATIVE: MessageVariable = { name: "expiresRelative", description: "Only the \"how long from now\" part of the expiry. Empty when nothing expires", sample: "in 3 days" };
const EXPIRY_NOTE: MessageVariable = {
  name: "expiryNote",
  description: "\" This expires \" and the time, with a space in front and a full stop after. Empty when nothing expires",
  sample: " This expires in 3 days.",
};
const DURATION: MessageVariable = { name: "duration", description: "How long a timeout or temporary ban lasts. Empty when nothing expires", sample: "3 days" };
const CASE: MessageVariable = { name: "case", description: "The case number", sample: "118" };
const CASE_URL: MessageVariable = {
  name: "caseUrl",
  description: "A link that opens this case in the dashboard. Empty when the bot does not know the dashboard's address yet, which leaves a link button that uses it out of the post",
  sample: "https://bot.example.com/guilds/123456789012345678/mod/members/123456789012345678?case=118",
};
const MEMBER_URL: MessageVariable = {
  name: "memberUrl",
  description: "A link that opens the member's record in the dashboard. Empty when the bot does not know the dashboard's address yet",
  sample: "https://bot.example.com/guilds/123456789012345678/mod/members/123456789012345678",
};
const CREATED: MessageVariable = { name: "created", description: "When the case was made, for an embed's time", sample: "2026-10-15T16:12:00.000Z" };

const MODERATOR_NAME: MessageVariable = {
  name: "moderatorName",
  description: "The moderator's display name. Empty unless Show who took the action is on, and for an action the bot took by itself",
  sample: "Ada",
};
const EVIDENCE: MessageVariable = {
  name: "evidence",
  description: "The messages that led to the action, as the member wrote them, with where and when. Up to five, cut short, and unable to ping anyone. Empty when none were attached or Include the messages is off",
  sample: EVIDENCE_SAMPLE,
};
const EVIDENCE_TITLE: MessageVariable = { name: "evidenceTitle", description: "Message for one, Messages for several. Empty when there are none, so a field named with it is left out along with the messages", sample: "Message" };
const CASE_NOTE: MessageVariable = { name: "caseNote", description: "Case # and the number. Empty when the action has no case", sample: "Case #118" };
const CHANNEL: MessageVariable = { name: "channel", description: "The channel the first attached message was in, with a # in front. Empty when no message is attached", sample: "#general" };
const WHEN: MessageVariable = { name: "when", description: "When the action was taken, as a Discord date that shows in the reader's own time", sample: "<t:1792339920:f>" };
const WARNINGS: MessageVariable = { name: "warnings", description: "How many warnings count against the member, this one included. Empty for anything but a warning", sample: "3" };
const WARNING_NOTE: MessageVariable = {
  name: "warningNote",
  description: "A sentence such as This is warning 3, on a line of its own. Empty for anything but a warning, and for a first warning. It never says what happens at the next one",
  sample: " This is warning 3.",
};
const ESCALATION_RULE: MessageVariable = { name: "rule", description: "The name of the escalation rule that took the action. Empty for an action a moderator took", sample: "3 warnings in 30 days" };
const APPEAL_NOTE: MessageVariable = {
  name: "appealNote",
  description: "How to appeal, on a line of its own. Only for a ban while ban appeals are on, and empty otherwise",
  sample: " You can appeal this ban with the button below.",
};
const LIFTED_NOTE: MessageVariable = {
  name: "liftedNote",
  description: "A sentence saying the restriction was lifted, on a line of its own. Only for an unban or a cleared timeout, and empty otherwise",
  sample: " Your restriction in this server was lifted.",
};

export const DM_VARIABLES: MessageVariable[] = [
  ACTION,
  ACTION_TITLE,
  REASON,
  REASON_NOTE,
  EVIDENCE,
  EVIDENCE_TITLE,
  CASE,
  CASE_NOTE,
  CHANNEL,
  WHEN,
  CREATED,
  EXPIRES,
  EXPIRES_RELATIVE,
  EXPIRY_NOTE,
  DURATION,
  WARNINGS,
  WARNING_NOTE,
  ESCALATION_RULE,
  APPEAL_NOTE,
  LIFTED_NOTE,
  MODERATOR,
  MODERATOR_ID,
  MODERATOR_NAME,
];

/**
 * The direct message. Everything after the first sentence comes from a variable that is empty when it does not
 * apply, and a field with nothing in it is left out, so a warning, a timeout and a ban each show only what they have.
 */
export const DM_MESSAGE: MessageBody = {
  ...plainReply(""),
  embeds: [
    {
      ...emptyEmbed(),
      description: "You were {action} in {server}.{reasonNote}{expiryNote}{warningNote}{liftedNote}{appealNote}",
      color: REPLY_COLOR.warning,
      timestamp: "{created}",
      footerText: "{caseNote}",
      fields: [
        { name: "Length", value: "{duration}", inline: true },
        { name: "Moderator", value: "{moderatorName}", inline: true },
        { name: "{evidenceTitle}", value: "{evidence}", inline: false },
      ],
    },
  ],
};

/** The direct message before it carried the messages behind an action, for servers that saved it unchanged. */
export const DM_MESSAGE_BEFORE_CONTEXT: MessageBody = embedReply("You were {action} in {server}.{reasonNote}{expiryNote}", "warning");

export const DM_NOTE =
  "Sent to the member when a moderator takes an action, if direct messages are on. Everything is worded from {action}, so one message covers warnings, timeouts, kicks, bans and unbans. The messages that led to the action go in through {evidence}. A message saved before that was added does not show them until you add {evidence}, or a field named {evidenceTitle}, to it. The moderator's name is not shown unless Show who took the action is on or you add {moderator}. A member with direct messages closed does not get it.";

export const MODLOG_VARIABLES: MessageVariable[] = [
  CASE,
  ACTION,
  ACTION_TITLE,
  MEMBER,
  MEMBER_ID,
  MODERATOR,
  MODERATOR_ID,
  REASON,
  REASON_NOTE,
  EXPIRES,
  EXPIRES_RELATIVE,
  EXPIRY_NOTE,
  DURATION,
  CREATED,
  CASE_URL,
  MEMBER_URL,
];

/** Embed fields whose value comes out empty are left out, which is how the Expires line only shows for an action that expires. */
export const MODLOG_MESSAGE: MessageBody = {
  ...plainReply(""),
  embeds: [
    {
      ...emptyEmbed(),
      title: "Case #{case} - {actionTitle}",
      timestamp: "{created}",
      fields: [
        { name: "Member", value: "{member} ({memberId})", inline: true },
        { name: "Moderator", value: "{moderator} ({moderatorId})", inline: true },
        { name: "Reason", value: "{reason}", inline: false },
        { name: "Expires", value: "{expires}", inline: false },
      ],
    },
  ],
  // Left out of the post while the dashboard's address is not known.
  buttons: [viewCaseButton()],
};

export const MODLOG_NOTE =
  "Posted in the mod log channel for every action. A field whose variable comes out empty, such as Expires on a warning, is left out, and so is the View in dashboard button until the bot knows the dashboard's address (see Dashboard address).";

export const CASE_REPLY: ResponseTemplate = {
  starting: {
    ...MODLOG_MESSAGE,
    embeds: MODLOG_MESSAGE.embeds.map((embed) => ({
      ...embed,
      footerText: "{reversedNote}",
      fields: embed.fields.map((field) => (field.name === "Moderator" ? { ...field, value: "{moderatorLine}" } : field)),
    })),
  },
  placeholders: [
    ...MODLOG_VARIABLES,
    {
      name: "moderatorLine",
      description: "The moderator and their ID, or just \"Automod\" for a case a rule made",
      sample: "@Ada (234567890123456789)",
    },
    { name: "reversedNote", description: "\"This action has since been reversed.\" for a case that has been undone. Empty otherwise", sample: "This action has since been reversed." },
  ],
  note: "Shown to the moderator who looks a case up. Looking up a case that does not exist keeps its own reply.",
};

export const HISTORY_REPLY: ResponseTemplate = {
  starting: {
    ...plainReply(""),
    embeds: [{ ...emptyEmbed(), title: "Moderation history for {user}", description: "{list}" }],
  },
  placeholders: [
    { name: "user", description: "The member's username", sample: "spamlord_42" },
    { name: "count", description: "How many cases are listed. The 25 most recent are", sample: "3" },
    {
      name: "list",
      description: "One line per case, newest first, with its number, action, reason and date",
      sample: "**#118** Banned - Raiding - Oct 15\n**#97** Timed out (reversed) - Spam - Sep 2\n**#61** Warned - No reason given - Aug 11",
    },
  ],
  note: "Used when the member has a record. A member with no history keeps its own reply.",
};

export const PURGE_REPLY: ResponseTemplate = {
  starting: embedReply("Deleted {messages}.{skippedNote}", "success"),
  placeholders: [
    { name: "count", description: "How many messages were deleted", sample: "20" },
    { name: "messages", description: "The same with the word after it: \"1 message\" or \"20 messages\"", sample: "20 messages" },
    {
      name: "skippedNote",
      description: "A sentence about messages left because they are over 14 days old, with a space in front. Empty when none were",
      sample: " 2 messages were left because they are older than 14 days.",
    },
  ],
  note: "Used when messages were deleted. Nothing to delete, or a permissions problem, keeps its own reply.",
};

// -- raid tools ----------------------------------------------------------------

export const RAID_ALERT_VARIABLES: MessageVariable[] = [
  { name: "joins", description: "How many members joined", sample: "14" },
  { name: "seconds", description: "Over how many seconds", sample: "30" },
  { name: "lockdownNote", description: "A sentence saying the server was locked down, with a space in front. Empty when the alert does not lock anything", sample: " The server has been locked down." },
  { name: "dashboardUrl", description: "A link to the Raid tools tab. Empty when the bot does not know the dashboard's address yet", sample: "https://bot.example.com/guilds/123456789012345678/mod/raid" },
];

export const RAID_ALERT: MessageBody = {
  ...embedReply("{joins} members joined in {seconds} seconds.{lockdownNote}", "warning", { title: "Possible raid" }),
  buttons: [{ ...emptyButton(), label: "Open Raid tools", style: "link", url: "{dashboardUrl}" }],
};

export const LOCKDOWN_VARIABLES: MessageVariable[] = [
  { name: "reason", description: "The reason given for the lockdown, or \"No reason given\"", sample: "Raid in progress" },
  { name: "reasonNote", description: "\" Reason: \" and the reason, with a space in front. Empty when none was given", sample: " Reason: Raid in progress" },
];

export const LOCKDOWN_NOTICE: MessageBody = embedReply("This channel is locked for now. Members cannot send messages until staff unlock it.{reasonNote}", "warning");
export const UNLOCK_NOTICE: MessageBody = embedReply("This channel is unlocked again.", "success");

// -- appeals -------------------------------------------------------------------

const APPEAL_CASE: MessageVariable = { name: "case", description: "The ban's case number", sample: "118" };

export const APPEAL_POST_VARIABLES: MessageVariable[] = [
  { name: "member", description: "The member who appealed, as a mention", sample: "@spamlord_42" },
  { name: "memberId", description: "Their user ID", sample: "123456789012345678" },
  { name: "user", description: "Their username", sample: "spamlord_42" },
  APPEAL_CASE,
  { name: "appealUrl", description: "A link to the appeal on the Appeals tab. Empty when the bot does not know the dashboard's address yet", sample: "https://bot.example.com/guilds/123456789012345678/mod/appeals?appeal=7" },
];

export const APPEAL_POST: MessageBody = {
  ...embedReply("{member} ({memberId}) appealed their ban, case #{case}.", "info", { title: "New ban appeal" }),
  buttons: [{ ...emptyButton(), label: "Read the appeal", style: "link", url: "{appealUrl}" }],
};

export const APPEAL_DECISION_VARIABLES: MessageVariable[] = [
  APPEAL_CASE,
  { name: "response", description: "What staff wrote back, or empty when they wrote nothing", sample: "Welcome back. Keep it friendly in #general." },
  { name: "responseNote", description: "\" \" and what staff wrote back, so it follows a sentence. Empty when they wrote nothing", sample: " Welcome back. Keep it friendly in #general." },
  { name: "retryNote", description: "When the member may appeal again, as a sentence with a space in front. Empty when they may appeal again straight away", sample: " You can appeal again in 7 days." },
  { name: "reason", description: "The reason the member was banned for, or \"No reason given\"", sample: "Spamming links in #general" },
  EVIDENCE,
  EVIDENCE_TITLE,
  WHEN,
  CREATED,
];

export const APPEAL_ACCEPTED_DM: MessageBody = embedReply("Your appeal for case #{case} in {server} was accepted and the ban has been lifted.{responseNote}", "success");
export const APPEAL_DENIED_DM: MessageBody = {
  ...embedReply("Your appeal for case #{case} in {server} was denied.{responseNote}{retryNote}", "error"),
  embeds: [
    {
      ...emptyEmbed(),
      description: "Your appeal for case #{case} in {server} was denied.{responseNote}{retryNote}",
      color: REPLY_COLOR.error,
      timestamp: "{created}",
      fields: [
        { name: "Ban reason", value: "{reason}", inline: false },
        { name: "{evidenceTitle}", value: "{evidence}", inline: false },
      ],
    },
  ],
};

interface AppealReplySpec {
  label: string;
  help: string;
  starting: MessageBody;
  variables: MessageVariable[];
}

const UNTIL: MessageVariable = { name: "until", description: "When they may appeal again, as a Discord date", sample: "Oct 25, 4:12 PM" };

/** What the member is told in their direct messages after pressing the button or sending the form. */
export const APPEAL_REPLIES = {
  received: {
    label: "Appeal received",
    help: "After the member sends the form.",
    starting: embedReply("Your appeal for case #{case} was sent to the staff of {server}. You will get a message here when it is decided.", "success"),
    variables: [APPEAL_CASE],
  },
  alreadyOpen: {
    label: "An appeal is already open",
    help: "When the member presses the button while an earlier appeal for the same ban is still waiting.",
    starting: embedReply("You already have an appeal waiting for case #{case}. You will get a message here when it is decided.", "info"),
    variables: [APPEAL_CASE],
  },
  cooldown: {
    label: "Too soon after a denied appeal",
    help: "When the member appeals again before the wait after a denied appeal is over.",
    starting: embedReply("Your last appeal for case #{case} was denied. You can appeal again {until}.", "info"),
    variables: [APPEAL_CASE, UNTIL],
  },
  notBanned: {
    label: "The member is no longer banned",
    help: "When the ban was lifted or removed from the record before the member appealed.",
    starting: embedReply("Case #{case} is no longer a ban in force, so there is nothing to appeal.", "info"),
    variables: [APPEAL_CASE],
  },
  closed: {
    label: "Appeals are closed",
    help: "When the server has turned appeals off, or Moderation is off.",
    starting: embedReply("{server} is not taking ban appeals at the moment.", "info"),
    variables: [],
  },
  tooFast: {
    label: "Appealing too often",
    help: "When the member sends several appeals in a short time.",
    starting: embedReply("You have sent several appeals in a short time. Wait a while and try again.", "error"),
    variables: [],
  },
} satisfies Record<string, AppealReplySpec>;
