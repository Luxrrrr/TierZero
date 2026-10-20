import type {
  AppealDetailDto,
  AppealListDto,
  RaidStatusDto,
  AuditDto,
  LoggedMessageDto,
  ServerLogEntryDto,
  StaffRole,
  InfractionDto,
  MemberProfile,
  MemberSummary,
  Page,
  StaffDto,
  StatsDto,
} from "@tier0/shared-moderation";
import { ControlApiError, modRequest } from "./control-api";

/**
 * Typed reads of the mod dashboard's data, for server components. Writes go
 * through the browser to `/api/guilds/:id/mod/...`, which adds who is making
 * them. A refusal from the bot becomes a ControlApiError carrying its status.
 */

async function read<T>(guildId: string, path: string): Promise<T> {
  const { status, body } = await modRequest(guildId, path);
  if (status < 200 || status >= 300) {
    const message = (body as { error?: string } | null)?.error ?? `The bot answered ${status}.`;
    throw new ControlApiError(status, message);
  }
  return body as T;
}

function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export interface MemberListParams {
  q?: string;
  sort?: "recent" | "most" | "name" | "notes";
  filter?: "all" | "active" | "notes" | "recent";
  page?: number;
  pageSize?: number;
}

export const modMembers = (guildId: string, params: MemberListParams = {}) =>
  read<Page<MemberSummary>>(guildId, `members${query({ ...params })}`);

export const modProfile = (guildId: string, userId: string) =>
  read<MemberProfile>(guildId, `members/${encodeURIComponent(userId)}`);

export interface InfractionListParams {
  action?: string;
  moderatorId?: string;
  userId?: string;
  status?: "active" | "voided" | "all";
  /** What the entry is doing now: all, onrecord, inforce, expired or removed. */
  state?: "all" | "onrecord" | "inforce" | "expired" | "removed";
  /** Who made the entry: staff by hand, or automod. Omitted means both. */
  source?: "all" | "manual" | "automod";
  q?: string;
  page?: number;
  pageSize?: number;
}

export const modInfractions = (guildId: string, params: InfractionListParams = {}) =>
  read<Page<InfractionDto>>(guildId, `infractions${query({ ...params })}`);

export interface AuditListParams {
  kind?: string;
  actorId?: string;
  targetUserId?: string;
  /** Only entries about this case. */
  infractionId?: number;
  /** ISO timestamps bounding the entry time, inclusive. */
  since?: string;
  until?: string;
  /** Text to find in the entry summary. */
  q?: string;
  page?: number;
  pageSize?: number;
}

export const modAudit = (guildId: string, params: AuditListParams = {}) =>
  read<Page<AuditDto>>(guildId, `audit${query({ ...params })}`);

/** One of: `days` for the last N days, `range: "all"`, or `from` and `to` as `YYYY-MM-DD` UTC days. */
export interface StatsRangeParams {
  days?: number;
  range?: "all";
  from?: string;
  to?: string;
}

export const modStats = (guildId: string, params: StatsRangeParams | number = 30) =>
  read<StatsDto>(guildId, `stats${query(typeof params === "number" ? { days: params } : { ...params })}`);

export const modStaff = (guildId: string) => read<StaffDto[]>(guildId, "staff");

/** How much each log the Danger zone can delete holds, and how many notes stay. Owner only; called from the server. */
export interface DangerCounts {
  "mod-logs": number;
  "staff-activity": number;
  "server-events": number;
  "saved-messages": number;
  notes: number;
}

export const modDangerCounts = (guildId: string) => read<DangerCounts>(guildId, "danger");

export interface MessageLogParams {
  q?: string;
  author?: string;
  message?: string;
  channel?: string;
  since?: string;
  until?: string;
  state?: string;
  page?: number;
  pageSize?: number;
}

/** What the message log tab shows, plus what it needs to explain an empty list. */
export interface MessageLogResult extends Page<LoggedMessageDto> {
  logEnabled: boolean;
  days: number;
  channels: { id: string; name: string }[];
}

/**
 * The message log as one staff member may see it. The bot only returns channels this person can read
 * in Discord, so it has to be told who is asking. This is called from the server with the signed-in
 * session, never from the browser.
 */
export const modMessages = (guildId: string, params: MessageLogParams, viewer: { discordUserId: string; role: StaffRole }) =>
  read<MessageLogResult>(
    guildId,
    `messages${query({ ...params, viewer: viewer.discordUserId, owner: viewer.role === "owner" ? "1" : "0", role: viewer.role })}`,
  );

export interface ServerLogParams {
  q?: string;
  category?: string;
  type?: string;
  member?: string;
  channel?: string;
  since?: string;
  until?: string;
  page?: number;
  pageSize?: number;
}

/** What the Events view of Server logs shows, plus what it needs to label its filters and explain an empty list. */
export interface ServerLogResult extends Page<ServerLogEntryDto> {
  logEnabled: boolean;
  days: number;
  /** Which kinds of event the server is saving. */
  recording: Record<string, boolean>;
  channels: { id: string; name: string }[];
  /** Entries per category under every other filter. */
  counts: Record<string, number>;
}

/** The server log as one staff member may see it. Called from the server with the signed-in session, never the browser. */
export const modServerLog = (guildId: string, params: ServerLogParams, viewer: { discordUserId: string; role: StaffRole }) =>
  read<ServerLogResult>(
    guildId,
    `server-logs${query({ ...params, viewer: viewer.discordUserId, owner: viewer.role === "owner" ? "1" : "0", role: viewer.role })}`,
  );

export interface AppealListParams {
  status?: "pending" | "accepted" | "denied" | "all";
  page?: number;
  pageSize?: number;
}

/** Ban appeals, pending ones by default, with the pending count whatever the filter. */
export const modAppeals = (guildId: string, params: AppealListParams = {}) =>
  read<AppealListDto>(guildId, `appeals${query({ ...params })}`);

/** One appeal with the member's whole record and notes, for deciding it. */
export const modAppeal = (guildId: string, appealId: number) =>
  read<AppealDetailDto>(guildId, `appeals/${encodeURIComponent(String(appealId))}`);

/** What is locked, what can be, and the join-rate alert, for the Raid tools tab. */
export const modRaid = (guildId: string) => read<RaidStatusDto>(guildId, "raid");
