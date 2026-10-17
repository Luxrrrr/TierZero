/**
 * What the emoji picker offers and how a typed or pasted emoji becomes the
 * stored form. The schema accepts a unicode emoji or Discord's `<:name:id>`;
 * nobody should have to know the second exists, so the picker lists the
 * server's own emoji and `:name:` is turned into it here, where the server's
 * list is known.
 *
 * Kept free of React and of the dashboard's other modules so the tests can
 * import it directly.
 */

export interface ServerEmoji {
  id: string;
  name: string;
  animated: boolean;
  url: string;
}

export interface UnicodeEmoji {
  char: string;
  name: string;
  /** More words the search should find it by. */
  keywords?: string;
}

/**
 * A short, common set rather than all of Unicode, which would make the
 * dashboard carry a large table for a field that is mostly a role button's
 * icon. Anything else can still be pasted into the box.
 */
export const UNICODE_EMOJI: UnicodeEmoji[] = [
  { char: "🎮", name: "video_game", keywords: "controller gaming play" },
  { char: "🕹️", name: "joystick", keywords: "arcade retro gaming" },
  { char: "🎲", name: "game_die", keywords: "dice board tabletop" },
  { char: "♟️", name: "chess_pawn", keywords: "chess strategy" },
  { char: "🃏", name: "joker", keywords: "cards" },
  { char: "🏆", name: "trophy", keywords: "win tournament champion" },
  { char: "🥇", name: "first_place", keywords: "gold medal" },
  { char: "🥈", name: "second_place", keywords: "silver medal" },
  { char: "🥉", name: "third_place", keywords: "bronze medal" },
  { char: "🎯", name: "dart", keywords: "target aim bullseye" },
  { char: "⚔️", name: "crossed_swords", keywords: "pvp fight battle" },
  { char: "🛡️", name: "shield", keywords: "defense tank protect" },
  { char: "🗡️", name: "dagger", keywords: "rogue knife" },
  { char: "🏹", name: "bow_and_arrow", keywords: "archer ranger" },
  { char: "🪄", name: "magic_wand", keywords: "mage wizard spell" },
  { char: "🧙", name: "mage", keywords: "wizard magic" },
  { char: "🐉", name: "dragon", keywords: "boss raid" },
  { char: "👾", name: "space_invader", keywords: "alien retro arcade" },
  { char: "🤖", name: "robot", keywords: "bot" },
  { char: "👑", name: "crown", keywords: "king queen vip" },
  { char: "💎", name: "gem", keywords: "diamond premium" },
  { char: "⭐", name: "star", keywords: "favourite" },
  { char: "🌟", name: "star2", keywords: "glowing shine" },
  { char: "✨", name: "sparkles", keywords: "new shiny" },
  { char: "🔥", name: "fire", keywords: "hot lit" },
  { char: "⚡", name: "zap", keywords: "lightning fast energy" },
  { char: "💥", name: "boom", keywords: "explosion" },
  { char: "🎉", name: "tada", keywords: "party celebrate" },
  { char: "🎊", name: "confetti_ball", keywords: "party celebrate" },
  { char: "🎁", name: "gift", keywords: "present giveaway" },
  { char: "🎟️", name: "tickets", keywords: "event admission" },
  { char: "📅", name: "date", keywords: "calendar event schedule" },
  { char: "⏰", name: "alarm_clock", keywords: "time reminder" },
  { char: "📢", name: "loudspeaker", keywords: "announcement news" },
  { char: "📣", name: "mega", keywords: "megaphone announcement" },
  { char: "🔔", name: "bell", keywords: "notification ping alert" },
  { char: "🔕", name: "no_bell", keywords: "mute quiet" },
  { char: "📰", name: "newspaper", keywords: "news patch notes" },
  { char: "📝", name: "memo", keywords: "notes write" },
  { char: "📌", name: "pushpin", keywords: "pin" },
  { char: "🔗", name: "link", keywords: "url" },
  { char: "💬", name: "speech_balloon", keywords: "chat talk" },
  { char: "🗨️", name: "left_speech_bubble", keywords: "chat" },
  { char: "🎙️", name: "studio_microphone", keywords: "voice stream podcast" },
  { char: "🎧", name: "headphones", keywords: "audio music voice" },
  { char: "🎵", name: "musical_note", keywords: "music" },
  { char: "📺", name: "tv", keywords: "stream watch" },
  { char: "🎥", name: "movie_camera", keywords: "video clips" },
  { char: "📸", name: "camera_flash", keywords: "screenshot photo" },
  { char: "🎨", name: "art", keywords: "artist creative" },
  { char: "🛠️", name: "tools", keywords: "build modding" },
  { char: "🔧", name: "wrench", keywords: "fix tools" },
  { char: "💻", name: "computer", keywords: "pc laptop" },
  { char: "🖥️", name: "desktop_computer", keywords: "pc" },
  { char: "📱", name: "iphone", keywords: "mobile phone" },
  { char: "🌍", name: "earth_africa", keywords: "world region eu" },
  { char: "🌎", name: "earth_americas", keywords: "world region na" },
  { char: "🌏", name: "earth_asia", keywords: "world region oce asia" },
  { char: "🚀", name: "rocket", keywords: "launch boost" },
  { char: "🏁", name: "checkered_flag", keywords: "race finish" },
  { char: "🚩", name: "triangular_flag", keywords: "report" },
  { char: "✅", name: "white_check_mark", keywords: "yes done verified" },
  { char: "☑️", name: "ballot_box_with_check", keywords: "check" },
  { char: "✔️", name: "heavy_check_mark", keywords: "check yes" },
  { char: "❌", name: "x", keywords: "no cross cancel" },
  { char: "❓", name: "question", keywords: "help" },
  { char: "❗", name: "exclamation", keywords: "important" },
  { char: "⚠️", name: "warning", keywords: "caution alert" },
  { char: "🚫", name: "no_entry_sign", keywords: "forbidden ban" },
  { char: "🔒", name: "lock", keywords: "private locked" },
  { char: "🔓", name: "unlock", keywords: "open" },
  { char: "🔑", name: "key", keywords: "access" },
  { char: "👋", name: "wave", keywords: "hello welcome hi" },
  { char: "👍", name: "thumbsup", keywords: "yes like +1" },
  { char: "👎", name: "thumbsdown", keywords: "no dislike -1" },
  { char: "👏", name: "clap", keywords: "applause" },
  { char: "🙌", name: "raised_hands", keywords: "celebrate" },
  { char: "🤝", name: "handshake", keywords: "deal partner" },
  { char: "💪", name: "muscle", keywords: "strong" },
  { char: "👀", name: "eyes", keywords: "look watching" },
  { char: "🧠", name: "brain", keywords: "smart" },
  { char: "❤️", name: "heart", keywords: "love red" },
  { char: "🧡", name: "orange_heart", keywords: "love" },
  { char: "💛", name: "yellow_heart", keywords: "love" },
  { char: "💚", name: "green_heart", keywords: "love" },
  { char: "💙", name: "blue_heart", keywords: "love" },
  { char: "💜", name: "purple_heart", keywords: "love" },
  { char: "🖤", name: "black_heart", keywords: "love" },
  { char: "🤍", name: "white_heart", keywords: "love" },
  { char: "🔴", name: "red_circle", keywords: "colour" },
  { char: "🟠", name: "orange_circle", keywords: "colour" },
  { char: "🟡", name: "yellow_circle", keywords: "colour" },
  { char: "🟢", name: "green_circle", keywords: "colour online" },
  { char: "🔵", name: "blue_circle", keywords: "colour" },
  { char: "🟣", name: "purple_circle", keywords: "colour" },
  { char: "⚫", name: "black_circle", keywords: "colour" },
  { char: "⚪", name: "white_circle", keywords: "colour" },
  { char: "😀", name: "grinning", keywords: "smile happy" },
  { char: "😄", name: "smile", keywords: "happy" },
  { char: "😂", name: "joy", keywords: "laugh lol" },
  { char: "😎", name: "sunglasses", keywords: "cool" },
  { char: "🤔", name: "thinking", keywords: "hmm" },
  { char: "😴", name: "sleeping", keywords: "afk tired" },
  { char: "😡", name: "rage", keywords: "angry tilt" },
  { char: "💀", name: "skull", keywords: "dead rip" },
  { char: "👻", name: "ghost", keywords: "lurk boo" },
  { char: "🐱", name: "cat", keywords: "pet" },
  { char: "🐶", name: "dog", keywords: "pet" },
  { char: "🍕", name: "pizza", keywords: "food" },
  { char: "☕", name: "coffee", keywords: "drink break" },
  { char: "🌙", name: "crescent_moon", keywords: "night late" },
  { char: "☀️", name: "sunny", keywords: "day" },
  { char: "1️⃣", name: "one", keywords: "number" },
  { char: "2️⃣", name: "two", keywords: "number" },
  { char: "3️⃣", name: "three", keywords: "number" },
  { char: "4️⃣", name: "four", keywords: "number" },
  { char: "5️⃣", name: "five", keywords: "number" },
];

const CUSTOM = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/;
const SHORTCODE = /^:([A-Za-z0-9_+-]{1,32}):$/;

export interface CustomEmojiParts {
  animated: boolean;
  name: string;
  id: string;
}

/** The pieces of `<:name:id>` or `<a:name:id>`, or null for anything else. */
export function customEmojiParts(value: string): CustomEmojiParts | null {
  const match = CUSTOM.exec(value.trim());
  if (!match) return null;
  const [, animated, name, id] = match;
  if (name === undefined || id === undefined) return null;
  return { animated: animated === "a", name, id };
}

/** The stored form of one of the server's emoji. */
export function customEmojiValue(emoji: Pick<ServerEmoji, "id" | "name" | "animated">): string {
  return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
}

/** Discord's address for a custom emoji's image, for one the server list does not hold. */
export function customEmojiUrl(parts: CustomEmojiParts): string {
  return `https://cdn.discordapp.com/emojis/${parts.id}.${parts.animated ? "gif" : "png"}`;
}

/**
 * What a typed or pasted value should be stored as. `:name:` becomes the
 * server's emoji of that name, or the unicode emoji of that name, and is left
 * alone when neither exists so the field can say it is not an emoji. Discord's
 * own copy of an emoji, `<:name:id>`, and a unicode emoji pass through.
 */
export function normalizeEmojiInput(text: string, server: readonly ServerEmoji[]): string {
  const value = text.trim();
  const shortcode = SHORTCODE.exec(value);
  if (!shortcode) return value;
  const name = shortcode[1] ?? "";
  const lower = name.toLowerCase();
  const own =
    server.find((emoji) => emoji.name === name) ?? server.find((emoji) => emoji.name.toLowerCase() === lower);
  if (own) return customEmojiValue(own);
  const unicode = UNICODE_EMOJI.find((emoji) => emoji.name === lower);
  return unicode ? unicode.char : value;
}

/** The emoji whose name or keywords hold every word typed, the server's own first. */
export function searchEmoji(
  query: string,
  server: readonly ServerEmoji[],
  unicode: readonly UnicodeEmoji[] = UNICODE_EMOJI,
): { server: ServerEmoji[]; unicode: UnicodeEmoji[] } {
  const words = query.toLowerCase().replace(/:/g, " ").split(/\s+/).filter(Boolean);
  const matches = (text: string) => words.every((word) => text.includes(word));
  if (words.length === 0) return { server: [...server], unicode: [...unicode] };
  return {
    server: server.filter((emoji) => matches(emoji.name.toLowerCase())),
    unicode: unicode.filter((emoji) => matches(`${emoji.name.replace(/_/g, " ")} ${emoji.name} ${emoji.keywords ?? ""}`.toLowerCase())),
  };
}
