// The only file that holds INTERNAL_API_SECRET. It is imported exclusively
// from route handlers and server components, both of which run on the
// server, so the secret never reaches anything shipped to the browser.

import type { ModuleCategory, RowDescription, RowStatus } from "@tier0/core";

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
     * them to the dashboard. Flattening them into a single string loses the
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
  /** Discord's icon hash, not a URL: see `guildIconUrl`. Null without one. */
  icon: string | null;
  memberCount: number;
}

export interface BotChannel {
  id: string;
  name: string;
  type: number;
  /** The category a channel sits under, which the picker groups by. Null at the top level. */
  parentId: string | null;
  position: number;
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
    if (isTimeout(cause)) {
      throw new ControlApiError(504, "The bot took too long to answer. Try again in a moment.", undefined, { cause });
    }
    // fetch rejects outright when the bot is not listening, and that
    // reaches a server component as an unhandled "fetch failed" unless it is
    // turned into something callers can recognize.
    throw new ControlApiError(503, "The dashboard could not reach the bot.", undefined, { cause });
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
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
  /** The part of the dashboard that hosts this module's settings, when it is not its own page. */
  area: "moderation" | null;
  enabled: boolean;
  settings: Record<string, unknown>;
  schema: Record<string, unknown>;
  /** Which list settings carry a status line or actions, keyed by schema path. */
  rows: Record<string, RowDescription>;
  commands: GuildCommandState[];
}

export interface GuildCommandState {
  name: string;
  description: string;
  /** A slash command, or an entry in the right-click menu of a member or a message. */
  kind: "slash" | "user" | "message";
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

export interface RowActionOutcome {
  ok: boolean;
  message: string;
}

export async function getRowStatuses(
  guildId: string,
  moduleId: string,
  listPath: string,
): Promise<{ statuses: (RowStatus | null)[] }> {
  const res = await controlFetch(
    `/guilds/${encodeURIComponent(guildId)}/modules/${encodeURIComponent(moduleId)}` +
      `/rows/${encodeURIComponent(listPath)}/status`,
  );
  return readJson(res, "the row status");
}

export async function runRowAction(
  guildId: string,
  moduleId: string,
  rowPath: string,
  actionId: string,
  input: unknown,
): Promise<RowActionOutcome> {
  const res = await controlFetch(
    `/guilds/${encodeURIComponent(guildId)}/modules/${encodeURIComponent(moduleId)}` +
      `/rows/${encodeURIComponent(rowPath)}/actions/${encodeURIComponent(actionId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input }),
    },
  );
  return readJson<RowActionOutcome>(res, "the action");
}

const MOD_TIMEOUT_MS = 15_000;

export interface ModReply {
  status: number;
  body: unknown;
  /** Set instead of a JSON body when the bot answers with a download, such as the CSV export. */
  file?: { text: string; contentType: string; disposition: string | null };
}

/**
 * Calls the mod dashboard's part of the control API and hands back the bot's
 * own answer, status included, so a refusal (403, 404) reaches the page as it
 * was said and is not flattened into a generic failure.
 */
export async function modRequest(
  guildId: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ModReply> {
  const res = await controlFetch(`/guilds/${encodeURIComponent(guildId)}/mod/${path}`, {
    method: init.method ?? "GET",
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    // A bot stuck on a slow Discord call would otherwise hold the page render
    // open until the browser gave up, with nothing on screen to say why.
    signal: AbortSignal.timeout(MOD_TIMEOUT_MS),
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.startsWith("text/csv")) {
    const text = await res.text().catch((error: unknown) => {
      if (isTimeout(error)) throw new ControlApiError(504, "The bot took too long to answer. Try again in a moment.");
      return "";
    });
    return {
      status: res.status,
      body: null,
      file: { text, contentType, disposition: res.headers.get("content-disposition") },
    };
  }
  const body: unknown = await res.json().catch((error: unknown) => {
    // The timeout also covers reading the body; an empty object would pass
    // for a successful empty answer.
    if (isTimeout(error)) throw new ControlApiError(504, "The bot took too long to answer. Try again in a moment.");
    return {};
  });
  return { status: res.status, body };
}
