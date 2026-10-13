import { REPLY_COLOR, embedReply, emptyEmbed, plainReply, type MessageBody, type ReplyPlaceholder } from "@tier0/core";

/**
 * What /ping, /serverinfo and /userinfo answer with until the owner writes
 * another reply. Free of discord.js so the defaults can be tested on their own.
 */

export const PING_STARTING: MessageBody = embedReply("Responding in {roundtrip}ms, gateway at {gateway}ms.", "info");

const embedOf = (fields: Partial<ReturnType<typeof emptyEmbed>>): MessageBody => ({
  ...plainReply(""),
  embeds: [{ ...emptyEmbed(), ...fields }],
});

/** The standard /serverinfo reply. */
export const serverinfoBody = (): MessageBody =>
  embedOf({
    title: "{server}",
    color: REPLY_COLOR.info,
    thumbnailUrl: "{server.icon}",
    fields: [
      { name: "Members", value: "{members}", inline: true },
      { name: "Channels", value: "{channels}", inline: true },
      { name: "Roles", value: "{roles}", inline: true },
      { name: "Created", value: "{created}", inline: false },
    ],
  });

/** The standard /userinfo reply. An owner who does not want the join date deletes that field in the reply editor. */
export const userinfoBody = (): MessageBody =>
  embedOf({
    title: "{user}",
    color: REPLY_COLOR.info,
    thumbnailUrl: "{user.avatar}",
    fields: [
      { name: "Account created", value: "{created}", inline: true },
      { name: "Joined server", value: "{joined}", inline: true },
    ],
  });

export const PING_PLACEHOLDERS: ReplyPlaceholder[] = [
  { name: "roundtrip", description: "Milliseconds from your command to the bot", sample: "84" },
  { name: "gateway", description: "The bot's gateway latency in milliseconds", sample: "61" },
];

export const SERVERINFO_PLACEHOLDERS: ReplyPlaceholder[] = [
  { name: "channels", description: "How many channels the server has", sample: "34" },
  { name: "roles", description: "How many roles the server has", sample: "18" },
  { name: "created", description: "The day the server was created", sample: "March 3, 2021" },
];

export const USERINFO_PLACEHOLDERS: ReplyPlaceholder[] = [
  { name: "user", description: "The member's username", sample: "spamlord_42" },
  { name: "user.avatar", description: "The member's picture, for an image or thumbnail", sample: "" },
  { name: "created", description: "The day their account was created", sample: "June 9, 2019" },
  { name: "joined", description: "The day they joined this server, or Unknown when they are not in it", sample: "January 14, 2023" },
];

/** Shown for the join date of someone who is not in the server, in a reply an owner wrote. */
export const UNKNOWN = "Unknown";
