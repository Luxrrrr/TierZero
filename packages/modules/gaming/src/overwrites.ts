/**
 * Permission overwrites as plain numbers, so building a room's access can be
 * tested without discord.js. `type` is Discord's: 0 for a role, 1 for a member.
 */

export interface Overwrite {
  id: string;
  type: 0 | 1;
  allow: bigint;
  deny: bigint;
}

/** Adds permissions for someone to a list, merging with an entry they already have, and lifts any denial of the same bits. */
export function grant(list: Overwrite[], id: string, type: 0 | 1, allow: bigint): Overwrite[] {
  const existing = list.find((entry) => entry.id === id && entry.type === type);
  if (!existing) return [...list, { id, type, allow, deny: 0n }];
  return list.map((entry) => (entry === existing ? { ...entry, allow: entry.allow | allow, deny: entry.deny & ~allow } : entry));
}

/** Denies permissions to someone, merging with an entry they already have. */
export function forbid(list: Overwrite[], id: string, type: 0 | 1, deny: bigint): Overwrite[] {
  const existing = list.find((entry) => entry.id === id && entry.type === type);
  if (!existing) return [...list, { id, type, allow: 0n, deny }];
  return list.map((entry) => (entry === existing ? { ...entry, deny: entry.deny | deny, allow: entry.allow & ~deny } : entry));
}

/** Keeps only the bits the bot itself holds from what it is about to grant, since Discord refuses anything beyond that. */
export function limitedTo(allow: bigint, held: bigint): bigint {
  return allow & held;
}
