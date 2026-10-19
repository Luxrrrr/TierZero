import { applyVariables } from "@tier0/core";

/**
 * How a room gets its name, and which number a new room takes. Free of
 * discord.js so it can be tested on its own.
 */

/** Discord stops a channel name at 100 characters. */
export const ROOM_NAME_MAX = 100;

export const ROOM_PLACEHOLDERS = ["user", "username", "number"];

export interface RoomNameValues {
  /** The owner's server nickname, or their name when they have none. */
  user: string;
  username: string;
  number: number;
}

/**
 * Voice channel names may hold spaces, capitals and most symbols, so only what
 * Discord refuses is removed: control characters and line breaks, runs of
 * spaces, and anything past the limit. A name that comes out empty is replaced.
 */
export function sanitiseRoomName(text: string, fallback = "Voice room"): string {
  const cleaned = text
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cut = [...cleaned].slice(0, ROOM_NAME_MAX).join("").trim();
  return cut === "" ? fallback : cut;
}

/** The name a template makes for a room. The values are filled in first, so a long nickname cannot push the name past the limit. */
export function roomName(template: string, values: RoomNameValues): string {
  const filled = applyVariables(template, {
    user: values.user,
    username: values.username,
    number: String(values.number),
  });
  return sanitiseRoomName(filled, sanitiseRoomName(values.user));
}

/** The lowest number from 1 up that none of the given rooms is using. */
export function lowestFree(used: Iterable<number>): number {
  const taken = new Set(used);
  let number = 1;
  while (taken.has(number)) number += 1;
  return number;
}

/** A bitrate in kilobits kept inside what the server allows, or undefined to leave it to Discord. */
export function bitrateFor(kbps: number | undefined, maxBitrate: number): number | undefined {
  if (kbps === undefined || kbps <= 0) return undefined;
  return Math.min(kbps * 1000, maxBitrate);
}
