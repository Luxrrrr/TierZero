import {
  applyVariables,
  embedReply,
  emptyButton,
  emptyEmbed,
  plainReply,
  s,
  type Field,
  type MessageBody,
  type MessageButton,
  type MessageVariable,
  type ReplyPlaceholder,
} from "@tier0/core";

/**
 * Everything /rank, /leaderboard and the level-up post say, in one place and free
 * of discord.js so the defaults can be tested without a client. The starting
 * bodies are what the commands answer with until the owner writes another.
 */

export const LEVEL_UP_MESSAGE = embedReply("Reached level {level}!", "info", { ping: "{user}" });

/** Leads to the public leaderboard page. It is left out of the reply while `{leaderboard.url}` is empty. */
const PAGE_BUTTON: MessageButton = { ...emptyButton(), label: "Full leaderboard", style: "link", url: "{leaderboard.url}" };

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
  buttons: [PAGE_BUTTON],
};

export const LEADERBOARD_STARTING: MessageBody = {
  ...plainReply(""),
  embeds: [{ ...emptyEmbed(), title: "{server} leaderboard", description: "{leaderboard}", footerText: "Page {page}" }],
  buttons: [PAGE_BUTTON],
};

const PAGE_URL: ReplyPlaceholder = {
  name: "leaderboard.url",
  description: "The address of the public leaderboard page. Empty while the page is off or the dashboard has no address",
  sample: "https://bot.example.com/leaderboard/123",
};

export const RANK_PLACEHOLDERS: ReplyPlaceholder[] = [
  { name: "user", description: "The member's username", sample: "spamlord_42" },
  { name: "user.avatar", description: "The member's picture, for an image or thumbnail", sample: "" },
  { name: "level", description: "Their level", sample: "12" },
  { name: "xp", description: "Experience earned toward the next level", sample: "340" },
  { name: "need", description: "Experience needed for the next level", sample: "620" },
  { name: "rank", description: "Their place on the leaderboard", sample: "#7" },
  { name: "progress", description: "A bar showing how far through the level they are", sample: "▰▰▰▰▰▱▱▱▱▱" },
  PAGE_URL,
];

export const LEADERBOARD_PLACEHOLDERS: ReplyPlaceholder[] = [
  { name: "leaderboard", description: "The members on this page, one to a line", sample: "**1.** spamlord_42 - level 12 (4,020 xp)\n**2.** quillfeather - level 10 (3,110 xp)" },
  { name: "page", description: "Which page was asked for", sample: "1" },
  PAGE_URL,
];

export const DEFAULT_LABELS = {
  unranked: "Unranked",
  leaderboardLine: "**{position}.** {name} - level {level} ({xp} xp)",
} as const;

export const EMPTY_LEADERBOARD = embedReply("Nobody has earned experience here yet.", "info");
export const PAST_END_LEADERBOARD = embedReply("There is no page that far into the leaderboard.", "info");

const PAGE: MessageVariable = { name: "page", description: "The page that was asked for", sample: "4" };

export const XP_CHANGED = embedReply("{member} now has {xp} experience, level {level}.", "success");
export const XP_RESET = embedReply("{member}'s experience was reset to 0.", "success");
export const PRIVACY_HIDDEN = embedReply("You are left off the public leaderboard page. /rank and /leaderboard in Discord still show you.", "success");
export const PRIVACY_SHOWN = embedReply("You are shown on the public leaderboard page again.", "success");

const MEMBER: MessageVariable = { name: "member", description: "The member whose experience changed, as a mention", sample: "@spamlord_42" };
const XP_VARIABLES: MessageVariable[] = [
  MEMBER,
  { name: "xp", description: "Their experience now", sample: "4020" },
  { name: "level", description: "Their level now", sample: "8" },
];

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
  xpChanged: {
    label: "Experience changed by a moderator",
    help: "Shown after /xp give, /xp take or /xp set.",
    starting: XP_CHANGED,
    variables: XP_VARIABLES,
  },
  xpReset: {
    label: "Experience reset by a moderator",
    help: "Shown after /xp reset.",
    starting: XP_RESET,
    variables: [MEMBER],
  },
  privacyHidden: {
    label: "Member left off the public page",
    help: "Shown after /leaderboard-privacy with Hide me.",
    starting: PRIVACY_HIDDEN,
    variables: [],
  },
  privacyShown: {
    label: "Member shown on the public page again",
    help: "Shown after /leaderboard-privacy with Show me.",
    starting: PRIVACY_SHOWN,
    variables: [],
  },
};

const LAYOUT: Record<string, [group: string, key: string]> = {
  cooldown: ["earning", "cooldown"],
  noXpChannels: ["earning", "noXpChannels"],
  noXpRoles: ["earning", "noXpRoles"],
  multipliers: ["earning", "multipliers"],
  roleRewards: ["rewards", "roles"],
  stackRewards: ["rewards", "stack"],
};

/**
 * The earning and reward settings used to sit loose at the top. They are
 * grouped now, and a value saved in its old place is moved into its group,
 * unless the group already holds that setting.
 */
export function upgradeLayout(stored: Record<string, unknown>): Record<string, unknown> {
  if (!Object.keys(LAYOUT).some((key) => key in stored)) return stored;
  const next: Record<string, unknown> = { ...stored };
  for (const [old, [group, key]] of Object.entries(LAYOUT)) {
    if (!(old in next)) continue;
    const value = next[old];
    delete next[old];
    const holder = typeof next[group] === "object" && next[group] !== null ? { ...(next[group] as Record<string, unknown>) } : {};
    if (!(key in holder)) holder[key] = value;
    next[group] = holder;
  }
  return next;
}

/**
 * Announcements used to be on whenever a channel was set. They now say where
 * they go, so a group saved before that reads as "in that channel" when it had
 * one and "off" when it did not.
 */
export function upgradeAnnounce(stored: Record<string, unknown>): Record<string, unknown> {
  if (typeof stored.where === "string") return stored;
  const channel = typeof stored.channel === "string" && stored.channel !== "";
  return { ...stored, where: channel ? "channel" : "off" };
}

export type ReplyKey = keyof typeof REPLIES;

export const replyField = (key: ReplyKey): Field<MessageBody> =>
  s.message({
    label: REPLIES[key].label,
    help: REPLIES[key].help,
    note: "Only the person who ran the command sees this.",
    audience: "private",
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
