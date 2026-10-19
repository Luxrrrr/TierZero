import { s, type Field, type FieldTopic, type Infer, type MessageBody } from "@tier0/core";
import {
  LFG_CLOSED,
  LFG_EXPIRED,
  LFG_FULL,
  LFG_POST,
  LFG_READY,
  LFG_REFUSALS,
  LFG_REPLIES,
  LFG_VARIABLES,
  ROOM_REFUSALS,
  ROOM_REPLIES,
  SIGNUP_CLOSED,
  SIGNUP_NOTICE_VARIABLES,
  SIGNUP_POST,
  SIGNUP_PROMOTED,
  SIGNUP_REFUSALS,
  SIGNUP_REPLIES,
  SIGNUP_REMINDER,
  SIGNUP_VARIABLES,
  type ReplyDefinition,
} from "./messages.js";
import { ROOM_NAME_MAX, ROOM_PLACEHOLDERS } from "./naming.js";

/**
 * Settings of the three features. Each has its own group with a switch, so a
 * server can run any of them alone. Every sentence the bot says is a message
 * setting, listed under "Replies and errors".
 */

const ZONES: [string, string][] = [
  ["UTC", "UTC"],
  ["America/Los_Angeles", "US Pacific (Los Angeles)"],
  ["America/Denver", "US Mountain (Denver)"],
  ["America/Chicago", "US Central (Chicago)"],
  ["America/New_York", "US Eastern (New York)"],
  ["America/Toronto", "Canada Eastern (Toronto)"],
  ["America/Mexico_City", "Mexico City"],
  ["America/Sao_Paulo", "Brazil (Sao Paulo)"],
  ["America/Argentina/Buenos_Aires", "Argentina (Buenos Aires)"],
  ["Europe/London", "UK (London)"],
  ["Europe/Dublin", "Ireland (Dublin)"],
  ["Europe/Lisbon", "Portugal (Lisbon)"],
  ["Europe/Paris", "Central Europe (Paris)"],
  ["Europe/Berlin", "Central Europe (Berlin)"],
  ["Europe/Madrid", "Spain (Madrid)"],
  ["Europe/Rome", "Italy (Rome)"],
  ["Europe/Stockholm", "Sweden (Stockholm)"],
  ["Europe/Athens", "Eastern Europe (Athens)"],
  ["Europe/Helsinki", "Finland (Helsinki)"],
  ["Europe/Istanbul", "Turkey (Istanbul)"],
  ["Europe/Moscow", "Russia (Moscow)"],
  ["Africa/Cairo", "Egypt (Cairo)"],
  ["Africa/Johannesburg", "South Africa (Johannesburg)"],
  ["Asia/Dubai", "Gulf (Dubai)"],
  ["Asia/Kolkata", "India (Kolkata)"],
  ["Asia/Bangkok", "Indochina (Bangkok)"],
  ["Asia/Singapore", "Singapore"],
  ["Asia/Shanghai", "China (Shanghai)"],
  ["Asia/Tokyo", "Japan (Tokyo)"],
  ["Asia/Seoul", "Korea (Seoul)"],
  ["Australia/Perth", "Australia West (Perth)"],
  ["Australia/Sydney", "Australia East (Sydney)"],
  ["Pacific/Auckland", "New Zealand (Auckland)"],
];

const TOPICS: FieldTopic[] = [
  { id: "rooms", label: "Voice rooms", help: "Replies to the /room commands. Only the person who ran the command sees them." },
  { id: "roomRefusals", label: "Voice room refusals", within: "rooms" },
  { id: "lfg", label: "Looking for group posts", help: "The post itself and what it turns into when the party fills, is closed or runs out of time." },
  { id: "lfgReplies", label: "Looking for group replies", help: "Replies to /lfg and to the buttons on a post. Only the person who pressed a button sees them." },
  { id: "lfgRefusals", label: "Looking for group refusals", within: "lfgReplies" },
  { id: "signups", label: "Sign-up posts and notices", help: "The sign-up itself, and the messages sent to the people on it." },
  { id: "signupReplies", label: "Sign-up replies", help: "Replies to the /signup commands and to the buttons. Only the person who used them sees them." },
  { id: "signupRefusals", label: "Sign-up refusals", within: "signupReplies" },
];

const LABEL_TOPICS: FieldTopic[] = [
  { id: "lfgLabels", label: "Looking for group" },
  { id: "signupLabels", label: "Sign-ups" },
  { id: "roomLabels", label: "Voice rooms" },
];

/** A message only its reader sees, shown compactly in the list. */
function reply(definition: ReplyDefinition, topic: string): Field<MessageBody> {
  return s.message({
    label: definition.label,
    help: definition.help,
    topic,
    audience: "private",
    note: "Only the person it is shown to sees this.",
    starting: definition.starting,
    variables: definition.variables,
    delivery: "dm",
    components: false,
    compact: true,
  });
}

function replies<T extends Record<string, ReplyDefinition>>(definitions: T, topic: string): { [K in keyof T]: Field<MessageBody> } {
  return Object.fromEntries(Object.entries(definitions).map(([key, definition]) => [key, reply(definition, topic)])) as {
    [K in keyof T]: Field<MessageBody>;
  };
}

const hubField = s.object({
  id: s.string({ generated: true }),
  channel: s.channel({
    types: ["voice"],
    label: "Hub channel",
    help: "Members who join this voice channel are given a room of their own and moved into it.",
  }),
  name: s.template({
    label: "Room name",
    help: "What each new room is called. {user} is the owner's name on the server.",
    default: "{user}'s room",
    max: ROOM_NAME_MAX,
    placeholders: ROOM_PLACEHOLDERS,
    samples: { user: "Ada", username: "ada", number: "2" },
  }),
  category: s.channel({
    types: ["category"],
    optional: true,
    label: "Category for new rooms",
    help: "Left empty, rooms are made in the hub's own category.",
  }),
  userLimit: s.integer({
    label: "User limit",
    help: "How many people a new room holds. 0 means no limit. The owner can change it with /room limit.",
    min: 0,
    max: 99,
    default: 0,
  }),
  bitrate: s.integer({
    label: "Bitrate in kbps",
    help: "Left empty, Discord's default is used. A value above what the server's boost level allows is lowered to the most it allows.",
    optional: true,
    min: 8,
    max: 384,
  }),
  ownerLeaves: s.choice({
    label: "When the owner leaves and others stay",
    options: [
      { value: "claim", label: "Anyone in the room can claim it", description: "Whoever runs /room claim first becomes the owner." },
      { value: "transfer", label: "Pass it to someone still in the room", description: "The room goes to someone still in it." },
      { value: "keep", label: "Keep the owner", description: "Nobody else can take it over. The owner can come back to it." },
    ],
    default: "claim",
  }),
});

const gameField = s.object({
  id: s.string({ generated: true }),
  name: s.string({ label: "Game", help: "Shown in the /lfg suggestions and on the post.", max: 60 }),
  emoji: s.emoji({ label: "Emoji", optional: true }),
  role: s.role({ label: "Role to ping", help: "Mentioned when a post for this game goes up. Left empty, nobody is.", optional: true }),
  channel: s.channel({
    types: ["text"],
    label: "Post in",
    help: "Left empty, posts go in the default channel above.",
    optional: true,
  }),
});

function labelField(label: string, value: string, topic: string, help?: string, max = 80): Field<string> {
  return s.string({ label, default: value, max, topic, ...(help ? { help } : {}) });
}

const labelsGroup = s.object(
  {
    lfgJoin: labelField("Join button", "Join", "lfgLabels", "On a looking-for-group post.", 80),
    lfgLeave: labelField("Leave button", "Leave", "lfgLabels", "On a looking-for-group post.", 80),
    lfgClose: labelField("Close button", "Close", "lfgLabels", "On a looking-for-group post.", 80),
    partyRoomName: s.template({
      label: "Name of the party's voice channel",
      help: "Used when a full party gets a voice channel of its own.",
      default: "{game} party",
      max: ROOM_NAME_MAX,
      placeholders: ["game", "author"],
      samples: { game: "Valorant", author: "Ada" },
      topic: "lfgLabels",
    }),
    signupJoin: labelField("Sign up button", "Sign up", "signupLabels", "On a sign-up post.", 80),
    signupLeave: labelField("Withdraw button", "Withdraw", "signupLabels", "On a sign-up post.", 80),
    formTitle: labelField("Team form title", "Register your team", "signupLabels", "Shown when a captain presses Sign up on a team sign-up. Discord allows 45 characters.", 45),
    teamNameLabel: labelField("Team name question", "Team name", "signupLabels", undefined, 45),
    teamNamePlaceholder: labelField("Team name hint", "Leave empty to go without a name", "signupLabels", undefined, 100),
    teammatesLabel: labelField("Teammates question", "Teammates", "signupLabels", undefined, 45),
    teammatesPlaceholder: labelField("Teammates hint", "Mention each teammate, or paste their user IDs", "signupLabels", undefined, 100),
    waitlistHeading: labelField("Waitlist heading in the exported list", "Waitlist", "signupLabels", "Used by /signup export.", 80),
    roomReason: s.template({
      label: "Audit log reason for a new room",
      help: "Shown in the server's audit log when the bot makes a room.",
      default: "Join-to-create room for {user}",
      max: 512,
      placeholders: ["user"],
      samples: { user: "Ada" },
      topic: "roomLabels",
    }),
    emptyReason: s.string({
      label: "Audit log reason when a room is removed",
      default: "Voice room is empty",
      max: 512,
      topic: "roomLabels",
    }),
  },
  {
    label: "Labels and text",
    help: "Button text and the short strings Discord limits. The longer messages are under Replies and errors.",
    section: "labels",
    layout: "fields",
    topics: LABEL_TOPICS,
  },
);

const PROMOTION_OPTIONS = [
  { value: "channel", label: "Ping them in the sign-up's channel" },
  { value: "dm", label: "Send them a direct message", description: "If their messages are closed, they are pinged in the channel instead." },
  { value: "both", label: "Both" },
];

export const settingsSchema = s.object({
  timeZone: s.choice({
    label: "Time zone for the times people type",
    help: "Used when someone writes a start time like 20:00 or 2026-11-02 19:30 in /lfg or /signup. Everyone reads the posted time in their own zone.",
    options: ZONES.map(([value, label]) => ({ value, label })),
    default: "UTC",
    section: "general",
  }),

  voice: s.object(
    {
      enabled: s.boolean({ label: "Make a voice channel for each member who joins a hub", default: false, guided: true }),
      hubs: s.array(hubField, {
        label: "Hub channels",
        help: "Each hub is a voice channel members join to get a room of their own. The room is deleted when the last person leaves.",
        item: "hub",
        max: 10,
        guided: true,
        when: { field: "enabled", equals: true },
      }),
      managerRoles: s.array(s.role(), {
        label: "Roles that can manage any room",
        help: "Members with one of these roles can run the /room commands in a room they do not own.",
        max: 10,
        when: { field: "enabled", equals: true },
      }),
    },
    { label: "Join-to-create voice channels", section: "joinToCreate" },
  ),

  lfg: s.object(
    {
      enabled: s.boolean({ label: "Let members post looking-for-group requests with /lfg", default: false, guided: true }),
      channel: s.channel({
        types: ["text"],
        label: "Default channel",
        help: "Where posts go for a game that has no channel of its own.",
        optional: true,
        guided: true,
        when: { field: "enabled", equals: true },
      }),
      games: s.array(gameField, {
        label: "Games",
        help: "The games /lfg offers. Members pick one as they type the command.",
        item: "game",
        max: 50,
        guided: true,
        when: { field: "enabled", equals: true },
      }),
      maxNeeded: s.integer({
        label: "Most players one post can ask for",
        help: "Besides the author. Discord's own limit for this command is 15.",
        min: 1,
        max: 15,
        default: 9,
        when: { field: "enabled", equals: true },
      }),
      expiresAfter: s.duration({
        label: "Close a post after",
        help: "Counted from the start time when the post gives one, and from when it was posted otherwise.",
        default: "2h",
        min: "10m",
        max: "7d",
        when: { field: "enabled", equals: true },
      }),
      cooldown: s.duration({
        label: "Wait between one member's posts",
        help: "0 turns the wait off.",
        default: "10m",
        max: "1d",
        when: { field: "enabled", equals: true },
      }),
      maxOpen: s.integer({
        label: "Open posts one member can have",
        min: 1,
        max: 5,
        default: 1,
        when: { field: "enabled", equals: true },
      }),
      pingParty: s.boolean({
        label: "Ping the party when it fills",
        help: "Posts the \"party is full\" message under the post with everyone mentioned.",
        default: true,
        when: { field: "enabled", equals: true },
      }),
      createVoice: s.boolean({
        label: "Make a voice channel for a full party",
        help: "The author owns it and can use the /room commands in it. It is deleted once it is empty.",
        default: false,
        when: { field: "enabled", equals: true },
      }),
      voiceCategory: s.channel({
        types: ["category"],
        label: "Category for party voice channels",
        optional: true,
        when: { field: "createVoice", equals: true },
      }),
    },
    { label: "Looking for group", section: "lookingForGroup" },
  ),

  signups: s.object(
    {
      enabled: s.boolean({ label: "Let staff run scrim and tournament sign-ups with /signup", default: false, guided: true }),
      channel: s.channel({
        types: ["text"],
        label: "Default channel",
        help: "Where /signup create posts when it is not told a channel. Left empty, it posts where it was run.",
        optional: true,
        when: { field: "enabled", equals: true },
      }),
      staffRoles: s.array(s.role(), {
        label: "Staff roles",
        help: "Members with one of these roles can run the /signup commands. Members who have Manage Events or Manage Server always can.",
        max: 10,
        when: { field: "enabled", equals: true },
      }),
      fullTeamsOnly: s.boolean({
        label: "Teams must be full",
        help: "A captain has to name every teammate to sign a team up. Off, a team can sign up short.",
        default: true,
        when: { field: "enabled", equals: true },
      }),
      remindBefore: s.duration({
        label: "Remind registered players before the start",
        help: "Pings everyone registered this long before a sign-up with a start time begins. 0 turns reminders off.",
        default: "30m",
        max: "7d",
        when: { field: "enabled", equals: true },
      }),
      promotion: s.choice({
        label: "Tell a waitlisted player when a place opens",
        options: PROMOTION_OPTIONS,
        default: "channel",
        when: { field: "enabled", equals: true },
      }),
    },
    { label: "Scrim and tournament sign-ups", section: "scrimSignups" },
  ),

  messages: s.object(
    {
      rooms: s.object(replies(ROOM_REPLIES, "rooms"), { label: "Voice rooms", topic: "rooms" }),
      roomRefusals: s.object(replies(ROOM_REFUSALS, "roomRefusals"), { label: "Voice room refusals", topic: "roomRefusals" }),
      lfgPost: lfgMessage("Looking for group post", "The post /lfg puts up, with the buttons under it. It is rewritten each time someone joins or leaves.", LFG_POST, true),
      lfgFull: lfgMessage("Party full", "What the post becomes when the last place is taken.", LFG_FULL, false),
      lfgReady: s.message({
        label: "Party full announcement",
        help: "Posted under the full post when it fills, if the party is to be pinged. Its mentions are real pings.",
        topic: "lfg",
        audience: "public",
        starting: LFG_READY,
        variables: LFG_VARIABLES,
        components: false,
      }),
      lfgClosed: lfgMessage("Post closed", "What the post becomes when its author or a moderator closes it.", LFG_CLOSED, false),
      lfgExpired: lfgMessage("Post expired", "What the post becomes when it runs out of time.", LFG_EXPIRED, false),
      lfgReplies: s.object(replies(LFG_REPLIES, "lfgReplies"), { label: "Looking for group replies", topic: "lfgReplies" }),
      lfgRefusals: s.object(replies(LFG_REFUSALS, "lfgRefusals"), { label: "Looking for group refusals", topic: "lfgRefusals" }),
      signupPost: s.message({
        label: "Sign-up post",
        help: "The post /signup create puts up, with the buttons under it. It is rewritten each time someone signs up or withdraws.",
        topic: "signups",
        audience: "public",
        starting: SIGNUP_POST,
        variables: SIGNUP_VARIABLES,
        components: false,
        attach: {
          kind: "buttons",
          buttons: [
            { name: "Sign up", label: "/labels.signupJoin", defaultStyle: "success" },
            { name: "Withdraw", label: "/labels.signupLeave", defaultStyle: "secondary" },
          ],
        },
      }),
      signupClosed: s.message({
        label: "Sign-up closed",
        help: "What the post becomes after /signup close.",
        topic: "signups",
        audience: "public",
        starting: SIGNUP_CLOSED,
        variables: SIGNUP_VARIABLES,
        components: false,
      }),
      signupPromoted: s.message({
        label: "Place opened up",
        help: "Sent to a waitlisted player or team when a place opens and they move up. Its mentions are real pings.",
        topic: "signups",
        audience: "public",
        starting: SIGNUP_PROMOTED,
        variables: SIGNUP_NOTICE_VARIABLES,
        components: false,
      }),
      signupReminder: s.message({
        label: "Reminder before the start",
        help: "Posted in the sign-up's channel shortly before it starts, if reminders are on. Its mentions are real pings.",
        topic: "signups",
        audience: "public",
        starting: SIGNUP_REMINDER,
        variables: SIGNUP_NOTICE_VARIABLES,
        components: false,
      }),
      signupReplies: s.object(replies(SIGNUP_REPLIES, "signupReplies"), { label: "Sign-up replies", topic: "signupReplies" }),
      signupRefusals: s.object(replies(SIGNUP_REFUSALS, "signupRefusals"), { label: "Sign-up refusals", topic: "signupRefusals" }),
    },
    {
      label: "Replies and errors",
      help: "Every message the bot sends for these features. Edit one to reword it.",
      section: "replies",
      layout: "messages",
      topics: TOPICS,
    },
  ),

  labels: labelsGroup,
});

function lfgMessage(label: string, help: string, starting: MessageBody, buttons: boolean): Field<MessageBody> {
  return s.message({
    label,
    help,
    topic: "lfg",
    audience: "public",
    starting,
    variables: LFG_VARIABLES,
    components: false,
    ...(buttons
      ? {
          attach: {
            kind: "buttons" as const,
            buttons: [
              { name: "Join", label: "/labels.lfgJoin", defaultStyle: "success" as const },
              { name: "Leave", label: "/labels.lfgLeave", defaultStyle: "secondary" as const },
              { name: "Close", label: "/labels.lfgClose", defaultStyle: "danger" as const },
            ],
          },
        }
      : {}),
  });
}

export type GamingSettings = Infer<typeof settingsSchema>;
export type HubSetting = GamingSettings["voice"]["hubs"][number];
export type GameSetting = GamingSettings["lfg"]["games"][number];
