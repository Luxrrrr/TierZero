/**
 * The CDN documents sizes as powers of two from 16 to 4096, and answers other
 * values with a 400, which shows up as a blank icon and nothing in the console.
 * Asking for the next size up keeps the image sharp at the size it is drawn.
 */
export function cdnSize(wanted: number): number {
  let size = 16;
  while (size < wanted && size < 4096) size *= 2;
  return size;
}

/** A guild without a custom icon has no hash to build a URL from at all. */
export function guildIconUrl(guildId: string, icon: string | null, size = 64): string | null {
  if (!icon) return null;
  const extension = icon.startsWith("a_") ? "gif" : "webp";
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.${extension}?size=${cdnSize(size)}`;
}

/** Initials shown in place of an icon: the first letter of up to two words. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]?.[0] ?? "";
  const second = words.length > 1 ? (words[1]?.[0] ?? "") : "";
  return (first + second).toUpperCase();
}
