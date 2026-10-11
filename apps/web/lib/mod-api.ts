import type {
  AuditDto,
  InfractionDto,
  MemberProfile,
  MemberSummary,
  Page,
  StaffDto,
  StatsDto,
} from "@tier0/core";
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

export const modStats = (guildId: string, days = 30) =>
  read<StatsDto>(guildId, `stats${query({ days })}`);

export const modStaff = (guildId: string) => read<StaffDto[]>(guildId, "staff");
