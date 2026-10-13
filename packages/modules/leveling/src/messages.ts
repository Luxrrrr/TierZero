import { applyVariables, embedReply, emptyEmbed, plainReply, s, type Field, type MessageBody, type MessageVariable, type ReplyPlaceholder } from "@tier0/core";

/**
 * Everything /rank, /leaderboard and the level-up post say, in one place and free
 * of discord.js so the defaults can be tested without a client. The starting
 * bodies are what the commands answer with until the owner writes another.
 */

export const LEVEL_UP_MESSAGE = embedReply("Reached level {level}!", "info", { ping: "{user}" });

export const RANK_STARTING: MessageBody = {
  ...plainReply(""),
  embeds: [
    {
      ...emptyEmbed(),
      title: "{user} - Level {level}",
      thumbnailUrl: "{user.avatar}",
      fields: [
        { name: "Experience", value: "{xp} / {need}", inline: true },
        { name: "Rank", value: "{rank}", inline: true },
        { name: "Progress", value: "{progress}", inline: false },
      ],
    },
  ],
};

export const LEADERBOARD_STARTING: MessageBody = {
  ...plainReply(""),
  embeds: [{ ...emptyEmbed(), title: "{server} leaderboard", description: "{leaderboard}", footerText: "Page {page}" }],
};

export const RANK_PLACEHOLDERS: ReplyPlaceholder[] = [
  { name: "user", description: "The member's username", sample: "spamlord_42" },
  { name: "user.avatar", description: "The member's picture, for an image or thumbnail", sample: "" },
  { name: "level", description: "Their level", sample: "12" },
  { name: "xp", description: "Experience earned toward the next level", sample: "340" },
  { name: "need", description: "Experience needed for the next level", sample: "620" },
  { name: "rank", description: "Their place on the leaderboard", sample: "#7" },
  { name: "progress", description: "A bar showing how far through the level they are", sample: "▰▰▰▰▰▱▱▱▱▱" },
];

export const LEADERBOARD_PLACEHOLDERS: ReplyPlaceholder[] = [
  { name: "leaderboard", description: "The members on this page, one to a line", sample: "**1.** spamlord_42 - level 12 (4,020 xp)\n**2.** quillfeather - level 10 (3,110 xp)" },
  { name: "page", description: "Which page was asked for", sample: "1" },
];

export const DEFAULT_LABELS = {
  unranked: "Unranked",
  leaderboardLine: "**{position}.** {name} - level {level} ({xp} xp)",
} as const;

export const EMPTY_LEADERBOARD = embedReply("Nobody has earned experience here yet.", "info");
export const PAST_END_LEADERBOARD = embedReply("There is no page that far into the leaderboard.", "info");

const PAGE: MessageVariable = { name: "page", description: "The page that was asked for", sample: "4" };

export const REPLIES = {
  leaderboardEmpty: {
    label: "Leaderboard with nobody on it",
    help: "Shown for /leaderboard on the first page when no one has earned experience yet.",
    starting: EMPTY_LEADERBOARD,
    variables: [PAGE],
  },
  leaderboardPastEnd: {
    label: "Leaderboard page that does not exist",
    help: "Shown for /leaderboard when the page asked for is past the last one.",
    starting: PAST_END_LEADERBOARD,
    variables: [PAGE],
  },
};

export type ReplyKey = keyof typeof REPLIES;

export const replyField = (key: ReplyKey): Field<MessageBody> =>
  s.message({
    label: REPLIES[key].label,
    help: REPLIES[key].help,
    note: "Only the person who ran the command sees this.",
    starting: REPLIES[key].starting,
    variables: REPLIES[key].variables,
    delivery: "dm",
    components: false,
    compact: true,
  });

export const labelsGroup = s.object(
  {
    unranked: s.string({
      label: "Rank for a member with no experience",
      help: "Shown as the rank in /rank for someone who has not earned any yet.",
      default: DEFAULT_LABELS.unranked,
      max: 100,
    }),
    leaderboardLine: s.template({
      label: "Line for each member on the leaderboard",
      help: "One of these is written for every member on the page. {name} is their server nickname, or a mention when they have left.",
      default: DEFAULT_LABELS.leaderboardLine,
      placeholders: ["position", "name", "level", "xp"],
      max: 200,
    }),
  },
  {
    label: "Labels and text",
    help: "The words used inside /rank and /leaderboard.",
    collapsible: true,
  },
);

export function leaderboardLine(
  template: string,
  row: { position: number; name: string; level: number; xp: number },
): string {
  return applyVariables(template, {
    position: String(row.position),
    name: row.name,
    level: String(row.level),
    xp: String(row.xp),
  });
}
