import { embedReply, emptyEmbed, plainReply, viewCaseButton, type MessageBody, type MessageVariable, type ResponseTemplate } from "@tier0/core";

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

export const DM_VARIABLES: MessageVariable[] = [ACTION, ACTION_TITLE, REASON, REASON_NOTE, EXPIRES, EXPIRES_RELATIVE, EXPIRY_NOTE, DURATION, MODERATOR, MODERATOR_ID];

export const DM_MESSAGE: MessageBody = embedReply("You were {action} in {server}.{reasonNote}{expiryNote}", "warning");

export const DM_NOTE =
  "Sent to the member when a moderator takes an action, if direct messages are on. Everything is worded from {action}, so one message covers warnings, timeouts, kicks, bans and unbans. The moderator's name is not shown unless you add {moderator}. A member with direct messages closed does not get it.";

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
