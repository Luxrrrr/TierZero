// The only file that holds INTERNAL_API_SECRET. It is imported exclusively
// from route handlers and server components, both of which run on the
// server, so the secret never reaches anything shipped to the browser.

import type { MessageBody, ModuleCategory, ModuleNotice, ResponseTemplate, ActionDescription, RowDescription, RowStatus } from "@tier0/core";
import type { PublicLeaderboard } from "./leaderboard";
import { failureFromBody, plainSystemText } from "./bot-errors";
import { segment } from "./path-segment";

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
     * them to the dashboard: flattened into one string, they would leave the
     * settings form nothing to show under each field.
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
  /** What the bot may do server-wide, by Discord's permission names. Null when the bot has not said. */
  permissions?: string[] | null;
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

/**
 * The bot refuses with `{ error }` or, for settings, `{ errors: [{ path, message }] }`.
 * Either way the message that travels on is one an owner can read; the bot's
 * own wording is kept only when it already is a sentence, and what it was is
 * still in the bot's log.
 */
async function readJson<T>(res: Response, _context: string): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const failure = failureFromBody(res.status, text);
    throw new ControlApiError(res.status, failure.message, failure.fieldErrors);
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

export interface GuildModuleState {
  id: string;
  name: string;
  summary: string;
  /** Which dashboard section this module's card is grouped under. */
  category: ModuleCategory;
  /** The part of the dashboard that hosts this module's settings, when it is not its own page. */
  area: "moderation" | "tickets" | null;
  /** Part of the bot itself: on everywhere, with no switch, and left out of the feature lists. */
  alwaysOn: boolean;
  /** Discord permissions the feature cannot work without, by Discord's names. */
  requires?: string[];
  enabled: boolean;
  settings: Record<string, unknown>;
  /** Stored durations that read as their schema's minimum, because the saved value is below it. */
  raised?: { path: string; min: string }[];
  schema: Record<string, unknown>;
  /** Which list settings carry a status line or actions, keyed by schema path. */
  rows: Record<string, RowDescription>;
  /** Buttons for the whole feature, drawn at the top of its settings page. */
  actions?: ActionDescription[];
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
  /** When not empty, the only channels it works in. */
  allowChannels?: string[];
  /** The permission bits Discord needs a member to have to see it. Null means everyone. */
  defaultPermissions: string | null;
  /** True when the command answers privately unless an owner changes it. */
  privateByDefault: boolean;
  /** True when the command decides per reply, so there is no single private or public choice. */
  repliesVary: boolean;
  /** What an owner can rewrite about the command's reply, or null when it has no reply that can be. */
  response: ResponseTemplate | null;
  /** An owner's permission, "everyone", or null to keep the command's own. */
  permissions: string | null;
  /** True for private, false for public, null to keep the command's own. */
  ephemeral: boolean | null;
  /** The reply the owner wrote, sent in place of the command's own, or null to keep it. */
  customReply: MessageBody | null;
  /** The parts of a slash command that has them, such as /ticket close. Absent from an older bot. */
  subcommands?: GuildSubcommandState[];
}

/**
 * One part of a command. Discord shows every part to anyone who can see the
 * command, so these are enforced by the bot, which refuses a part that is off
 * or limited with a message.
 */
export interface GuildSubcommandState {
  /** As typed after the command: `close`, or `tag add` inside a group. */
  name: string;
  /** The override key, the command and the part: `ticket close`. */
  key: string;
  description: string;
  enabled: boolean;
  allowRoles: string[];
  denyChannels: string[];
  allowChannels: string[];
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
    `/guilds/${encodeURIComponent(guildId)}/modules/${segment(moduleId)}`,
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
    `/guilds/${encodeURIComponent(guildId)}/commands/${segment(name)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  return readJson<unknown>(res, "the command update");
}

/** What the bot last registered with Discord for a server. */
export interface CommandSyncStatus {
  registered: number | null;
  pending: boolean;
  failed: string | null;
}

export async function getCommandSync(guildId: string): Promise<CommandSyncStatus> {
  const res = await controlFetch(`/guilds/${encodeURIComponent(guildId)}/command-sync`);
  return readJson<CommandSyncStatus>(res, "the command status");
}

export async function reloadGuild(guildId: string): Promise<void> {
  const res = await controlFetch(`/guilds/${encodeURIComponent(guildId)}/reload`, {
    method: "POST",
  });
  if (!res.ok && res.status !== 202) {
    const body = await res.text().catch(() => "");
    throw new ControlApiError(res.status, failureFromBody(res.status, body).message);
  }
}

export interface BotEmoji {
  id: string;
  name: string;
  animated: boolean;
  url: string;
}

/** The server's own custom emoji, for the emoji picker. */
export async function getGuildEmojis(guildId: string): Promise<BotEmoji[]> {
  const res = await controlFetch(`/guilds/${encodeURIComponent(guildId)}/emojis`);
  return readJson<BotEmoji[]>(res, "the emoji list");
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
    `/guilds/${encodeURIComponent(guildId)}/modules/${segment(moduleId)}` +
      `/rows/${segment(listPath)}/status`,
  );
  return readJson(res, "the row status");
}

export async function runRowAction(
  guildId: string,
  moduleId: string,
  rowPath: string,
  actionId: string,
  input: unknown,
  actor: string,
): Promise<RowActionOutcome> {
  const res = await controlFetch(
    `/guilds/${encodeURIComponent(guildId)}/modules/${segment(moduleId)}` +
      `/rows/${segment(rowPath)}/actions/${segment(actionId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input, actor }),
    },
  );
  const outcome = await readJson<RowActionOutcome>(res, "the action");
  // A module's answer can carry a raw network error from whatever it called.
  return { ...outcome, message: plainSystemText(String(outcome.message ?? "")) };
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

/**
 * Calls the message library part of the control API. The bot's own answer,
 * status included, goes back to the caller, so a refusal such as "that name is
 * taken" reaches the page in the words the bot used.
 */
export async function messagesRequest(
  guildId: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ModReply> {
  const res = await controlFetch(`/guilds/${encodeURIComponent(guildId)}/messages${path ? `/${path}` : ""}`, {
    method: init.method ?? "GET",
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(MOD_TIMEOUT_MS),
  });
  const body: unknown = await res.json().catch((error: unknown) => {
    if (isTimeout(error)) throw new ControlApiError(504, "The bot took too long to answer. Try again in a moment.");
    return {};
  });
  return { status: res.status, body };
}

/** What the ticket routes send as a file rather than JSON: the transcript downloads. */
const TICKET_FILE_TYPES = ["text/html", "text/plain"];

/**
 * Calls the ticket workspace's part of the control API. Like `modRequest`, the
 * bot's own answer comes back with its status, so a refusal reaches the page in
 * the bot's words. A transcript comes back as a file.
 */
export async function ticketsRequest(
  guildId: string,
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ModReply> {
  const res = await controlFetch(`/guilds/${encodeURIComponent(guildId)}/tickets/${path}`, {
    method: init.method ?? "GET",
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    // The caller's own signal ends a held read when the browser goes away, which lets the bot give its place back.
    signal: init.signal ? AbortSignal.any([AbortSignal.timeout(init.timeoutMs ?? MOD_TIMEOUT_MS), init.signal]) : AbortSignal.timeout(init.timeoutMs ?? MOD_TIMEOUT_MS),
  });
  const contentType = res.headers.get("content-type") ?? "";
  const timedOut = (error: unknown) => {
    if (isTimeout(error)) throw new ControlApiError(504, "The bot took too long to answer. Try again in a moment.");
  };
  if (res.ok && TICKET_FILE_TYPES.some((type) => contentType.startsWith(type))) {
    const text = await res.text().catch((error: unknown) => {
      timedOut(error);
      return "";
    });
    return { status: res.status, body: null, file: { text, contentType, disposition: res.headers.get("content-disposition") } };
  }
  const body: unknown = await res.json().catch((error: unknown) => {
    timedOut(error);
    return {};
  });
  return { status: res.status, body };
}

/**
 * One page of a server's public leaderboard, or null when the server has not
 * switched the page on. Called for visitors who are not signed in, so it is
 * kept to the bot's read-only route and a short timeout.
 */
export async function getPublicLeaderboard(guildId: string, page: number): Promise<PublicLeaderboard | null> {
  const res = await controlFetch(`/guilds/${encodeURIComponent(guildId)}/leaderboard?page=${page}`, {
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 404) return null;
  return readJson<PublicLeaderboard>(res, "the leaderboard");
}

/** The lines a module shows above its settings, which depend on what this server has saved. */
export async function getModuleNotices(guildId: string, moduleId: string): Promise<ModuleNotice[]> {
  const res = await controlFetch(`/guilds/${encodeURIComponent(guildId)}/modules/${segment(moduleId)}/notices`, {
    signal: AbortSignal.timeout(5_000),
  });
  return (await readJson<{ notices: ModuleNotice[] }>(res, "the notices")).notices;
}

export async function runModuleAction(
  guildId: string,
  moduleId: string,
  actionId: string,
  input: unknown,
  actor: string,
): Promise<RowActionOutcome> {
  const res = await controlFetch(
    `/guilds/${encodeURIComponent(guildId)}/modules/${segment(moduleId)}` +
      `/actions/${segment(actionId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input, actor }),
    },
  );
  const outcome = await readJson<RowActionOutcome>(res, "the action");
  return { ...outcome, message: plainSystemText(String(outcome.message ?? "")) };
}

export interface BotPresence {
  status: "online" | "idle" | "dnd" | "invisible";
  activityType: "none" | "playing" | "watching" | "listening" | "competing" | "custom";
  activityText: string;
}

export interface BotProfile {
  id: string | null;
  name: string | null;
  /** The bot's own picture, at a size the dashboard can show. */
  avatarUrl: string | null;
  hasAvatar: boolean;
  presence: BotPresence;
}

export interface BotProfileResult {
  presence: "saved";
  name: "unchanged" | "changed" | { failed: string };
  avatar: "unchanged" | "changed" | "removed" | { failed: string };
}

export async function getBotProfile(): Promise<BotProfile> {
  const res = await controlFetch("/instance/profile");
  return readJson<BotProfile>(res, "the bot's profile");
}

/** `avatar` is a data address, null to take the picture off, or left out to keep it. */
export async function saveBotProfile(change: { presence: BotPresence; name?: string; avatar?: string | null }): Promise<{ result: BotProfileResult; profile: BotProfile }> {
  const res = await controlFetch("/instance/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(change) });
  return readJson(res, "the bot's profile");
}
