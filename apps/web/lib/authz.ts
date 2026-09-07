import { prisma } from "@tier0/db";
import { auth } from "./auth";
import { fetchUserGuilds, hasManageGuild, refreshDiscordToken } from "./discord";
import { listBotGuilds } from "./control-api";

/**
 * The one place that decides whether a signed-in user may configure a given
 * guild. Every API route and every guild-scoped page calls into this file
 * rather than re-deriving the check, because the rule itself
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
 * and the bot is actually a member. Returns an empty set rather than
 * throwing when the user's Discord session can't be refreshed, since that
 * just means "nothing is authorized right now" from the caller's point of
 * view.
 */
export async function getAuthorizedGuildIds(userId: string): Promise<Set<string>> {
  const tokens = await getValidAccessToken(userId);
  if (!tokens) return new Set();

  const [userGuilds, botGuilds] = await Promise.all([
    fetchUserGuilds(tokens.accessToken),
    listBotGuilds(),
  ]);

  const botGuildIds = new Set(botGuilds.map((g) => g.id));
  const authorized = new Set<string>();
  for (const guild of userGuilds) {
    if (botGuildIds.has(guild.id) && hasManageGuild(guild.permissions)) {
      authorized.add(guild.id);
    }
  }
  return authorized;
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
      message: "You need the Manage Server permission there, and the bot needs to be in it.",
    };
  }

  return { ok: true, userId: session.user.id, discordUserId: account?.providerAccountId ?? "" };
}
