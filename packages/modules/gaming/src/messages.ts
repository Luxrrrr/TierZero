import { embedReply, emptyEmbed, plainReply, REPLY_COLOR, type EmbedField, type MessageBody, type MessageVariable } from "@tier0/core";

/**
 * The wording each message starts with and the values it is filled from. Free
 * of discord.js so it can be tested on its own.
 */

const variable = (name: string, description: string, sample: string): MessageVariable => ({ name, description, sample });

const field = (name: string, value: string, inline = true): EmbedField => ({ name, value, inline });

function card(color: string, fields: Partial<ReturnType<typeof emptyEmbed>>, content = ""): MessageBody {
  return { ...plainReply(content), embeds: [{ ...emptyEmbed(), color, ...fields }] };
}

export interface ReplyDefinition {
  label: string;
  help: string;
  starting: MessageBody;
  variables: MessageVariable[];
}

// -- voice rooms -------------------------------------------------------------

const NAME = variable("name", "The room's new name", "Ada's room");
const MEMBER = variable("member", "The member it concerns, as a mention", "@Grace");
const OWNER = variable("owner", "The room's owner, as a mention", "@Ada");
const LIMIT = variable("limit", "The user limit now set", "4");

export const ROOM_REPLIES = {
  renamed: {
    label: "Room renamed",
    help: "After /room rename.",
    starting: embedReply("Your room is now called **{name}**.", "success"),
    variables: [NAME],
  },
  renameQueued: {
    label: "Rename waiting",
    help: "After /room rename when Discord is limiting renames and the new name will appear later.",
    starting: embedReply("Discord only allows a channel to be renamed twice every ten minutes. **{name}** will appear as soon as it can.", "warning"),
    variables: [NAME],
  },
  limitSet: {
    label: "User limit set",
    help: "After /room limit with a number.",
    starting: embedReply("Your room now holds {limit} people at most.", "success"),
    variables: [LIMIT],
  },
  limitCleared: {
    label: "User limit removed",
    help: "After /room limit with 0.",
    starting: embedReply("Your room has no limit on how many can join.", "success"),
    variables: [],
  },
  locked: {
    label: "Room locked",
    help: "After /room lock.",
    starting: embedReply("Your room is locked. Only the people in it now, and anyone you permit, can join.", "success"),
    variables: [],
  },
  unlocked: {
    label: "Room unlocked",
    help: "After /room unlock.",
    starting: embedReply("Your room is open to everyone again.", "success"),
    variables: [],
  },
  permitted: {
    label: "Member permitted",
    help: "After /room permit.",
    starting: embedReply("{member} can join your room.", "success"),
    variables: [MEMBER],
  },
  kicked: {
    label: "Member removed",
    help: "After /room kick.",
    starting: embedReply("{member} was removed from your room and cannot rejoin it unless you permit them.", "success"),
    variables: [MEMBER],
  },
  transferred: {
    label: "Room handed over",
    help: "After /room transfer.",
    starting: embedReply("{member} owns this room now.", "success"),
    variables: [MEMBER],
  },
  claimed: {
    label: "Room claimed",
    help: "After /room claim.",
    starting: embedReply("You own this room now.", "success"),
    variables: [],
  },
} satisfies Record<string, ReplyDefinition>;

export const ROOM_REFUSALS = {
  notInRoom: {
    label: "Not in a room",
    help: "When someone runs a /room command without being in one of the bot's voice rooms.",
    starting: embedReply("Join one of the voice rooms first, then run the command again.", "error"),
    variables: [],
  },
  notOwner: {
    label: "Not the owner",
    help: "When someone who does not own the room tries to change it.",
    starting: embedReply("Only {owner} can do that, because they own this room.", "error"),
    variables: [OWNER],
  },
  ownerStillHere: {
    label: "Owner still in the room",
    help: "When someone tries to claim a room whose owner is still in it.",
    starting: embedReply("{owner} is still in this room, so it is not yours to claim.", "error"),
    variables: [OWNER],
  },
  claimOff: {
    label: "Claiming is off",
    help: "When someone tries to claim a room whose hub does not allow it.",
    starting: embedReply("Rooms made from this hub cannot be claimed. {owner} still owns it.", "error"),
    variables: [OWNER],
  },
  memberNotInRoom: {
    label: "Member not in the room",
    help: "When /room kick or /room transfer names someone who is not in the room.",
    starting: embedReply("{member} is not in this room.", "error"),
    variables: [MEMBER],
  },
  notYourself: {
    label: "Cannot target yourself",
    help: "When someone names themselves, or a bot, in /room kick or /room transfer.",
    starting: embedReply("Pick a person other than yourself.", "error"),
    variables: [],
  },
  changeFailed: {
    label: "Discord refused the change",
    help: "When the bot lacks the permission to change the room.",
    starting: embedReply("Discord would not let me change this room. Ask a server admin to check my Manage Channels permission.", "error"),
    variables: [],
  },
} satisfies Record<string, ReplyDefinition>;

// -- looking for group -------------------------------------------------------

export const LFG_VARIABLES: MessageVariable[] = [
  variable("game", "The game", "Valorant"),
  variable("emoji", "The game's emoji, empty when it has none", "🎯"),
  variable("author", "Who posted, as a mention", "@Ada"),
  variable("authorName", "Who posted, as a name", "Ada"),
  variable("needed", "How many players the post asked for besides its author", "3"),
  variable("open", "How many places are still free", "2"),
  variable("filled", "How many places are taken, the author included", "2"),
  variable("capacity", "How many places the party has, the author included", "4"),
  variable("party", "Everyone in the party as mentions, one a line", "@Ada\n@Grace"),
  variable("note", "What the author wrote, empty when nothing", "Ranked, Gold and up"),
  variable("starts", "When the party starts, as a time every reader sees in their own zone, empty when none was given", "Friday 20:00"),
  variable("expires", "When the post lapses, as a countdown", "in 2 hours"),
  variable("ping", "The game's role as a mention, empty when it has none", "@Valorant"),
  variable("voice", "The voice channel made for the party, as a link, empty when none was made", "#Valorant party"),
];

const partyField = (title: string) => field(title, "{party}", false);

export const LFG_PANEL_VARIABLES: MessageVariable[] = [variable("panel", "The panel's name", "Find players")];

export const LFG_PANEL: MessageBody = card("#5865f2", {
  title: "Looking for group",
  description: "Press the button, say what you are playing and how many players you need, and the bot posts it for everyone to join.",
});

export const LFG_POST: MessageBody = card(
  "#5865f2",
  {
    title: "{game}: {open} more needed",
    description: "{note}",
    fields: [partyField("Party ({filled}/{capacity})"), field("Starts", "{starts}"), field("Posted by", "{author}"), field("Expires", "{expires}")],
  },
  "{ping}",
);

export const LFG_FULL: MessageBody = card(REPLY_COLOR.success, {
  title: "{game}: party is full",
  description: "{note}",
  fields: [partyField("Party"), field("Starts", "{starts}"), field("Voice", "{voice}")],
});

export const LFG_READY: MessageBody = embedReply("The {game} party is full.", "success", { ping: "{party}" });

export const LFG_STARTED: MessageBody = card(REPLY_COLOR.success, {
  title: "{game}: started",
  description: "{note}",
  fields: [partyField("Party"), field("Starts", "{starts}"), field("Voice", "{voice}")],
});

export const LFG_GO: MessageBody = embedReply("{author} started the {game} group.", "success", { ping: "{party}" });

export const LFG_CLOSED: MessageBody = card(REPLY_COLOR.warning, {
  title: "{game}: closed",
  description: "{note}",
  fields: [partyField("Party at the end")],
});

export const LFG_EXPIRED: MessageBody = card(REPLY_COLOR.warning, {
  title: "{game}: expired",
  description: "{note}",
  fields: [partyField("Party at the end")],
});

export const LFG_REPLIES = {
  posted: {
    label: "Post is up",
    help: "After /lfg posts the request.",
    starting: embedReply("Your post is up: {link}", "success"),
    variables: [variable("link", "A link to the post", "https://discord.com/channels/1/2/3"), variable("game", "The game", "Valorant")],
  },
  joined: {
    label: "Joined a party",
    help: "After someone presses Join.",
    starting: embedReply("You joined {author}'s {game} party. {open} places left.", "success"),
    variables: [variable("author", "Who posted, as a mention", "@Ada"), variable("game", "The game", "Valorant"), variable("open", "Places still free", "1")],
  },
  left: {
    label: "Left a party",
    help: "After someone presses Leave.",
    starting: embedReply("You left the {game} party.", "success"),
    variables: [variable("game", "The game", "Valorant")],
  },
  startedByYou: {
    label: "Group started",
    help: "After the author, or a moderator, presses Start group.",
    starting: embedReply("The group has started.", "success"),
    variables: [],
  },
  closedByYou: {
    label: "Post closed",
    help: "After the author, or a moderator, presses Close.",
    starting: embedReply("The post is closed.", "success"),
    variables: [],
  },
} satisfies Record<string, ReplyDefinition>;

export const LFG_REFUSALS = {
  disabled: {
    label: "Looking for group is off",
    help: "When someone presses a panel's button while the feature is switched off.",
    starting: embedReply("Looking for group is not available right now.", "error"),
    variables: [],
  },
  noGames: {
    label: "No games set up",
    help: "When games are limited to the list and the list is empty.",
    starting: embedReply("No games have been set up for looking for group yet. Ask a server admin to add some.", "error"),
    variables: [],
  },
  unknownGame: {
    label: "Game not found",
    help: "When games are limited to the list and the game given is not on it.",
    starting: embedReply("That game is not on this server's list. Pick one of the suggestions as you type, or check the spelling.", "error"),
    variables: [],
  },
  cooldown: {
    label: "Posting too often",
    help: "When someone posts again before the wait between posts has passed.",
    starting: embedReply("You posted a moment ago. Try again in {remaining}.", "error"),
    variables: [variable("remaining", "How long until they may post again", "6 minutes")],
  },
  tooManyOpen: {
    label: "Too many open posts",
    help: "When someone already has as many open posts as the server allows.",
    starting: embedReply("You already have {limit} open. Close one before posting another.", "error"),
    variables: [variable("limit", "How many open posts a member may have", "1")],
  },
  badTime: {
    label: "Time not understood",
    help: "When the start time given to /lfg cannot be read, or is in the past.",
    starting: embedReply("I could not read that time, or it has already passed. Try {examples}.", "error"),
    variables: [variable("examples", "A few ways to write a time", "in 90m, 20:00, tomorrow 8pm")],
  },
  badSize: {
    label: "Too many players asked for",
    help: "When /lfg asks for more players than the server allows.",
    starting: embedReply("You can ask for up to {limit} more players.", "error"),
    variables: [variable("limit", "The most a post may ask for", "9")],
  },
  cannotPost: {
    label: "Cannot post there",
    help: "When the bot cannot post in the channel for the game.",
    starting: embedReply("I could not post in that channel. Ask a server admin to check that I can send messages there.", "error"),
    variables: [],
  },
  ended: {
    label: "Post already over",
    help: "When someone presses a button on a post that is closed, full or expired.",
    starting: embedReply("This post is over.", "error"),
    variables: [],
  },
  full: {
    label: "Party full",
    help: "When the last place was taken before someone's Join went through.",
    starting: embedReply("The party filled up just before you joined.", "error"),
    variables: [],
  },
  isAuthor: {
    label: "Joining your own post",
    help: "When the author presses Join on their own post.",
    starting: embedReply("You are already in this party, since it is your post.", "error"),
    variables: [],
  },
  alreadyIn: {
    label: "Already in the party",
    help: "When someone presses Join twice.",
    starting: embedReply("You are already in this party.", "error"),
    variables: [],
  },
  notIn: {
    label: "Not in the party",
    help: "When someone presses Leave without having joined.",
    starting: embedReply("You are not in this party.", "error"),
    variables: [],
  },
  authorCannotLeave: {
    label: "Author pressing Leave",
    help: "When the author presses Leave on their own post.",
    starting: embedReply("This is your post. Press Close to end it.", "error"),
    variables: [],
  },
  notAuthor: {
    label: "Using someone else's post",
    help: "When someone who is neither the author nor a moderator presses Close or Start group.",
    starting: embedReply("Only the author, or a moderator, can do that to this post.", "error"),
    variables: [],
  },
} satisfies Record<string, ReplyDefinition>;

// -- sign-ups ----------------------------------------------------------------

export const SIGNUP_VARIABLES: MessageVariable[] = [
  variable("title", "The sign-up's title", "Friday scrims"),
  variable("id", "The sign-up's number, for the staff commands", "4"),
  variable("game", "The game, empty when none was given", "Valorant"),
  variable("note", "The note staff wrote, empty when none", "Bring your own map vetoes"),
  variable("starts", "When it starts, as a time every reader sees in their own zone, empty when none was given", "Friday 20:00"),
  variable("teamSize", "Players to a team", "5"),
  variable("places", "How full it is, as 3/8, or just the count when there is no limit", "3/8"),
  variable("registered", "The registered players or teams as mentions, one a line", "@Ada @Grace"),
  variable("waiting", "The waitlist, one a line, empty when nobody waits", "@Linus"),
  variable("count", "How many are registered", "3"),
  variable("capacity", "The most that can register, empty when there is no limit", "8"),
  variable("waitingCount", "How many are waiting", "1"),
];

export const SIGNUP_POST: MessageBody = card("#5865f2", {
  title: "{title}",
  description: "{note}",
  fields: [
    field("Game", "{game}"),
    field("Starts", "{starts}"),
    field("Team size", "{teamSize}"),
    field("Places", "{places}"),
    field("Registered", "{registered}", false),
    field("Waitlist", "{waiting}", false),
  ],
});

export const SIGNUP_CLOSED: MessageBody = card(REPLY_COLOR.warning, {
  title: "{title} (closed)",
  description: "{note}",
  fields: [field("Game", "{game}"), field("Starts", "{starts}"), field("Registered", "{registered}", false), field("Waitlist", "{waiting}", false)],
});

const PLAYERS = variable("players", "The people on the entry, as mentions", "@Ada @Grace");
const TITLE = variable("title", "The sign-up's title", "Friday scrims");

export const SIGNUP_PROMOTED: MessageBody = embedReply("A place opened up on **{title}**, and you are in. Starts {starts}.", "success", { ping: "{players}" });

export const SIGNUP_REMINDER: MessageBody = embedReply("**{title}** starts {starts}. Get ready.", "info", { ping: "{players}" });

export const SIGNUP_NOTICE_VARIABLES: MessageVariable[] = [
  TITLE,
  PLAYERS,
  variable("starts", "When it starts, as a time every reader sees in their own zone, empty when none was given", "Friday 20:00"),
  variable("link", "A link to the sign-up post", "https://discord.com/channels/1/2/3"),
];

export const SIGNUP_REPLIES = {
  created: {
    label: "Sign-up posted",
    help: "After /signup create posts the sign-up.",
    starting: embedReply("Sign-up #{id} is up: {link}", "success"),
    variables: [variable("id", "The sign-up's number", "4"), variable("link", "A link to the post", "https://discord.com/channels/1/2/3"), TITLE],
  },
  registered: {
    label: "Signed up",
    help: "After someone is registered.",
    starting: embedReply("You are signed up for **{title}**.", "success"),
    variables: [TITLE, PLAYERS],
  },
  waitlisted: {
    label: "Put on the waitlist",
    help: "After someone signs up for a sign-up that is full and keeps a waitlist.",
    starting: embedReply("**{title}** is full, so you are number {position} on the waitlist. You will be told if a place opens.", "warning"),
    variables: [TITLE, variable("position", "Their place in the waitlist", "2"), PLAYERS],
  },
  withdrawn: {
    label: "Signed out",
    help: "After someone withdraws.",
    starting: embedReply("You are no longer signed up for **{title}**.", "success"),
    variables: [TITLE],
  },
  closed: {
    label: "Sign-up closed",
    help: "After /signup close.",
    starting: embedReply("Sign-up #{id} is closed.", "success"),
    variables: [variable("id", "The sign-up's number", "4"), TITLE],
  },
  removed: {
    label: "Entry removed",
    help: "After /signup remove.",
    starting: embedReply("Removed {players} from sign-up #{id}.", "success"),
    variables: [variable("id", "The sign-up's number", "4"), PLAYERS],
  },
  list: {
    label: "The list",
    help: "After /signup list.",
    starting: card("#5865f2", {
      title: "{title}",
      description: "{count} registered. {waitingCount} waiting.",
      fields: [field("Registered", "{registered}", false), field("Waitlist", "{waiting}", false)],
    }),
    variables: SIGNUP_VARIABLES,
  },
} satisfies Record<string, ReplyDefinition>;

export const SIGNUP_REFUSALS = {
  notStaff: {
    label: "Not staff",
    help: "When someone who is not staff uses a /signup command.",
    starting: embedReply("Only staff can do that.", "error"),
    variables: [],
  },
  gone: {
    label: "Sign-up not found",
    help: "When the sign-up named in a command, or on a button, no longer exists.",
    starting: embedReply("I cannot find that sign-up.", "error"),
    variables: [],
  },
  closedAlready: {
    label: "Sign-up closed",
    help: "When someone signs up after it has closed, or staff close it twice.",
    starting: embedReply("This sign-up is closed.", "error"),
    variables: [],
  },
  full: {
    label: "Sign-up full",
    help: "When a sign-up is full and keeps no waitlist.",
    starting: embedReply("**{title}** is full.", "error"),
    variables: [TITLE],
  },
  alreadyIn: {
    label: "Already signed up",
    help: "When someone, or a teammate they named, is already on the sign-up.",
    starting: embedReply("{member} is already signed up for this.", "error"),
    variables: [variable("member", "The person already on it, as a mention", "@Ada")],
  },
  missingRole: {
    label: "Missing a required role",
    help: "When someone on the entry lacks all of the roles the sign-up asks for.",
    starting: embedReply("{member} needs one of these roles to sign up: {roles}.", "error"),
    variables: [variable("member", "Who lacks the role, as a mention", "@Ada"), variable("roles", "The roles asked for, as mentions", "@Verified")],
  },
  tooMany: {
    label: "Too many teammates",
    help: "When a captain names more people than fit in a team.",
    starting: embedReply("A team is {teamSize} players, you included. You named too many.", "error"),
    variables: [variable("teamSize", "Players to a team", "5")],
  },
  tooFew: {
    label: "Too few teammates",
    help: "When a captain names fewer people than a full team and the server asks for full teams.",
    starting: embedReply("A team is {teamSize} players, you included. Name {missing} more.", "error"),
    variables: [variable("teamSize", "Players to a team", "5"), variable("missing", "How many more to name", "2")],
  },
  memberNotFound: {
    label: "Teammate not on the server",
    help: "When an ID in the team list is not a member of the server.",
    starting: embedReply("I cannot find <@{id}> on this server.", "error"),
    variables: [variable("id", "The ID that was not found", "123456789012345678")],
  },
  botMember: {
    label: "A bot in the team",
    help: "When a bot is named as a teammate.",
    starting: embedReply("Bots cannot be on a team.", "error"),
    variables: [],
  },
  notRegistered: {
    label: "Not signed up",
    help: "When someone presses Withdraw without being on the sign-up.",
    starting: embedReply("You are not signed up for this.", "error"),
    variables: [],
  },
  noEntry: {
    label: "Nobody to remove",
    help: "When /signup remove names someone who is not on the sign-up.",
    starting: embedReply("{member} is not on that sign-up.", "error"),
    variables: [variable("member", "The member, as a mention", "@Ada")],
  },
  badTime: {
    label: "Time not understood",
    help: "When the start time given to /signup create cannot be read, or has passed.",
    starting: embedReply("I could not read that time, or it has already passed. Try {examples}.", "error"),
    variables: [variable("examples", "A few ways to write a time", "in 90m, 20:00, tomorrow 8pm")],
  },
  cannotPost: {
    label: "Cannot post there",
    help: "When the bot cannot post the sign-up in the channel.",
    starting: embedReply("I could not post in that channel. Check that I can send messages and embed links there.", "error"),
    variables: [],
  },
  noChannel: {
    label: "No channel to post in",
    help: "When /signup create is not run in a text channel and names none.",
    starting: embedReply("Pick a channel to post the sign-up in.", "error"),
    variables: [],
  },
} satisfies Record<string, ReplyDefinition>;

export type RoomReplyKey = keyof typeof ROOM_REPLIES;
export type RoomRefusalKey = keyof typeof ROOM_REFUSALS;
export type LfgReplyKey = keyof typeof LFG_REPLIES;
export type LfgRefusalKey = keyof typeof LFG_REFUSALS;
export type SignupReplyKey = keyof typeof SIGNUP_REPLIES;
export type SignupRefusalKey = keyof typeof SIGNUP_REFUSALS;

// -- group hubs -------------------------------------------------------------------------------------

const G_GROUP = variable("group", "The group's name", "Ada's group");
const G_ROOM = variable("room", "The group's voice channel, as a link", "#Ada's group");
const G_THREAD = variable("thread", "The group's thread, as a link", "#Ada's group");
const G_OPTION = variable("option", "The panel option the group was started from", "Looking for group");
const G_GAME = variable("game", "What the group is playing, empty when no game was given", "Valorant");

export const GROUP_PANEL_VARIABLES: MessageVariable[] = [variable("panel", "The panel's name", "Find a group")];

export const GROUP_PANEL: MessageBody = card("#5865f2", {
  title: "Start a group",
  description: "Pick an option below. The bot makes you a voice channel and a thread to run your group from.",
});

export const GROUP_VARIABLES: MessageVariable[] = [
  G_GROUP,
  variable("owner", "Who runs the group, as a name", "Ada"),
  G_ROOM,
  variable("mode", "Open or Private", "Open"),
  variable("limit", "How many people the voice channel holds, or No limit", "4"),
  G_OPTION,
  G_GAME,
];

export const GROUP_ANNOUNCEMENT_VARIABLES: MessageVariable[] = [
  ...GROUP_VARIABLES,
  variable("players", "How many people are in the voice channel now", "2"),
  variable("spots", "How many places are left, or the no-limit text", "2"),
  variable("ping", "The role chosen to be pinged, as a mention, when the group is announced. Empty after that.", "@Valorant"),
];

export const GROUP_ANNOUNCEMENT: MessageBody = card(
  "#248046",
  {
    title: "{group}",
    description: "{owner} has room for more. Press Join to get in.",
    fields: [field("Players", "{players}"), field("Places left", "{spots}"), field("Voice channel", "{room}")],
  },
  "{ping}",
);

export const GROUP_CONTROLS: MessageBody = card("#5865f2", {
  title: "{group}",
  description: "Run by {owner}. Manage the group with the buttons and menus below, or just talk here.",
  fields: [field("Voice channel", "{room}"), field("Who can join", "{mode}"), field("Limit", "{limit}")],
});

export const GROUP_CLOSED: MessageBody = card(REPLY_COLOR.warning, {
  title: "{group}: ended",
  description: "This group has ended. The voice channel is gone and this thread is kept so it can be read.",
});

export const GROUP_REPLIES = {
  joinPrompt: {
    label: "Join your voice channel",
    help: "Shown after a member presses an option while they are not in a voice channel. The countdown updates by itself.",
    starting: embedReply("Your voice channel {room} is ready. Join it {deadline}, or join any voice channel and the bot moves you in.", "info"),
    variables: [G_ROOM, variable("deadline", "When the time to join runs out, as a countdown that updates itself", "in 1 minute"), G_GROUP, G_OPTION, G_GAME],
  },
  ready: {
    label: "Group is ready",
    help: "Shown once the member is in the voice channel and the group's thread exists.",
    starting: embedReply("You are in {room}. Your group's thread is {thread}.", "success"),
    variables: [G_ROOM, G_THREAD, G_GROUP, G_OPTION, G_GAME],
  },
  ended: {
    label: "Group ended",
    help: "Shown to the person who pressed End group.",
    starting: embedReply("Your group has ended. The voice channel is gone and the thread is kept archived.", "success"),
    variables: [G_GROUP],
  },
  expired: {
    label: "Time to join ran out",
    help: "Shown when the member did not join their voice channel in time and it was removed.",
    starting: embedReply("You did not join **{group}** in time, so it was removed. Press the option again to start over.", "warning"),
    variables: [G_GROUP, G_OPTION, G_GAME],
  },
  joinedGroup: {
    label: "Joined a group",
    help: "Shown to a member who presses Join on a group's post. They are moved into the voice channel if they are already in one.",
    starting: embedReply("You are in. Voice channel: {room}. Thread: {thread}.", "success"),
    variables: [G_ROOM, G_THREAD, G_GROUP, G_OPTION, G_GAME],
  },
  gameChanged: {
    label: "Game changed",
    help: "Shown to the person who changed the group's game from its thread.",
    starting: embedReply("The group is now playing **{game}**. It is called **{group}**.", "success"),
    variables: [G_GROUP, G_GAME],
  },
  leftGroup: {
    label: "Left a group",
    help: "Shown to a member who presses Leave on a group's post.",
    starting: embedReply("You left **{group}**.", "success"),
    variables: [G_GROUP],
  },
} satisfies Record<string, ReplyDefinition>;

export const GROUP_REFUSALS = {
  disabled: {
    label: "Groups are off",
    help: "When someone presses an option while the feature is switched off.",
    starting: embedReply("Groups are not being started right now.", "error"),
    variables: [],
  },
  optionGone: {
    label: "Option no longer exists",
    help: "When someone presses an option that has been removed since the panel was posted.",
    starting: embedReply("That option is not available any more. Ask a moderator to post the panel again.", "error"),
    variables: [],
  },
  alreadyHave: {
    label: "Already has a group",
    help: "When someone who already has a group presses an option.",
    starting: embedReply("You already have a group: {room}. End it before you start another.", "error"),
    variables: [G_ROOM],
  },
  createFailed: {
    label: "Voice channel could not be made",
    help: "When Discord refuses the new voice channel.",
    starting: embedReply("I could not make your voice channel. A moderator needs to check that I can manage channels there.", "error"),
    variables: [],
  },
  threadFailed: {
    label: "Thread could not be made",
    help: "When the group's thread cannot be created, so the voice channel is removed again.",
    starting: embedReply("I could not make your group's thread, so the voice channel was removed. A moderator needs to check that I can create private threads in the panel's channel.", "error"),
    variables: [],
  },
  moveFailed: {
    label: "Could not move the member",
    help: "When the bot cannot move the member into their voice channel.",
    starting: embedReply("I could not move you into {room}. Join it yourself {deadline} and the group will start.", "warning"),
    variables: [G_ROOM, variable("deadline", "When the time to join runs out, as a countdown that updates itself", "in 1 minute")],
  },
  notManager: {
    label: "Not allowed to manage the group",
    help: "When someone who is not the group's owner or a manager presses a control.",
    starting: embedReply("Only the person who started this group, and the people the server chose to manage groups, can do that.", "error"),
    variables: [],
  },
  groupGone: {
    label: "Group has ended",
    help: "When a control is used after the group has ended.",
    starting: embedReply("This group has ended.", "error"),
    variables: [],
  },
  groupPrivate: {
    label: "Group is private",
    help: "When someone presses Join on a post whose group was made private since.",
    starting: embedReply("This group is private now. Ask {owner} to invite you.", "error"),
    variables: [variable("owner", "Who runs the group, as a name", "Ada")],
  },
  groupFull: {
    label: "Group is full",
    help: "When someone presses Join and the voice channel has no places left.",
    starting: embedReply("**{group}** is full.", "error"),
    variables: [G_GROUP],
  },
  ownerCannotLeave: {
    label: "The owner pressed Leave",
    help: "When the person who runs the group presses Leave. They can hand the group over or end it from the thread.",
    starting: embedReply("You run this group. Hand it to someone else or end it from the thread.", "error"),
    variables: [],
  },
} satisfies Record<string, ReplyDefinition>;

export type GroupReplyKey = keyof typeof GROUP_REPLIES;
export type GroupRefusalKey = keyof typeof GROUP_REFUSALS;
