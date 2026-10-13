import { embedReply, emptyEmbed, plainReply, s, type MessageBody, type ReplyPlaceholder } from "@tier0/core";

/**
 * What /ping, /serverinfo and /userinfo answer with until the owner writes
 * another reply. Free of discord.js so the defaults can be tested on their own.
 */

export const ACCENTS: Record<string, string> = {
  blurple: "#5865f2",
  grey: "#99aab5",
  green: "#57f287",
};

// A server can hold an accent from a choice list that has since changed, so
// this falls back instead of handing back nothing.
export const accentOf = (name: string): string => ACCENTS[name] ?? "#5865f2";

export const PING_STARTING: MessageBody = embedReply("Responding in {roundtrip}ms, gateway at {gateway}ms.", "info");

const embedOf = (fields: Partial<ReturnType<typeof emptyEmbed>>): MessageBody => ({
  ...plainReply(""),
  embeds: [{ ...emptyEmbed(), ...fields }],
});

/** The standard /serverinfo reply, in the server's chosen colour. */
export const serverinfoBody = (accent = "blurple"): MessageBody =>
  embedOf({
    title: "{server}",
    color: accentOf(accent),
    thumbnailUrl: "{server.icon}",
    fields: [
      { name: "Members", value: "{members}", inline: true },
      { name: "Channels", value: "{channels}", inline: true },
      { name: "Roles", value: "{roles}", inline: true },
      { name: "Created", value: "{created}", inline: false },
    ],
  });

/**
 * The standard /userinfo reply. "Joined server" is left out when the server has
 * turned it off.
 */
export const userinfoBody = (accent = "blurple", showJoinDate = true): MessageBody =>
  embedOf({
    title: "{user}",
    color: accentOf(accent),
    thumbnailUrl: "{user.avatar}",
    fields: [
      { name: "Account created", value: "{created}", inline: true },
      ...(showJoinDate ? [{ name: "Joined server", value: "{joined}", inline: true }] : []),
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

export const DEFAULT_LABELS = { unknown: "Unknown" } as const;

export const labelsGroup = s.object(
  {
    unknown: s.string({
      label: "When a join date is not known",
      help: "Fills {joined} in a /userinfo reply you wrote, for someone who is not in the server.",
      default: DEFAULT_LABELS.unknown,
      max: 100,
    }),
  },
  {
    label: "Labels and text",
    help: "Words used inside the information commands.",
    collapsible: true,
  },
);
