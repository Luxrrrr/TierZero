import { s, type Field, type FieldTopic, type Infer, type MessageBody } from "@tier0/core";
import {
  GROUP_ANNOUNCEMENT,
  GROUP_ANNOUNCEMENT_VARIABLES,
  GROUP_CLOSED,
  GROUP_CONTROLS,
  GROUP_PANEL,
  GROUP_PANEL_VARIABLES,
  GROUP_REFUSALS,
  GROUP_REPLIES,
  GROUP_VARIABLES,
  LFG_CLOSED,
  LFG_EXPIRED,
  LFG_FULL,
  LFG_PANEL,
  LFG_PANEL_VARIABLES,
  LFG_POST,
  LFG_READY,
  LFG_GO,
  LFG_STARTED,
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
import { GROUP_PLACEHOLDERS } from "./group-logic.js";
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
  { id: "groups", label: "Group controls", help: "The message in each group's thread and what it becomes when the group ends." },
  { id: "groupReplies", label: "Group replies", help: "What a member is told as they start a group. Only the person who pressed the option sees them." },
  { id: "groupRefusals", label: "Group refusals", within: "groupReplies" },
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
    preview: "channel",
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

const lfgPanelField = s.object({
  id: s.string({ generated: true }),
  name: s.string({ label: "Panel name", help: "Only you see this. It is also {panel} in the message.", max: 100 }),
  channel: s.channel({
    types: ["text"],
    label: "Channel to post in",
    help: "The panel is posted here. Requests it makes go to the game's own channel, else the default channel above, else here.",
  }),
  message: s.message({
    label: "Panel message",
    note: "The button is added under this message for you.",
    starting: LFG_PANEL,
    variables: LFG_PANEL_VARIABLES,
    components: false,
    attach: {
      kind: "buttons",
      buttons: [{ name: "Find players", label: "/lfg.labels.lfgRequest", defaultStyle: "success" }],
    },
  }),
});

function labelField(label: string, value: string, help?: string, max = 80): Field<string> {
  return s.string({ label, default: value, max, ...(help ? { help } : {}) });
}

const lfgLabels = s.object(
  {
    lfgJoin: labelField("Join button", "Join", "On a looking-for-group post.", 80),
    lfgLeave: labelField("Leave button", "Leave", "On a looking-for-group post.", 80),
    lfgStart: labelField("Start group button", "Start group", "On a looking-for-group post. The author uses it to start before the party is full.", 80),
    lfgClose: labelField("Close button", "Close", "On a looking-for-group post.", 80),
    lfgRequest: labelField("Panel button", "Find players", "On a looking-for-group panel.", 80),
    lfgFormTitle: labelField("Request form title", "Look for a group", "Discord allows 45 characters.", 45),
    lfgFormGame: labelField("Game question", "Game", undefined, 45),
    lfgFormPlayers: labelField("Players question", "Players you still need", undefined, 45),
    lfgFormNote: labelField("Note question", "Note (optional)", undefined, 45),
    lfgFormWhen: labelField("Start time question", "When (empty for now)", undefined, 45),
    partyRoomName: s.template({
      label: "Name of the party's voice channel",
      help: "Used when a full party gets a voice channel of its own.",
      default: "{game} party",
      max: ROOM_NAME_MAX,
      placeholders: ["game", "author"],
      samples: { game: "Valorant", author: "Ada" },
    }),
  },
  {
    label: "Labels and text",
    help: "Button text, form questions and the party room name. The longer messages are under Replies and errors.",
  },
);

const signupLabels = s.object(
  {
    signupJoin: labelField("Sign up button", "Sign up", "On a sign-up post.", 80),
    signupLeave: labelField("Withdraw button", "Withdraw", "On a sign-up post.", 80),
    formTitle: labelField("Team form title", "Register your team", "Shown when a captain presses Sign up on a team sign-up. Discord allows 45 characters.", 45),
    teamNameLabel: labelField("Team name question", "Team name", undefined, 45),
    teamNamePlaceholder: labelField("Team name hint", "Leave empty to go without a name", undefined, 100),
    teammatesLabel: labelField("Teammates question", "Teammates", undefined, 45),
    teammatesPlaceholder: labelField("Teammates hint", "Mention each teammate, or paste their user IDs", undefined, 100),
    waitlistHeading: labelField("Waitlist heading in the exported list", "Waitlist", "Used by /signup export.", 80),
  },
  {
    label: "Labels and text",
    help: "Button text and the team form. The longer messages are under Replies and errors.",
  },
);

const voiceLabels = s.object(
  {
    roomReason: s.template({
      label: "Audit log reason for a new room",
      help: "Shown in the server's audit log when the bot makes a room.",
      default: "Join-to-create room for {user}",
      max: 512,
      placeholders: ["user"],
      samples: { user: "Ada" },
    }),
    emptyReason: s.string({
      label: "Audit log reason when a room is removed",
      default: "Voice room is empty",
      max: 512,
    }),
  },
  {
    label: "Labels and text",
    help: "The reasons shown in the server's audit log. The longer messages are under Replies and errors.",
  },
);

const groupLabels = s.object(
  {
    groupMakePrivate: labelField("Make private button", "Make private", "In a group's thread. Shown while the group is open.", 80),
    groupMakeOpen: labelField("Make open button", "Make open", "In a group's thread. Shown while the group is private.", 80),
    groupRename: labelField("Rename button", "Rename", "In a group's thread.", 80),
    groupGame: labelField("Change game button", "Change game", "In a group's thread.", 80),
    groupGameTitle: labelField("Game form title", "What are you playing?", "Discord allows 45 characters.", 45),
    groupGameLabel: labelField("Game form question", "Game", undefined, 45),
    groupLimit: labelField("Limit button", "Set limit", "In a group's thread.", 80),
    groupClose: labelField("End group button", "End group", "In a group's thread.", 80),
    groupInvite: labelField("Invite menu text", "Invite someone", "The grey text in the menu that lets someone into the group.", 100),
    groupRemove: labelField("Remove menu text", "Remove someone", "The grey text in the menu that removes someone from the group.", 100),
    groupHandOver: labelField("Hand over menu text", "Hand the group to someone", "The grey text in the menu that gives the group to someone else.", 100),
    groupModeOpen: labelField("Open", "Open", "What \"Who can join\" says while the group is open.", 40),
    groupModePrivate: labelField("Private", "Private", "What \"Who can join\" says while the group is private.", 40),
    groupNoLimit: labelField("No limit", "No limit", "What \"Limit\" says when the voice channel has none.", 40),
    groupRenameTitle: labelField("Rename form title", "Rename the group", "Discord allows 45 characters.", 45),
    groupRenameLabel: labelField("Rename form question", "New name", undefined, 45),
    groupLimitTitle: labelField("Limit form title", "Set the limit", "Discord allows 45 characters.", 45),
    groupJoin: labelField("Join button", "Join", "On a group's announcement.", 80),
    groupLeave: labelField("Leave button", "Leave", "On a group's announcement.", 80),
    groupLimitLabel: labelField("Limit form question", "People allowed (0 for no limit)", undefined, 45),
    groupReason: s.template({
      label: "Audit log reason for a new group",
      help: "Shown in the server's audit log when the bot makes a group's voice channel.",
      default: "Group for {user}",
      max: 512,
      placeholders: ["user"],
      samples: { user: "Ada" },
    }),
    groupEndReason: s.string({
      label: "Audit log reason when a group ends",
      default: "Group has ended",
      max: 512,
    }),
  },
  {
    label: "Labels and text",
    help: "Button text, form questions, menu text and the audit log reasons. The longer messages are under Replies and errors.",
  },
);

const PROMOTION_OPTIONS = [
  { value: "channel", label: "Ping them in the sign-up's channel" },
  { value: "dm", label: "Send them a direct message", description: "If their messages are closed, they are pinged in the channel instead." },
  { value: "both", label: "Both" },
];

const BUTTON_COLOURS = [
  { value: "secondary", label: "Grey", swatch: "#4e5058" },
  { value: "primary", label: "Blurple", swatch: "#5865f2" },
  { value: "success", label: "Green", swatch: "#248046" },
  { value: "danger", label: "Red", swatch: "#da373c" },
];

const groupOptionField = s.object({
  id: s.string({ generated: true }),
  label: s.string({ label: "Button text", help: "What members read on the button, such as Looking for group.", max: 80 }),
  emoji: s.emoji({ label: "Emoji", optional: true }),
  style: s.choice({ label: "Button colour", options: BUTTON_COLOURS, default: "secondary" }),
  privacy: s.choice({
    label: "Who can join",
    options: [
      { value: "open", label: "Open", description: "Anyone who can see the voice channel can join it. The owner can make it private later." },
      { value: "private", label: "Private", description: "The voice channel is locked. Only people the owner invites can join. The owner can open it later." },
    ],
    control: "segmented",
    default: "open",
  }),
  userLimit: s.integer({ label: "Size limit", help: "How many people the voice channel holds. 0 means no limit. The owner can change it from the thread.", min: 0, max: 99, default: 0 }),
  name: s.template({
    label: "Group name",
    help: "What the voice channel and the thread are called. {user} is the owner's name on the server.",
    default: "{user}'s group",
    max: ROOM_NAME_MAX,
    placeholders: GROUP_PLACEHOLDERS,
    samples: { user: "Ada", username: "ada", game: "Valorant", number: "2" },
    preview: "channel",
  }),
  game: s.string({
    label: "Game",
    help: "Optional. Added to the end of the group's name unless the name uses {game} itself. Also available in the messages. When members are asked, this is what the form starts with.",
    optional: true,
    max: 60,
  }),
  askGame: s.boolean({
    label: "Ask what they are playing",
    help: "A form asks for the game when a member presses the button. The owner can change it later from the thread.",
    default: true,
  }),
  announceMode: s.choice({
    label: "Announce in the panel's channel",
    help: "Whether this option's groups get a post with a Join button while they are open. It applies whenever a group is open, including a private one that is opened later.",
    options: [
      { value: "panel", label: "Follow the panel", description: "Announces if the panel is set to announce." },
      { value: "always", label: "Always", description: "Announces whatever the panel says." },
      { value: "never", label: "Never", description: "Never announces, whatever the panel says." },
    ],
    control: "segmented",
    default: "panel",
  }),
  pingRole: s.role({
    label: "Role to ping when announced",
    help: "Left empty, the panel's role is pinged, and if the panel has none, nobody is.",
    optional: true,
  }),
  category: s.channel({
    types: ["category"],
    optional: true,
    label: "Category for voice channels",
    help: "Left empty, the panel's category is used, and then the panel channel's own.",
  }),
});

const groupPanelField = s.object({
  id: s.string({ generated: true }),
  name: s.string({ label: "Panel name", help: "Only you see this. It is also {panel} in the message.", max: 100 }),
  channel: s.channel({
    types: ["text"],
    label: "Channel to post in",
    help: "The panel is posted here, and each group's thread is made under it. Members need to see it.",
  }),
  message: s.message({
    label: "Panel message",
    note: "The option buttons are added under this message for you.",
    starting: GROUP_PANEL,
    variables: GROUP_PANEL_VARIABLES,
    components: false,
    attach: {
      kind: "list",
      list: "options",
      label: "label",
      emoji: "emoji",
      style: "style",
      noun: "option",
    },
  }),
  category: s.channel({
    types: ["category"],
    optional: true,
    label: "Category for voice channels",
    help: "Used by options that name no category of their own. Left empty, the panel channel's category is used.",
  }),
  announce: s.boolean({
    label: "Announce open groups",
    help: "While a group is open and has room, a post in the panel's channel lets other members press Join to be added to its thread and moved into the voice channel. It is removed when the group is made private or ends, and comes back if a private group is opened. Each option can follow this, always announce or never announce.",
    default: false,
  }),
  pingRole: s.role({
    label: "Role to ping when a group is announced",
    help: "Pinged once, when the post first goes up. Left empty, nobody is. An option can ping a different role.",
    optional: true,
    when: { field: "announce", equals: true },
  }),
  options: s.array(groupOptionField, {
    label: "Options",
    help: "One button each. Every option starts a group the way it says here.",
    item: "option",
    min: 1,
    max: 15,
    layout: "sheet",
    card: { emoji: "emoji", swatch: "style", facts: ["privacy", "userLimit"] },
  }),
});

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
        layout: "sheet",
        card: { facts: ["userLimit", "ownerLeaves"] },
        guided: true,
      }),
      managerRoles: s.array(s.role(), {
        label: "Roles that can manage any room",
        help: "Members with one of these roles can run the /room commands in a room they do not own.",
        max: 10,
      }),
      labels: voiceLabels,
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
      }),
      restrictGames: s.boolean({
        label: "Only allow the games on the list",
        help: "Off, members can ask for players for any game by typing its name. On, only the games below can be chosen.",
        default: false,
      }),
      games: s.array(gameField, {
        label: "Games",
        help: "Optional. A game listed here is suggested as members type and can have an emoji, a role to ping and a channel of its own. Members can name other games unless the box above is on.",
        item: "game",
        max: 50,
        layout: "sheet",
        card: { emoji: "emoji" },
      }),
      panels: s.array(lfgPanelField, {
        label: "Panels",
        help: "A message with a button that asks for players without typing /lfg. Post it from here.",
        item: "panel",
        max: 5,
      }),
      maxNeeded: s.integer({
        label: "Most players one post can ask for",
        help: "Besides the author. Discord's own limit for this command is 15.",
        min: 1,
        max: 15,
        default: 9,
      }),
      expiresAfter: s.duration({
        label: "Close a post after",
        help: "Counted from the start time when the post gives one, and from when it was posted otherwise.",
        default: "2h",
        min: "10m",
        max: "7d",
      }),
      cooldown: s.duration({
        label: "Wait between one member's posts",
        help: "0 turns the wait off.",
        default: "10m",
        max: "1d",
      }),
      maxOpen: s.integer({
        label: "Open posts one member can have",
        min: 1,
        max: 5,
        default: 1,
      }),
      pingParty: s.boolean({
        label: "Ping the party when it fills",
        help: "Posts the \"party is full\" message under the post and pings only the players in the party. It never uses @everyone or @here.",
        default: true,
      }),
      createVoice: s.boolean({
        label: "Make a voice channel for a full party",
        help: "The author owns it and can use the /room commands in it. It is deleted once it is empty.",
        default: false,
      }),
      voiceCategory: s.channel({
        types: ["category"],
        label: "Category for party voice channels",
        optional: true,
        when: { field: "createVoice", equals: true },
      }),
      labels: lfgLabels,
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
      }),
      staffRoles: s.array(s.role(), {
        label: "Staff roles",
        help: "Members with one of these roles can run the /signup commands. Members who have Manage Events or Manage Server always can.",
        max: 10,
      }),
      fullTeamsOnly: s.boolean({
        label: "Teams must be full",
        help: "A captain has to name every teammate to sign a team up. Off, a team can sign up short.",
        default: true,
      }),
      remindBefore: s.duration({
        label: "Remind registered players before the start",
        help: "Pings everyone registered this long before a sign-up with a start time begins. 0 turns reminders off.",
        default: "30m",
        max: "7d",
      }),
      promotion: s.choice({
        label: "Tell a waitlisted player when a place opens",
        options: PROMOTION_OPTIONS,
        default: "channel",
      }),
      labels: signupLabels,
    },
    { label: "Scrim and tournament sign-ups", section: "scrimSignups" },
  ),

  groups: s.object(
    {
      enabled: s.boolean({ label: "Let members start groups from a panel", default: false, guided: true }),
      joinTime: s.duration({
        label: "Time to join the new voice channel",
        help: "A member who presses an option while they are not in a voice channel gets a countdown for this long. If they have not joined by then, the voice channel is removed. Anyone already in a voice channel is moved at once.",
        default: "1m",
        min: "15s",
        max: "10m",
      }),
      managerRoles: s.array(s.role(), {
        label: "Roles that can manage any group",
        help: "Besides the person who started a group, members with one of these roles can use its controls. Members with Manage Channels, Manage Server or Administrator always can.",
        max: 10,
      }),
      panels: s.array(groupPanelField, {
        label: "Panels",
        help: "A panel is a message with a button for each option. Post it from its row with Post in Discord. Changes reach a posted panel the next time you post it.",
        item: "panel",
        max: 10,
        guided: true,
      }),
      labels: groupLabels,
    },
    { label: "Group hubs", section: "groupHubs" },
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
      lfgStarted: lfgMessage("Group started", "What the post becomes when its author starts the group before the party is full.", LFG_STARTED, false),
      lfgGo: s.message({
        label: "Group started announcement",
        help: "Posted under the post when the author starts the group, if the party is to be pinged. Its mentions are real pings.",
        topic: "lfg",
        audience: "public",
        starting: LFG_GO,
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
            { name: "Sign up", label: "/signups.labels.signupJoin", defaultStyle: "success" },
            { name: "Withdraw", label: "/signups.labels.signupLeave", defaultStyle: "secondary" },
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
      groupControls: groupMessage("Group controls", "The first message in a group's thread, with the buttons and menus under it. It is rewritten when the group changes.", GROUP_CONTROLS, "controls"),
      groupAnnouncement: groupMessage("Group announcement", "The post that tells others a group has room, with Join and Leave under it. It is rewritten as people come and go.", GROUP_ANNOUNCEMENT, "announcement"),
      groupClosed: groupMessage("Group ended", "What the controls message becomes when the group ends.", GROUP_CLOSED, "closed"),
      groupReplies: s.object(replies(GROUP_REPLIES, "groupReplies"), { label: "Group replies", topic: "groupReplies" }),
      groupRefusals: s.object(replies(GROUP_REFUSALS, "groupRefusals"), { label: "Group refusals", topic: "groupRefusals" }),
    },
    {
      label: "Replies and errors",
      help: "Every message the bot sends for these features. Edit one to reword it.",
      section: "replies",
      layout: "messages",
      topics: TOPICS,
    },
  ),

});

function groupMessage(label: string, help: string, starting: MessageBody, kind: "controls" | "announcement" | "closed"): Field<MessageBody> {
  return s.message({
    label,
    help,
    topic: "groups",
    audience: "public",
    starting,
    variables: kind === "announcement" ? GROUP_ANNOUNCEMENT_VARIABLES : GROUP_VARIABLES,
    components: false,
    ...(kind === "announcement"
      ? {
          attach: {
            kind: "buttons" as const,
            buttons: [
              { name: "Join", label: "/groups.labels.groupJoin", defaultStyle: "success" as const },
              { name: "Leave", label: "/groups.labels.groupLeave", defaultStyle: "secondary" as const },
            ],
          },
        }
      : {}),
    ...(kind === "controls"
      ? {
          attach: {
            kind: "buttons" as const,
            buttons: [
              { name: "Make private", label: "/groups.labels.groupMakePrivate", defaultStyle: "secondary" as const },
              { name: "Rename", label: "/groups.labels.groupRename", defaultStyle: "secondary" as const },
              { name: "Change game", label: "/groups.labels.groupGame", defaultStyle: "secondary" as const },
              { name: "Set limit", label: "/groups.labels.groupLimit", defaultStyle: "secondary" as const },
              { name: "End group", label: "/groups.labels.groupClose", defaultStyle: "danger" as const },
            ],
          },
        }
      : {}),
  });
}

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
              { name: "Join", label: "/lfg.labels.lfgJoin", defaultStyle: "success" as const },
              { name: "Leave", label: "/lfg.labels.lfgLeave", defaultStyle: "secondary" as const },
              { name: "Start group", label: "/lfg.labels.lfgStart", defaultStyle: "success" as const },
              { name: "Close", label: "/lfg.labels.lfgClose", defaultStyle: "danger" as const },
            ],
          },
        }
      : {}),
  });
}

export type GamingSettings = Infer<typeof settingsSchema>;
export type HubSetting = GamingSettings["voice"]["hubs"][number];
export type LfgPanelSetting = GamingSettings["lfg"]["panels"][number];
export type GameSetting = GamingSettings["lfg"]["games"][number];
export type GroupPanelSetting = GamingSettings["groups"]["panels"][number];
export type GroupOptionSetting = GroupPanelSetting["options"][number];
