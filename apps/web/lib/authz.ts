import { prisma } from "@tier0/db";
import { auth } from "./auth";
import { fetchUserGuilds, refreshDiscordToken } from "./discord";
import { authorizedGuildIds } from "./permissions";
import { listBotGuilds } from "./control-api";
import {
  afterAuthzFailure,
  isTransientFailure,
  readAuthzCache,
  recordAuthzFailure,
  recordAuthzSuccess,
  type AuthzCacheEntry,
} from "./authz-cache";

/**
 * The one place that decides whether a signed-in user may configure a given
 * guild. Every API route and every guild-scoped page calls into this file
 * and none of them work it out again, because the rule itself
 * (MANAGE_GUILD, intersected with guilds the bot is actually in) only needs
 * to be right in one place.
 */

export interface AuthzOk {
  ok: true;
  userId: string;
  discordUserId: string;
}

export interface AuthzFail {
  ok: false;
  status: 401 | 403;
  message: string;
}

export type AuthzResult = AuthzOk | AuthzFail;

// Rendering one guild page runs this check several times over (the page, then
// each picker's route), and Discord rate limits /users/@me/guilds harshly
// enough that the uncached version 429s in ordinary use. The cost of the cache
// is that a permission revoked on Discord keeps working here for up to a
// minute, or up to 15 while Discord itself is failing; authz-cache.ts has the
// rules.
//
// Next.js bundles pages and route handlers separately, and each bundle gets its
// own copy of this module. State kept in a plain module variable is therefore
// per bundle, and a page and the API routes it calls would each ask Discord for
// themselves. The state lives on globalThis so every bundle shares one.
const shared = globalThis as typeof globalThis & {
  __tier0Authz?: {
    cache: Map<string, AuthzCacheEntry>;
    lookups: Map<string, Promise<Set<string>>>;
  };
};
const state = (shared.__tier0Authz ??= { cache: new Map(), lookups: new Map() });
const authorizedCache = state.cache;
const lookups = state.lookups;

interface DiscordAccountTokens {
  accessToken: string;
  discordUserId: string;
}

async function getValidAccessToken(userId: string): Promise<DiscordAccountTokens | null> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "discord" },
  });
  if (!account?.access_token) return null;

  const expiresAtMs = (account.expires_at ?? 0) * 1000;
  const stillValid = expiresAtMs > Date.now() + 30_000; // small buffer against clock skew

  if (stillValid) {
    return { accessToken: account.access_token, discordUserId: account.providerAccountId };
  }
  if (!account.refresh_token) return null;

  const refreshed = await refreshDiscordToken(account.refresh_token);
  await prisma.account.update({
    where: { id: account.id },
    data: {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? account.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + refreshed.expires_in,
    },
  });
  return { accessToken: refreshed.access_token, discordUserId: account.providerAccountId };
}

/**
 * Guild ids the signed-in user may configure: they hold MANAGE_GUILD there,
 * and the bot is actually a member. A Discord session that cannot be
 * refreshed gives an empty set and no exception, because from the caller's
 * side that just means nothing is authorized right now.
 */
export async function getAuthorizedGuildIds(userId: string): Promise<Set<string>> {
  const cached = authorizedCache.get(userId);
  const read = readAuthzCache(cached, Date.now());
  if (read.kind === "use") return read.guildIds;
  if (read.kind === "fail") throw read.error;

  // A page and each picker on it ask at the same moment, and none of them has an
  // answer cached yet right after a start. Without sharing one lookup they all go
  // to Discord together, which is what trips its rate limit.
  const running = lookups.get(userId);
  if (running) return running;
  const lookup = lookUpGuildIds(userId, cached).finally(() => lookups.delete(userId));
  lookups.set(userId, lookup);
  return lookup;
}

async function lookUpGuildIds(userId: string, cached: AuthzCacheEntry | undefined): Promise<Set<string>> {
  try {
    const tokens = await getValidAccessToken(userId);
    if (!tokens) return new Set();

    const [userGuilds, botGuilds] = await Promise.all([
      fetchUserGuildsOnce(tokens.accessToken),
      listBotGuilds(),
    ]);

    const authorized = authorizedGuildIds(
      userGuilds,
      botGuilds.map((g) => g.id),
    );
    authorizedCache.set(userId, recordAuthzSuccess(authorized, Date.now()));
    return authorized;
  } catch (error) {
    // A refusal from Discord (revoked token, no access) ends the grant now. Only
    // "could not find out" failures may be covered by the last good answer.
    if (!isTransientFailure(error)) {
      authorizedCache.delete(userId);
      throw error;
    }
    const entry = recordAuthzFailure(cached, error, Date.now());
    authorizedCache.set(userId, entry);
    const fallback = afterAuthzFailure(entry, Date.now());
    if (fallback.kind === "use") return fallback.guildIds;
    throw error;
  }
}

/** Drops a user's cached grants so a permission change can be picked up early. */
export function forgetAuthorizedGuilds(userId: string): void {
  authorizedCache.delete(userId);
}

/**
 * The security boundary itself. Call this at the top of every route handler
 * and every page that touches a specific guild, before doing anything else
 * with that guild's id. A guild id that isn't in the caller's authorized set
 * gets a 403, whether or not the UI would ever have offered it.
 */
export async function requireGuildAccess(guildId: string): Promise<AuthzResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, status: 401, message: "Sign in to continue." };
  }

  const [authorized, account] = await Promise.all([
    getAuthorizedGuildIds(session.user.id),
    prisma.account.findFirst({ where: { userId: session.user.id, provider: "discord" } }),
  ]);

  if (!authorized.has(guildId)) {
    return {
      ok: false,
      status: 403,
      message:
        "Your Discord account needs the Manage Server permission on that server (a Discord permission set on roles under Server Settings), and the bot has to be a member of it.",
    };
  }

  return { ok: true, userId: session.user.id, discordUserId: account?.providerAccountId ?? "" };
}

/** Discord asks for waits this short when two requests land in the same second. */
const SHORT_RETRY_MAX_MS = 3_000;

/**
 * Asks Discord for the user's servers, and once more if it says to try again in
 * a moment. A one-second limit is a burst, not a ban, and failing the whole
 * lookup for it would lock the person out for the length of the failure cache.
 */
async function fetchUserGuildsOnce(accessToken: string) {
  try {
    return await fetchUserGuilds(accessToken);
  } catch (error) {
    const wait = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs;
    if ((error as { status?: unknown } | null)?.status !== 429 || typeof wait !== "number" || wait > SHORT_RETRY_MAX_MS) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, wait + 100));
    return fetchUserGuilds(accessToken);
  }
}
