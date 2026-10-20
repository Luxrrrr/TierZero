import { applyVariables } from "@tier0/core";
import { ROOM_NAME_MAX, sanitiseRoomName } from "./naming.js";

/**
 * The rules of a group that need no Discord: what it is called, when its owner
 * has to be in the voice channel by, and who may manage it. Free of discord.js
 * so they can be tested on their own.
 */

export const GROUP_PLACEHOLDERS = ["user", "username", "game", "number"];

export interface GroupNameValues {
  /** The owner's server nickname, or their name when they have none. */
  user: string;
  username: string;
  game: string;
  number: number;
}

/** The longest game a member may type, which also keeps it from crowding the rest of the name out. */
export const GAME_MAX = 60;

const SEPARATOR = " - ";

/** A game as typed into a form: control characters and extra spaces gone, cut to the limit, empty when nothing is left. */
export function cleanGame(text: string): string {
  return [...sanitiseRoomName(text, "")].slice(0, GAME_MAX).join("").trim();
}

/**
 * The name a template makes for a group's voice channel and thread. The values
 * go in first, so a long nickname cannot push it past Discord's limit. A game
 * the template has no place for is added to the end, and it is the rest of the
 * name that gives way when the two are too long.
 */
export function groupName(template: string, values: GroupNameValues): string {
  const filled = applyVariables(template, {
    user: values.user,
    username: values.username,
    game: values.game,
    number: String(values.number),
  });
  const base = sanitiseRoomName(filled, sanitiseRoomName(values.user, "Group"));
  return !values.game || template.includes("{game}") ? base : withGame(base, values.game);
}

function withGame(name: string, game: string): string {
  const suffix = `${SEPARATOR}${game}`;
  const room = ROOM_NAME_MAX - [...suffix].length;
  return sanitiseRoomName(`${[...name].slice(0, Math.max(room, 0)).join("").trim()}${suffix}`);
}

/**
 * The name of a group after its game changed. The old game is swapped for the
 * new one where it sits, so a name the owner has since edited keeps their
 * wording, and a name that no longer holds the old game gets the new one added.
 */
export function renamedForGame(current: string, previous: string, game: string): string {
  const at = previous ? current.lastIndexOf(previous) : -1;
  if (at === -1) return withGame(current, game);
  return sanitiseRoomName(`${current.slice(0, at)}${game}${current.slice(at + previous.length)}`);
}

/** Whether an option's groups are announced: the option's own say, or the panel's when the option follows it. */
export function announces(panel: { announce: boolean }, option: { announceMode: string }): boolean {
  if (option.announceMode === "always") return true;
  if (option.announceMode === "never") return false;
  return panel.announce;
}

/** The role pinged for an announcement: the option's, else the panel's. */
export function pingRoleOf(panel: { pingRole?: string | null }, option: { pingRole?: string | null }): string | null {
  return option.pingRole || panel.pingRole || null;
}

/** When a member who is not in a voice channel runs out of time to join the one made for them. */
export function joinDeadline(now: number, joinTimeMs: number): Date {
  return new Date(now + joinTimeMs);
}

/** A Discord timestamp that counts down by itself on every reader's screen, as in "in 45 seconds". */
export function countdown(deadline: Date): string {
  return `<t:${Math.floor(deadline.getTime() / 1000)}:R>`;
}

export interface Manager {
  id: string;
  roleIds: Iterable<string>;
  /** Manage Channels, Manage Server or Administrator. */
  hasManagementPermission: boolean;
}

/**
 * The person who started the group manages it, and so does anyone the server
 * chose: a listed role, or a permission that already lets them manage channels.
 */
export function mayManageGroup(ownerId: string, who: Manager, managerRoles: readonly string[]): boolean {
  if (who.id === ownerId) return true;
  if (who.hasManagementPermission) return true;
  const roles = new Set(managerRoles);
  for (const role of who.roleIds) if (roles.has(role)) return true;
  return false;
}

/** Whether a group whose voice channel is empty should end now: it has been given time to fill, and nobody is in it. */
export function shouldEnd(group: { status: string; createdAt: Date }, inside: number, now: number, graceMs: number): boolean {
  if (group.status !== "active") return false;
  if (inside > 0) return false;
  return now - group.createdAt.getTime() >= graceMs;
}
