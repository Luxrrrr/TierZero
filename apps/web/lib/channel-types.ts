/**
 * discord.js's ChannelType values the channel picker filters on. Kept as a
 * plain map. Pulling in discord.js for it would be a dependency the dashboard
 * no other reason to import.
 */
export const CHANNEL_TYPES = {
  text: 0,
  voice: 2,
  category: 4,
  announcement: 5,
  forum: 15,
} as const;

/**
 * A schema only ever asks for "text", but an announcement channel is a text
 * channel with a follow button, and a module that can post in one can post in
 * the other. Leaving them out would hide half of some servers' channels.
 */
const ACCEPTED: Record<string, readonly number[]> = {
  text: [CHANNEL_TYPES.text, CHANNEL_TYPES.announcement],
  voice: [CHANNEL_TYPES.voice],
  category: [CHANNEL_TYPES.category],
  announcement: [CHANNEL_TYPES.announcement],
  forum: [CHANNEL_TYPES.forum],
};

/** A field with no `types` restriction accepts every channel. */
export function matchesChannelTypes(channelType: number, types: readonly string[]): boolean {
  if (types.length === 0) return true;
  return types.some((type) => ACCEPTED[type]?.includes(channelType) ?? false);
}
