import type { Guild, GuildMember } from "discord.js";
import type { MemberSearchHit, UserRef } from "@tier0/shared-moderation";
import { withinBudget } from "./names.js";

/** Most hits returned; the rest are only counted, so the dashboard can say to keep typing. */
export const FIND_LIMIT = 25;
const DISCORD_SEARCH_LIMIT = 25;
/** One full member fetch per server in this long, however many searches ask for it. */
const FULL_FETCH_EVERY_MS = 10 * 60_000;
/** Below this share of the server's members in the cache, the cache alone cannot answer a search. */
const CACHE_COMPLETE_SHARE = 0.95;
const SEPARATORS = /[\s_.-]+/g;

/** Lowercase, accents removed, so "Zoë" and "zoe" are the same name. */
function fold(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** The form names are compared in: folded, with spaces and underscores taken out. */
export function squash(text: string): string {
  return fold(text).replace(/[\s_]+/g, "");
}

/** 0 exact, 1 starts with, 2 a word starts with it, 3 contains it, null no match. */
export function rankName(name: string, needle: string): number | null {
  if (needle === "") return null;
  const flat = squash(name);
  if (flat === needle) return 0;
  if (flat.startsWith(needle)) return 1;
  const words = fold(name).split(SEPARATORS).filter((word) => word !== "");
  for (let start = 1; start < words.length; start++) {
    if (words.slice(start).join("").startsWith(needle)) return 2;
  }
  if (flat.includes(needle)) return 3;
  return null;
}

export interface ParsedQuery {
  /** The squashed text to look for in names. */
  needle: string;
  /** A user id given directly, as digits or a mention. */
  id: string | null;
}

/** Understands a pasted id, a mention, `@name` and the old `name#1234` form. */
export function parseQuery(raw: string): ParsedQuery {
  const text = raw.trim();
  const mention = /^<@!?(\d{17,20})>$/.exec(text);
  if (mention) return { needle: "", id: mention[1]! };
  if (/^\d{17,20}$/.test(text)) return { needle: squash(text), id: text };
  const withoutTag = text.replace(/^@/, "").replace(/#\d{4}$/, "");
  return { needle: squash(withoutTag), id: null };
}

function namesOf(member: GuildMember): string[] {
  const names = [member.user.username];
  if (member.user.globalName) names.push(member.user.globalName);
  if (member.nickname) names.push(member.nickname);
  return names;
}

function bestRank(member: GuildMember, needle: string): number | null {
  let best: number | null = null;
  for (const name of namesOf(member)) {
    const rank = rankName(name, needle);
    if (rank !== null && (best === null || rank < best)) best = rank;
  }
  return best;
}

function refOf(member: GuildMember): UserRef {
  return {
    userId: member.id,
    name: member.displayName,
    avatarUrl: member.displayAvatarURL({ size: 64 }),
    inServer: true,
  };
}

function hitOf(member: GuildMember): MemberSearchHit {
  return { user: refOf(member), username: member.user.username };
}

interface FullFetch {
  startedAt: number;
  running: Promise<unknown> | null;
}
const fullFetches = new Map<string, FullFetch>();

function cacheIsIncomplete(guild: Guild): boolean {
  const total = guild.memberCount;
  return typeof total === "number" && total > 0 && guild.members.cache.size < total * CACHE_COMPLETE_SHARE;
}

/**
 * Loads the whole member list into the library's cache, at most once per
 * server every ten minutes. It is one gateway request however large the
 * server is, which keeps it far from the gateway's send limit. A failed
 * attempt is retried after a minute rather than ten.
 */
function startFullFetch(guild: Guild, now: number): Promise<unknown> | null {
  const state = fullFetches.get(guild.id);
  if (state && (state.running || now - state.startedAt < FULL_FETCH_EVERY_MS)) return null;
  const entry: FullFetch = { startedAt: now, running: null };
  entry.running = Promise.resolve(guild.members.fetch())
    .catch(() => {
      entry.startedAt = now - FULL_FETCH_EVERY_MS + 60_000;
    })
    .finally(() => {
      entry.running = null;
    });
  fullFetches.set(guild.id, entry);
  return entry.running;
}

/** Forgets what was fetched, so a test can start from nothing. */
export function resetMemberFetches(): void {
  fullFetches.clear();
}

export interface FindOptions {
  allowBots?: boolean;
  limit?: number;
  /** Used instead of the clock, for tests. */
  now?: number;
}

export interface FindResult {
  hits: MemberSearchHit[];
  /** How many more matched beyond the ones returned. */
  more: number;
}

/**
 * Members whose username, display name or nickname contains the text, best
 * match first. Discord's own search only matches the start of a name, so the
 * library's cache is searched as well and the two are merged. When the cache
 * holds only part of a large server, the full member list is fetched once in
 * a while and searched too.
 */
export async function findMembers(guild: Guild, rawQuery: string, options: FindOptions = {}): Promise<FindResult> {
  const limit = options.limit ?? FIND_LIMIT;
  const { needle, id } = parseQuery(rawQuery);
  if (needle === "" && id === null) return { hits: [], more: 0 };

  const ranked = new Map<string, { member: GuildMember; rank: number }>();
  const consider = (member: GuildMember, rank: number | null, fallback: number) => {
    if (member.user.bot && !options.allowBots) return;
    const use = rank ?? fallback;
    const seen = ranked.get(member.id);
    if (!seen || use < seen.rank) ranked.set(member.id, { member, rank: use });
  };

  if (id !== null) {
    const exact = guild.members.cache.get(id) ?? (await withinBudget(guild.members.fetch(id).catch(() => null), null));
    if (exact) consider(exact, -1, -1);
  }

  const incomplete = cacheIsIncomplete(guild);
  let discordSearch: Promise<Iterable<GuildMember> | null> | null = null;
  if (incomplete && needle !== "") {
    discordSearch = withinBudget(
      guild.members.search({ query: rawQuery.trim().replace(/^@/, "").replace(/#\d{4}$/, ""), limit: DISCORD_SEARCH_LIMIT })
        .then((found) => found.values() as Iterable<GuildMember>)
        .catch(() => null),
      null,
    );
    const loading = startFullFetch(guild, options.now ?? Date.now());
    // The search that starts a fetch waits for it, within the usual budget; searches while
    // it runs, or soon after, use whatever the cache holds.
    if (loading) await withinBudget(loading, null);
  }

  if (needle !== "") {
    for (const member of guild.members.cache.values()) {
      const rank = bestRank(member, needle);
      if (rank !== null) consider(member, rank, 3);
    }
  }
  if (discordSearch) {
    const found = await discordSearch;
    if (found) {
      for (const member of found) consider(member, bestRank(member, needle), 3);
    }
  }

  const sorted = [...ranked.values()].sort(
    (a, b) => a.rank - b.rank || a.member.displayName.localeCompare(b.member.displayName),
  );
  return {
    hits: sorted.slice(0, limit).map((entry) => hitOf(entry.member)),
    more: Math.max(0, sorted.length - limit),
  };
}
