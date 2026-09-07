// The only file that holds INTERNAL_API_SECRET. It is imported exclusively
// from route handlers and server components, both of which run on the
// server, so the secret never reaches anything shipped to the browser.

export class ControlApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ControlApiError";
  }
}

export interface BotGuildSummary {
  id: string;
  name: string;
  icon: string | null;
  memberCount: number;
}

export interface BotChannel {
  id: string;
  name: string;
  type: number;
}

export interface BotRole {
  id: string;
  name: string;
  colour: string;
  assignable: boolean;
}

function baseUrl(): string {
  const url = process.env.CONTROL_API_URL;
  if (!url) {
    throw new Error("CONTROL_API_URL is not set. It should point at the bot's control API, e.g. http://bot:8081.");
  }
  return url.replace(/\/$/, "");
}

async function controlFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    throw new Error("INTERNAL_API_SECRET is not set. Copy .env.example to .env and fill it in.");
  }

  return fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${secret}`,
    },
    cache: "no-store",
  });
}

async function readJson<T>(res: Response, context: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ControlApiError(
      res.status,
      body || `The bot's control API rejected ${context} (${res.status}).`,
    );
  }
  return (await res.json()) as T;
}

export async function listBotGuilds(): Promise<BotGuildSummary[]> {
  const res = await controlFetch("/guilds");
  return readJson<BotGuildSummary[]>(res, "the guild list");
}

export async function getGuildChannels(guildId: string): Promise<BotChannel[]> {
  const res = await controlFetch(`/guilds/${encodeURIComponent(guildId)}/channels`);
  return readJson<BotChannel[]>(res, "the channel list");
}

export async function getGuildRoles(guildId: string): Promise<BotRole[]> {
  const res = await controlFetch(`/guilds/${encodeURIComponent(guildId)}/roles`);
  return readJson<BotRole[]>(res, "the role list");
}

/**
 * Shape assumed for the module state endpoint another agent is adding
 * concurrently (GET /guilds/:id/modules). Not yet confirmed against the bot's
 * actual implementation — see the handoff notes for what to reconcile if it
 * differs.
 */
export interface GuildModuleState {
  id: string;
  name: string;
  summary: string;
  enabled: boolean;
  settings: Record<string, unknown>;
  schema: Record<string, unknown>;
  commands: { name: string; description: string; enabled: boolean }[];
}

export async function getGuildModules(guildId: string): Promise<GuildModuleState[]> {
  const res = await controlFetch(`/guilds/${encodeURIComponent(guildId)}/modules`);
  return readJson<GuildModuleState[]>(res, "the module list");
}

export async function updateGuildModule(
  guildId: string,
  moduleId: string,
  patch: unknown,
): Promise<unknown> {
  const res = await controlFetch(
    `/guilds/${encodeURIComponent(guildId)}/modules/${encodeURIComponent(moduleId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  return readJson<unknown>(res, "the settings update");
}

export async function updateGuildCommand(
  guildId: string,
  name: string,
  patch: unknown,
): Promise<unknown> {
  const res = await controlFetch(
    `/guilds/${encodeURIComponent(guildId)}/commands/${encodeURIComponent(name)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  return readJson<unknown>(res, "the command update");
}

export async function reloadGuild(guildId: string): Promise<void> {
  const res = await controlFetch(`/guilds/${encodeURIComponent(guildId)}/reload`, {
    method: "POST",
  });
  if (!res.ok && res.status !== 202) {
    const body = await res.text().catch(() => "");
    throw new ControlApiError(res.status, body || `The bot rejected the reload request (${res.status}).`);
  }
}
