/**
 * discord.js's ChannelType values the channel picker filters on. Kept as a
 * plain map. Pulling in discord.js for it would be a dependency the dashboard
 * no other reason to import.
 */
const CHANNEL_TYPE_NUMBERS: Record<string, number> = {
  text: 0,
  voice: 2,
  category: 4,
  forum: 15,
};

/** A field with no `types` restriction accepts every channel. */
export function matchesChannelTypes(channelType: number, types: readonly string[]): boolean {
  if (types.length === 0) return true;
  return types.some((type) => CHANNEL_TYPE_NUMBERS[type] === channelType);
}
