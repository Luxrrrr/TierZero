import { embedReply, plainReply, s, type Field, type MessageBody, type MessageVariable } from "@tier0/core";

/**
 * Everything verification says, with the wording it starts with. Free of
 * discord.js so it can be tested on its own.
 */

export const POST_MESSAGE: MessageBody = embedReply("Press the button below to verify yourself and get access to {server}.", "info", {
  title: "Verify to continue",
});

export const DM_MESSAGE: MessageBody = embedReply("Welcome to {server}. Press the button below to verify yourself and get access.", "info", {
  title: "Verify to continue",
});

export const ROUND_VARIABLES: MessageVariable[] = [
  { name: "round", description: "Which round this is", sample: "2" },
  { name: "rounds", description: "How many rounds there are", sample: "3" },
];

export const SHARED_VARIABLES: MessageVariable[] = [
  { name: "user", description: "The member, as a mention", sample: "@Ada" },
  { name: "username", description: "The member's name, without a mention", sample: "Ada" },
  { name: "server", description: "The server's name", sample: "Northwind" },
];

const ROLE_VARIABLE: MessageVariable = { name: "role", description: "The name of the verified role", sample: "Verified" };
const UNTIL_VARIABLE: MessageVariable = { name: "until", description: "When they may try again, as a time that counts down", sample: "in 10 minutes" };

export type ReplyKey =
  | "passed"
  | "alreadyVerified"
  | "notSetUp"
  | "roleTooHigh"
  | "roleFailed"
  | "tooYoung"
  | "roundPictures"
  | "roundCount"
  | "roundOdd"
  | "roundBelong"
  | "roundOrder"
  | "roundTyped"
  | "roundBlock"
  | "questionPrompt"
  | "wrongAnswer"
  | "codeExpired"
  | "lockedOut"
  | "removed"
  | "notAllowed"
  | "noChannel"
  | "postFailed"
  | "posted"
  | "updated"
  | "reverifySent"
  | "reverifyNoDm"
  | "reverifyFailed";

interface ReplyDefinition {
  label: string;
  help: string;
  starting: MessageBody;
  variables?: MessageVariable[];
  note?: string;
}

const LEFT_VARIABLE: MessageVariable = { name: "left", description: "How many tries they have left", sample: "2" };

export const REPLIES: Record<ReplyKey, ReplyDefinition> = {
  passed: {
    label: "Verified",
    help: "Shown to a member who passes the check and is given the verified role.",
    starting: embedReply("You are verified. Welcome to {server}!", "success"),
    variables: [ROLE_VARIABLE],
  },
  alreadyVerified: {
    label: "Already verified",
    help: "Shown to a member who presses the button while they already have the verified role.",
    starting: embedReply("You are already verified.", "info"),
    variables: [ROLE_VARIABLE],
  },
  notSetUp: {
    label: "Verification not set up",
    help: "Shown when the button is pressed but there is no verified role, or the question has no accepted answer.",
    starting: embedReply("Verification is not set up on this server yet. Ask a moderator.", "error"),
  },
  roleTooHigh: {
    label: "Role is above the bot",
    help: "Shown when the verified role sits above the bot's own highest role.",
    starting: embedReply("I can't give you **{role}** because that role sits above my own highest role. Ask an admin to move my role above it.", "error"),
    variables: [ROLE_VARIABLE],
  },
  roleFailed: {
    label: "Role could not be given",
    help: "Shown when Discord refuses to give the verified role, usually because the bot lacks Manage Roles.",
    starting: embedReply("I couldn't give you **{role}**. Ask an admin to check that I have Manage Roles.", "error"),
    variables: [ROLE_VARIABLE],
  },
  tooYoung: {
    label: "Account too new",
    help: "Shown to a member whose account is younger than the minimum age when they press the button.",
    starting: embedReply("Your account is too new to verify yet. Come back {canVerify}.", "error"),
    variables: [{ name: "canVerify", description: "When the account is old enough, as a time that counts down", sample: "in 3 days" }],
  },
  roundPictures: {
    label: "Round: press the picture",
    help: "Shown for a round where the member presses the button with the picture they are told. The buttons are added under it.",
    starting: embedReply("Press the {symbol} button.", "info", { title: "Round {round} of {rounds}" }),
    variables: [...ROUND_VARIABLES, { name: "symbol", description: "What to press, as its picture and name", sample: "🍎 apple" }],
  },
  roundCount: {
    label: "Round: count them",
    help: "Shown for a round where the member counts some pictures and presses the number.",
    starting: embedReply("How many are there?\n\n{row}", "info", { title: "Round {round} of {rounds}" }),
    variables: [...ROUND_VARIABLES, { name: "row", description: "The pictures to count", sample: "🍎 🍎 🍎 🍎" }],
  },
  roundOdd: {
    label: "Round: odd one out",
    help: "Shown for a round where one of the buttons is different from the rest.",
    starting: embedReply("Press the one that is different.", "info", { title: "Round {round} of {rounds}" }),
    variables: ROUND_VARIABLES,
  },
  roundBelong: {
    label: "Round: which does not belong",
    help: "Shown for a round where one of the buttons is not like the others.",
    starting: embedReply("Press the one that does not belong with the others.", "info", { title: "Round {round} of {rounds}" }),
    variables: ROUND_VARIABLES,
  },
  roundOrder: {
    label: "Round: smallest to biggest",
    help: "Shown for a round where the member presses three pictures from the smallest to the biggest.",
    starting: embedReply("Press these from the smallest to the biggest.", "info", { title: "Round {round} of {rounds}" }),
    variables: ROUND_VARIABLES,
  },
  roundTyped: {
    label: "Round: answer a puzzle",
    help: "Shown for a round with a small puzzle, such as a sum. The button that opens the box to answer in is added under it.",
    starting: embedReply("{question}\n\nPress the button below and type your answer.", "info", { title: "Round {round} of {rounds}" }),
    variables: [...ROUND_VARIABLES, { name: "question", description: "The puzzle, such as a sum", sample: "What is 7 + 5?" }],
  },
  roundBlock: {
    label: "Round: type the code",
    help: "Shown for a round with a code drawn in coloured squares. It is plain text, not an embed, so the squares are not wrapped.",
    starting: plainReply("**Round {round} of {rounds}.** Type the code you see.\n{grid}\nPress the button below and type it in."),
    variables: [...ROUND_VARIABLES, { name: "grid", description: "The code, drawn in squares", sample: "🟦⬛🟦\n🟦🟦🟦" }],
  },
  questionPrompt: {
    label: "Question to answer",
    help: "Shown when a member starts the question check. The button that opens the box to answer in is added under it.",
    starting: embedReply("{question}\n\nPress the button below to answer.", "info"),
    variables: [{ name: "question", description: "The question you set", sample: "What is the first rule?" }],
  },
  wrongAnswer: {
    label: "Wrong answer",
    help: "Shown when the answer, or the button pressed in the captcha, is wrong and they have tries left.",
    starting: embedReply("That is not right. You have {left} tries left. Press the verification button to start again.", "error"),
    variables: [LEFT_VARIABLE],
  },
  codeExpired: {
    label: "Check expired",
    help: "Shown when the captcha or question was issued too long ago, or the bot restarted since.",
    starting: embedReply("That check has expired. Press the verification button to start again.", "error"),
  },
  lockedOut: {
    label: "Locked out",
    help: "Shown when a member has used all their tries and is locked out for a while, and to anyone who presses the button during the lockout.",
    starting: embedReply("Too many wrong tries. You can try again {until}.", "error"),
    variables: [UNTIL_VARIABLE],
  },
  removed: {
    label: "Removed after too many tries",
    help: "Shown to a member who is removed from the server for using all their tries.",
    starting: embedReply("Too many wrong tries, so you were removed from the server. You can join again and try once more.", "error"),
  },
  notAllowed: {
    label: "Not allowed to post",
    help: "Shown to someone who runs /verification post or /verification send without Manage Server.",
    starting: embedReply("You need the Manage Server permission to use this command.", "error"),
  },
  noChannel: {
    label: "No channel chosen",
    help: "Shown when /verification post is run before a channel is picked on the dashboard.",
    starting: embedReply("Pick the channel for the verification message on the dashboard first.", "error"),
  },
  postFailed: {
    label: "Message could not be posted",
    help: "Shown when the verification message cannot be posted or updated, for example because the bot cannot see the channel.",
    starting: embedReply("I couldn't post the verification message. Check that I can send messages and embed links in that channel.", "error"),
  },
  posted: {
    label: "Message posted",
    help: "Shown to the moderator after /verification post puts the message in its channel.",
    starting: embedReply("Posted the verification message in {channel}.", "success"),
    variables: [{ name: "channel", description: "The channel it was posted in, as a link", sample: "#verify" }],
  },
  updated: {
    label: "Message updated",
    help: "Shown to the moderator after /verification post finds the message already there and edits it in place.",
    starting: embedReply("Updated the verification message in {channel}.", "success"),
    variables: [{ name: "channel", description: "The channel it is posted in, as a link", sample: "#verify" }],
  },
  reverifySent: {
    label: "Member sent to verify again",
    help: "Shown to the moderator after /verification send takes the member's verified role and messages them the button.",
    starting: embedReply("{target} has to verify again. I sent them the verification message.", "success"),
    variables: [{ name: "target", description: "The member who has to verify again, as a mention", sample: "@Ada" }],
  },
  reverifyNoDm: {
    label: "Member sent to verify again, no message",
    help: "Shown to the moderator when the member has to verify again but their direct messages are closed.",
    starting: embedReply("{target} has to verify again, but I couldn't message them. They can use the verification message in the channel.", "warning"),
    variables: [{ name: "target", description: "The member who has to verify again, as a mention", sample: "@Ada" }],
  },
  reverifyFailed: {
    label: "Member could not be sent to verify again",
    help: "Shown to the moderator when /verification send cannot change the member's roles, or the member is not on the server.",
    starting: embedReply("I couldn't make {target} verify again. Check that they are on the server and that my role is above the verified role.", "error"),
    variables: [{ name: "target", description: "The member, as a mention", sample: "@Ada" }],
  },
};

export const replyField = (key: ReplyKey): Field<MessageBody> =>
  s.message({
    label: REPLIES[key].label,
    help: REPLIES[key].help,
    note: REPLIES[key].note ?? "Only the person it is shown to sees this.",
    audience: "private",
    starting: REPLIES[key].starting,
    variables: [...SHARED_VARIABLES, ...(REPLIES[key].variables ?? [])],
    delivery: "dm",
    components: false,
    compact: true,
  });

export const KICKED_DM: MessageBody = embedReply("You were removed from {server}. Reason: {reason}. You are welcome to join again and verify.", "info");
export const RAID_STARTED: MessageBody = embedReply("Raid protection is on until {ends}. {joins} people joined in a short time.", "warning", { title: "Raid protection" });
export const RAID_ENDED: MessageBody = embedReply("Raid protection is off. The server is back to how it was.", "success", { title: "Raid protection" });
export const LOG_PASSED: MessageBody = embedReply("{user} passed verification ({method}).", "success");
export const LOG_FAILED: MessageBody = embedReply("{user} used all their tries and failed verification.", "warning");
export const LOG_KICKED: MessageBody = embedReply("{user} was removed. Reason: {reason}.", "warning");

export const REASON_VARIABLE: MessageVariable = { name: "reason", description: "Why they were removed", sample: "Did not verify in time" };
export const METHOD_VARIABLE: MessageVariable = { name: "method", description: "How they verified: button, captcha or question", sample: "captcha" };

export const LABELS = {
  verifyButton: "Verify",
  answerButton: "Answer",
  modalTitle: "Verification",
  answerLabel: "Your answer",
  reasonTimeout: "Did not verify in time",
  reasonYoung: "Account is too new",
  reasonAttempts: "Too many wrong verification attempts",
} as const;

export type ReasonKey = "reasonTimeout" | "reasonYoung" | "reasonAttempts";
