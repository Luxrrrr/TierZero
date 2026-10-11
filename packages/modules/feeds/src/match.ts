/**
 * Finds the sources a member meant by what they typed. Every word has to
 * appear somewhere in the source's searchable text, in any order and any case,
 * so "gta rss" and "r/gta6" both find a feed named "r/GTA6".
 */
export function matchSources<T extends { search: string }>(sources: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return sources.filter((source) => {
    const text = source.search.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

export const MAX_SEND = 10;

/** Keeps a typed count inside what is reasonable to post in one go. */
export function clampCount(count: number | null | undefined): number {
  if (count === null || count === undefined || !Number.isFinite(count)) return 1;
  return Math.min(MAX_SEND, Math.max(1, Math.trunc(count)));
}
