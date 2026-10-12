// Talks to Discord's own API, never the bot's control API. Kept separate from
// control-api.ts because the two use entirely different credentials: this one
// carries a signed-in user's OAuth token, that one carries the shared internal
// secret.

const DISCORD_API = "https://discord.com/api/v10";

/** The bit that matters for dashboard access. Owners have it implicitly. */

export interface DiscordUserGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
}

export interface DiscordTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export class DiscordApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** How long Discord asked callers to wait, when it said. */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "DiscordApiError";
  }
}


/** The guilds the signed-in user belongs to, as Discord reports them. */
export async function fetchUserGuilds(accessToken: string): Promise<DiscordUserGuild[]> {
  const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const seconds = Number(res.headers.get("retry-after"));
    throw new DiscordApiError(
      res.status,
      `Discord rejected the guild list request (${res.status})`,
      Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined,
    );
  }
  return (await res.json()) as DiscordUserGuild[];
}

/** Exchanges a refresh token for a new access token when the stored one has expired. */
export async function refreshDiscordToken(refreshToken: string): Promise<DiscordTokenResponse> {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET must be set to refresh a token.");
  }

  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new DiscordApiError(res.status, `Discord rejected the token refresh (${res.status})`);
  }
  return (await res.json()) as DiscordTokenResponse;
}
