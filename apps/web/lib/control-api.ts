// The only file that holds INTERNAL_API_SECRET. It is imported exclusively
// from route handlers and server components, both of which run on the
// server, so the secret never reaches anything shipped to the browser.

import type { ModuleCategory } from "@tier0/core";

export interface FieldValidationError {
  path: string;
  message: string;
}

export class ControlApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /**
     * The per-field validation errors from a 400, when the response body was
     * shaped as one. Kept apart from `message` so a route handler can forward
     * them to the dashboard instead of flattening them into a single string
     * the settings form has no field to attach them to.
     */
    public readonly fieldErrors?: FieldValidationError[],
    options?: ErrorOptions,
  ) {
    super(message, options);
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
  color: string;
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

  try {
    return await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${secret}`,
      },
      cache: "no-store",
    });
  } catch (cause) {
    // fetch rejects rather than resolving when the bot is not listening, which
    // reaches a server component as an unhandled "fetch failed" unless it is
    // turned into something callers can recognize.
    throw new ControlApiError(503, "The dashboard could not reach the bot.", undefined, { cause });
  }
}

async function readJson<T>(res: Response, context: string): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const fieldErrors = parseFieldErrors(text);
    const message = fieldErrors
      ? `The bot's control API rejected ${context} (${res.status}).`
      : text || `The bot's control API rejected ${context} (${res.status}).`;
    throw new ControlApiError(res.status, message, fieldErrors);
  }
  return (await res.json()) as T;
}

/** The bot reports validation failures as `{ errors: [{ path, message }] }`. */
function parseFieldErrors(text: string): FieldValidationError[] | undefined {
  try {
    const body = JSON.parse(text) as { errors?: unknown };
    if (!Array.isArray(body.errors)) return undefined;
    return body.errors.filter((e): e is FieldValidationError => isFieldError(e));
  } catch {
    return undefined;
  }
}

function isFieldError(value: unknown): value is FieldValidationError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FieldValidationError>;
  return typeof candidate.path === "string" && typeof candidate.message === "string";
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

export interface GuildModuleState {
  id: string;
  name: string;
  summary: string;
  /** Which dashboard section this module's card is grouped under. */
  category: ModuleCategory;
  enabled: boolean;
  settings: Record<string, unknown>;
  schema: Record<string, unknown>;
  commands: GuildCommandState[];
}

export interface GuildCommandState {
  name: string;
  description: string;
  /** False only when an operator has hidden this command on this server. */
  enabled: boolean;
  /** Empty means anyone may run it. */
  allowRoles: string[];
  /** Empty means it works in every channel. */
  denyChannels: string[];
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
