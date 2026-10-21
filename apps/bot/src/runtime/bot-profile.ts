import { ActivityType, type ActivitiesOptions, type Client, type PresenceData, type PresenceStatusData } from "discord.js";
import { prisma } from "@tier0/db";

/**
 * How the bot shows itself: its status and what it says it is doing, which the
 * dashboard's owner sets and the bot keeps across restarts, and its name and
 * picture, which Discord holds and the dashboard can change. Everything here
 * that needs no Discord client is pure so it can be tested on its own.
 */

export const STATUSES = ["online", "idle", "dnd", "invisible"] as const;
export const ACTIVITY_KINDS = ["none", "playing", "watching", "listening", "competing", "custom"] as const;

export type Status = (typeof STATUSES)[number];
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface Presence {
  status: Status;
  activityType: ActivityKind;
  activityText: string;
}

export const DEFAULT_PRESENCE: Presence = { status: "online", activityType: "none", activityText: "" };

/** Discord stops an activity's text at 128 characters. */
export const ACTIVITY_MAX = 128;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parsePresence(input: unknown): Parsed<Presence> {
  if (typeof input !== "object" || input === null) return { ok: false, error: "Say how the bot should show." };
  const { status, activityType, activityText } = input as Record<string, unknown>;
  if (!STATUSES.includes(status as Status)) return { ok: false, error: "That is not a status Discord has." };
  if (!ACTIVITY_KINDS.includes(activityType as ActivityKind)) return { ok: false, error: "That is not a kind of activity Discord has." };
  const text = typeof activityText === "string" ? activityText.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim() : "";
  if ([...text].length > ACTIVITY_MAX) return { ok: false, error: `The activity can be at most ${ACTIVITY_MAX} characters.` };
  if (activityType !== "none" && text === "") return { ok: false, error: "Write what the bot is doing, or choose no activity." };
  return { ok: true, value: { status: status as Status, activityType: activityType as ActivityKind, activityText: activityType === "none" ? "" : text } };
}

const KIND: Record<Exclude<ActivityKind, "none" | "custom">, ActivityType> = {
  playing: ActivityType.Playing,
  watching: ActivityType.Watching,
  listening: ActivityType.Listening,
  competing: ActivityType.Competing,
};

/** What Discord is sent for a presence. */
export function presenceData(presence: Presence): PresenceData {
  const activities: ActivitiesOptions[] =
    presence.activityType === "none"
      ? []
      : presence.activityType === "custom"
        ? [{ name: "Custom Status", type: ActivityType.Custom, state: presence.activityText }]
        : [{ name: presence.activityText, type: KIND[presence.activityType] }];
  return { status: presence.status as PresenceStatusData, activities };
}

/** A name Discord accepts for a bot: 2 to 32 characters once the spaces at the ends are gone. */
export function parseName(input: unknown): Parsed<string> {
  if (typeof input !== "string") return { ok: false, error: "Write the name the bot should have." };
  const name = input.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
  const length = [...name].length;
  if (length < 2 || length > 32) return { ok: false, error: "A name has to be between 2 and 32 characters." };
  return { ok: true, value: name };
}

/** Discord takes a picture up to 8 MB. */
export const AVATAR_MAX_BYTES = 8 * 1024 * 1024;

const DATA_URI = /^data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

/** A picture as the dashboard sends it, a data address, or null to take the picture off. */
export function parseAvatar(input: unknown): Parsed<string | null> {
  if (input === null) return { ok: true, value: null };
  if (typeof input !== "string") return { ok: false, error: "Choose a picture, or remove it." };
  const match = DATA_URI.exec(input);
  if (!match) return { ok: false, error: "The picture has to be a PNG, JPEG, GIF or WebP image." };
  const bytes = Math.floor(((match[2] ?? "").length * 3) / 4);
  if (bytes > AVATAR_MAX_BYTES) return { ok: false, error: "The picture is larger than 8 MB." };
  if (bytes < 100) return { ok: false, error: "That does not look like a picture." };
  return { ok: true, value: input };
}

// -- what is kept ---------------------------------------------------------------------------------------------

export async function readPresence(): Promise<Presence> {
  const row = await prisma.instance.findUnique({ where: { id: 1 }, select: { botStatus: true, botActivityType: true, botActivityText: true } }).catch(() => null);
  if (!row) return DEFAULT_PRESENCE;
  const parsed = parsePresence({ status: row.botStatus, activityType: row.botActivityType, activityText: row.botActivityText });
  return parsed.ok ? parsed.value : DEFAULT_PRESENCE;
}

export async function savePresence(presence: Presence): Promise<void> {
  const data = { botStatus: presence.status, botActivityType: presence.activityType, botActivityText: presence.activityText };
  await prisma.instance.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
}

export function applyPresence(client: Client, presence: Presence): void {
  client.user?.setPresence(presenceData(presence));
}

// -- changing the name and the picture --------------------------------------------------------------------------

export interface ProfileChange {
  presence: Presence;
  name?: string;
  /** A data address, null to take the picture off, or left out to keep it. */
  avatar?: string | null;
}

/** What each part of a change came to, so the dashboard can say which worked when one is refused. */
export interface ProfileResult {
  presence: "saved";
  name: "unchanged" | "changed" | { failed: string };
  avatar: "unchanged" | "changed" | "removed" | { failed: string };
}

const reason = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error);
  // Discord limits how often a bot can rename itself, and says so in a sentence worth passing on.
  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
};

export async function applyProfile(client: Client, change: ProfileChange): Promise<ProfileResult> {
  await savePresence(change.presence);
  applyPresence(client, change.presence);

  const result: ProfileResult = { presence: "saved", name: "unchanged", avatar: "unchanged" };
  const user = client.user;
  if (!user) return result;

  if (change.name !== undefined && change.name !== user.username) {
    try {
      await user.setUsername(change.name);
      result.name = "changed";
    } catch (error) {
      result.name = { failed: reason(error) };
    }
  }
  if (change.avatar !== undefined) {
    try {
      await user.setAvatar(change.avatar);
      result.avatar = change.avatar === null ? "removed" : "changed";
    } catch (error) {
      result.avatar = { failed: reason(error) };
    }
  }
  return result;
}

/** What the dashboard shows. */
export async function profileOf(client: Client) {
  const user = client.user;
  return {
    id: user?.id ?? null,
    name: user?.username ?? null,
    avatarUrl: user?.displayAvatarURL({ extension: "png", size: 256 }) ?? null,
    hasAvatar: Boolean(user?.avatar),
    presence: await readPresence(),
  };
}
