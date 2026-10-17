import type { Guild } from "discord.js";
import { prisma } from "@tier0/db";

/**
 * The leaderboard page anyone can open in a browser, for a server whose owner
 * switched it on, and the members who asked to be left off it.
 *
 * What the page may show is decided here and nowhere else: a member's server
 * display name, their picture and their level, in order. No user ids leave the
 * bot, so the page cannot be used to look members up.
 */

export const PUBLIC_PAGE_SIZE = 50;
/** Deep pages cost a database skip each, and nobody reads the 5001st place. */
export const PUBLIC_MAX_PAGES = 100;

export interface PublicMember {
  position: number;
  name: string;
  /** A Discord CDN address, or null for a member who has left. */
  avatar: string | null;
  level: number;
}

export interface PublicLeaderboard {
  server: { name: string; icon: string | null };
  /** Whether search engines may list the page. */
  indexed: boolean;
  page: number;
  pages: number;
  members: PublicMember[];
}

/** The address of the page, or empty when the dashboard has no address anyone else could open. */
export function publicPageUrl(dashboardUrl: string, guildId: string): string {
  return dashboardUrl === "" ? "" : `${dashboardUrl}/leaderboard/${guildId}`;
}

/** A page number from the query string: whole, at least 1 and at most the cap. */
export function clampPage(raw: unknown): number {
  const page = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : 1;
  if (!Number.isInteger(page) || page < 1) return 1;
  return Math.min(page, PUBLIC_MAX_PAGES);
}

/*
 * Members who opted out are kept in a GuildModule row of their own, because the
 * level table has no column for it and settings JSON is replaced whole by every
 * dashboard save. The row is never enabled and names no registered module, so
 * nothing else reads it. Moving this to a column only changes the two functions
 * below.
 */
const HIDDEN_ROW = "leveling:hidden";

function readIds(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const ids = (parsed as { hidden?: unknown })?.hidden;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export async function hiddenMembers(guildId: string): Promise<string[]> {
  const row = await prisma.guildModule.findUnique({ where: { guildId_moduleId: { guildId, moduleId: HIDDEN_ROW } } });
  return readIds(row?.settings);
}

/** Hides or shows one member on the public page. Resolves to whether anything changed. */
export async function setHidden(guildId: string, userId: string, hidden: boolean): Promise<boolean> {
  const current = await hiddenMembers(guildId);
  const has = current.includes(userId);
  if (has === hidden) return false;
  const next = hidden ? [...current, userId] : current.filter((id) => id !== userId);
  const settings = JSON.stringify({ hidden: next });
  await prisma.guildModule.upsert({
    where: { guildId_moduleId: { guildId, moduleId: HIDDEN_ROW } },
    create: { guildId, moduleId: HIDDEN_ROW, enabled: false, settings },
    update: { settings },
  });
  forgetPages(guildId);
  return true;
}

/*
 * The page is public, so anyone can make the bot read it as often as they like.
 * Each page is kept for a minute, which turns a burst of visits into one
 * database query and one member lookup. Names are read from the members the bot
 * already holds, and only the missing ones are asked of Discord, which costs a
 * request on the shared gateway connection. Those requests are budgeted, per
 * server and overall, so a visitor paging through the list cannot crowd out
 * the bot's own traffic. Past the budget the last copy of a page is served,
 * however old it is, or the names that are known.
 */
const CACHE_MS = 60_000;
const CACHE_LIMIT = 500;
const FETCHES_PER_GUILD = 10;
const FETCHES_OVERALL = 40;
const FETCH_WINDOW_MS = 60_000;
const cache = new Map<string, { at: number; value: PublicLeaderboard }>();

let fetchWindow = { start: 0, total: 0, guilds: new Map<string, number>() };

/** Whether one more member request to Discord is within the budget; counts it when it is. */
export function takeMemberFetch(guildId: string, now = Date.now()): boolean {
  if (now - fetchWindow.start >= FETCH_WINDOW_MS) fetchWindow = { start: now, total: 0, guilds: new Map() };
  const used = fetchWindow.guilds.get(guildId) ?? 0;
  if (fetchWindow.total >= FETCHES_OVERALL || used >= FETCHES_PER_GUILD) return false;
  fetchWindow.total += 1;
  fetchWindow.guilds.set(guildId, used + 1);
  return true;
}

export function resetMemberFetchBudget(): void {
  fetchWindow = { start: 0, total: 0, guilds: new Map() };
}

export function forgetPages(guildId: string): void {
  for (const key of cache.keys()) if (key.startsWith(`${guildId}:`)) cache.delete(key);
}

interface Named {
  displayName: string;
  displayAvatarURL(options?: { size?: number }): string;
}

/** One page of the public leaderboard. The caller has already checked that the page is switched on. */
export async function publicLeaderboard(guild: Guild, page: number, indexed: boolean, now = Date.now()): Promise<PublicLeaderboard> {
  const key = `${guild.id}:${page}`;
  const cached = cache.get(key);
  if (cached && now - cached.at < CACHE_MS) return { ...cached.value, indexed };

  const hidden = await hiddenMembers(guild.id);
  const where = { guildId: guild.id, xp: { gt: 0 }, ...(hidden.length > 0 ? { userId: { notIn: hidden } } : {}) };
  const [total, rows] = await Promise.all([
    prisma.levelMember.count({ where }),
    prisma.levelMember.findMany({
      where,
      orderBy: { xp: "desc" },
      skip: (page - 1) * PUBLIC_PAGE_SIZE,
      take: PUBLIC_PAGE_SIZE,
    }),
  ]);

  const known = new Map<string, Named>();
  for (const row of rows) {
    const held = guild.members.cache.get(row.userId);
    if (held) known.set(row.userId, held);
  }
  const missing = rows.map((row) => row.userId).filter((id) => !known.has(id));
  // A name that could not be looked up is not the same as a member who has left, and is not kept as if it were.
  let complete = true;
  if (missing.length > 0) {
    const fetched = takeMemberFetch(guild.id, now) ? await guild.members.fetch({ user: missing }).catch(() => null) : null;
    if (fetched) fetched.forEach((member, id) => known.set(id, member));
    else complete = false;
  }
  if (!complete && cached) return { ...cached.value, indexed };

  const value: PublicLeaderboard = {
    server: { name: guild.name, icon: guild.iconURL({ size: 128 }) },
    indexed,
    page,
    pages: Math.min(PUBLIC_MAX_PAGES, Math.max(1, Math.ceil(total / PUBLIC_PAGE_SIZE))),
    members: rows.map((row, index) => {
      const member = known.get(row.userId);
      return {
        position: (page - 1) * PUBLIC_PAGE_SIZE + index + 1,
        name: member?.displayName ?? (complete ? "Former member" : "Member"),
        avatar: member ? member.displayAvatarURL({ size: 64 }) : null,
        level: row.level,
      };
    }),
  };

  if (complete) {
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(key, { at: now, value });
  }
  return value;
}
