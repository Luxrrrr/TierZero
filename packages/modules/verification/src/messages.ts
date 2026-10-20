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
  | "roundText"
  | "roundColour"
  | "roundMotion"
  | "roundTiles"
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
  roundText: {
    label: "Round: type the characters",
    help: "Shown for a round with a picture of bent characters. The picture and the button that opens the box to answer in are added under it.",
    starting: embedReply("Type the characters in the picture.\n\nPress the button below to type them in.", "info", { title: "Round {round} of {rounds}" }),
    variables: ROUND_VARIABLES,
  },
  roundColour: {
    label: "Round: type one colour",
    help: "Shown for a round with a picture of characters in several colours, where only one colour is typed. The picture and the button that opens the box to answer in are added under it.",
    starting: embedReply("Type only the **{colour}** characters in the picture, from left to right.\n\nPress the button below to type them in.", "info", {
      title: "Round {round} of {rounds}",
    }),
    variables: [...ROUND_VARIABLES, { name: "colour", description: "The colour to type", sample: "red" }],
  },
  roundMotion: {
    label: "Round: type the moving characters",
    help: "Shown for a round where the characters only show while the picture moves. The picture and the button that opens the box to answer in are added under it.",
    starting: embedReply("Type the characters that move in the picture.\n\nIf it looks still, press the picture so it plays. Then press the button below to type them in.", "info", {
      title: "Round {round} of {rounds}",
    }),
    variables: ROUND_VARIABLES,
  },
  roundTiles: {
    label: "Round: press the squares",
    help: "Shown for a round with a picture of nine squares, where the member presses the numbers of the squares that have one shape, then Done. The picture and the buttons are added under it.",
    starting: embedReply("Press every square that has a **{shape}**, then press Done.", "info", { title: "Round {round} of {rounds}" }),
    variables: [...ROUND_VARIABLES, { name: "shape", description: "The shape to look for", sample: "star" }],
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
export const LOG_PASSED: MessageBody = embedReply("{user} passed verification ({method}).{risk}", "success");
export const LOG_FAILED: MessageBody = embedReply("{user} used all their tries and failed verification.{risk}", "warning");
export const LOG_KICKED: MessageBody = embedReply("{user} was removed. Reason: {reason}.{risk}", "warning");

export const REASON_VARIABLE: MessageVariable = { name: "reason", description: "Why they were removed", sample: "Did not verify in time" };
export const RISK_VARIABLE: MessageVariable = {
  name: "risk",
  description: "How risky the account looked when it joined, with the reasons. Empty for an ordinary account",
  sample: "\nRisk: **high**: account is 1 day old, no profile picture.",
};
export const METHOD_VARIABLE: MessageVariable = { name: "method", description: "How they verified: button, captcha or question", sample: "captcha" };

export const LABELS = {
  verifyButton: "Verify",
  answerButton: "Answer",
  doneButton: "Done",
  modalTitle: "Verification",
  answerLabel: "Your answer",
  reasonTimeout: "Did not verify in time",
  reasonYoung: "Account is too new",
  reasonAttempts: "Too many wrong verification attempts",
  reasonRisk: "Looked like part of a raid",
} as const;

export type ReasonKey = "reasonTimeout" | "reasonYoung" | "reasonAttempts" | "reasonRisk";
