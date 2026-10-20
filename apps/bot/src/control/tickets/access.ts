import { PermissionFlagsBits, type Guild } from "discord.js";
import { instanceOwnerId } from "@tier0/db";
import { ticketAccess, type TicketAccess, type TicketActor } from "@tier0/shared-tickets";
import { rememberBounded, withinBudget } from "../mod/names.js";
import { accessSettingsOf, type TicketSettings } from "./runtime.js";

/**
 * Who a dashboard user is in one server, for the ticket workspace. The
 * dashboard only says which Discord account is signed in; the roles and
 * whether they manage the server are read here, from Discord, on every
 * request, so a role taken away in Discord stops working in the dashboard
 * within the short time an answer is remembered.
 */

export const SNOWFLAKE = /^\d{17,20}$/;

export interface ViewerFacts {
  userId: string;
  /** Null when they are not in the server, or Discord did not answer in time. */
  name: string | null;
  avatarUrl: string | null;
  roleIds: string[];
  /** Manage Server, the server's owner, or the instance owner. */
  isManager: boolean;
  /** Manage Channels, which works every type's tickets, in Discord and here alike. Missing means no. */
  worksEveryType?: boolean;
  inServer: boolean;
}

const FACTS_TTL_MS = 15_000;
const OWNER_TTL_MS = 60_000;
const FACTS_MAX = 2000;

const remembered = new Map<string, { facts: ViewerFacts; until: number }>();
let owner: { id: string | null; until: number } | null = null;

/** The person running the install, remembered for a minute since every ticket request asks. */
async function cachedOwnerId(): Promise<string | null> {
  if (process.env.INSTANCE_OWNER_ID) return process.env.INSTANCE_OWNER_ID;
  if (owner && owner.until > Date.now()) return owner.id;
  owner = { id: await instanceOwnerId(), until: Date.now() + OWNER_TTL_MS };
  return owner.id;
}

/** Drops what is remembered, for tests and for a role change that should be seen at once. */
export function forgetViewers(): void {
  remembered.clear();
  owner = null;
}

export async function viewerFacts(guild: Guild, userId: string): Promise<ViewerFacts> {
  const key = `${guild.id}:${userId}`;
  const hit = remembered.get(key);
  if (hit && hit.until > Date.now()) return hit.facts;

  const [member, ownerId] = await Promise.all([
    withinBudget(guild.members.fetch(userId).catch(() => null), null),
    cachedOwnerId(),
  ]);
  const facts: ViewerFacts = member
    ? {
        userId,
        name: member.displayName,
        avatarUrl: member.displayAvatarURL({ size: 128 }),
        roleIds: [...member.roles.cache.keys()].filter((id) => id !== guild.id),
        isManager: guild.ownerId === userId || member.permissions.has(PermissionFlagsBits.ManageGuild) || ownerId === userId,
        worksEveryType: member.permissions.has(PermissionFlagsBits.ManageChannels),
        inServer: true,
      }
    : { userId, name: null, avatarUrl: null, roleIds: [], isManager: ownerId === userId, inServer: false };
  // A miss is not remembered: it may only mean Discord was slow, and a member
  // locked out for the length of the cache over that would be worse than the lookup.
  if (member) rememberBounded(remembered, key, { facts, until: Date.now() + FACTS_TTL_MS }, FACTS_MAX);
  return facts;
}

export function accessFor(facts: ViewerFacts, settings: TicketSettings): TicketAccess {
  return ticketAccess(
    { userId: facts.userId, isManager: facts.isManager, worksEveryType: facts.worksEveryType === true, roleIds: facts.roleIds },
    accessSettingsOf(settings),
  );
}

/**
 * The actor a write is made as. The id comes from the dashboard's session;
 * the name and picture are the member's in this server when the bot can see
 * them, because a dashboard reply goes out under that name.
 */
export function actorOf(body: unknown, facts?: ViewerFacts): TicketActor | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const actor = (body as { actor?: unknown }).actor;
  if (typeof actor !== "object" || actor === null) return null;
  const { userId, name, avatarUrl } = actor as Record<string, unknown>;
  if (typeof userId !== "string" || !SNOWFLAKE.test(userId)) return null;
  const sentName = typeof name === "string" && name.trim() !== "" ? name.trim().slice(0, 80) : "Unknown";
  const sentAvatar = typeof avatarUrl === "string" && avatarUrl.startsWith("https://") ? avatarUrl.slice(0, 500) : null;
  if (facts && facts.userId === userId && facts.name) {
    return { userId, name: facts.name.slice(0, 80), avatarUrl: facts.avatarUrl ?? sentAvatar };
  }
  return { userId, name: sentName, avatarUrl: sentAvatar };
}
