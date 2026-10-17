import { APPEAL_LIMITS, isAppealStatus, type AppealDto, type AppealStatus } from "@tier0/core";

/**
 * Query handling and wording for the Appeals tab. No React or Next.js here,
 * so the rules can be tested on their own and used from server and client.
 */

export type AppealFilter = AppealStatus | "all";

export const APPEAL_FILTERS: { value: AppealFilter; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "accepted", label: "Accepted" },
  { value: "denied", label: "Denied" },
  { value: "all", label: "All" },
];

export const APPEALS_PAGE_SIZE = 25;

export interface AppealsQuery {
  status: AppealFilter;
  page: number;
  /** The appeal open beside the list, from `?appeal=`. */
  appeal: number | null;
}

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function positiveInt(text: string): number | null {
  if (!/^[0-9]{1,9}$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value > 0 ? value : null;
}

/** Anything unrecognised falls back to the defaults, so a hand-edited link still opens the tab. */
export function parseAppealsQuery(raw: RawParams): AppealsQuery {
  const status = first(raw.status);
  return {
    status: status === "all" || isAppealStatus(status) ? status : "pending",
    page: positiveInt(first(raw.page)) ?? 1,
    appeal: positiveInt(first(raw.appeal)),
  };
}

export function appealsApiParams(query: AppealsQuery) {
  return { status: query.status, page: query.page, pageSize: APPEALS_PAGE_SIZE };
}

/** Leaves out the defaults so a shared link stays short. The bot's channel post links with `?appeal=` alone. */
export function appealsHref(guildId: string, query: Partial<AppealsQuery>): string {
  const search = new URLSearchParams();
  if (query.status && query.status !== "pending") search.set("status", query.status);
  if (query.page && query.page > 1) search.set("page", String(query.page));
  if (query.appeal) search.set("appeal", String(query.appeal));
  const text = search.toString();
  return `/guilds/${guildId}/mod/appeals${text ? `?${text}` : ""}`;
}

export const APPEAL_STATUS_LABEL: Record<AppealStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  denied: "Denied",
};

export const APPEAL_STATUS_TONE: Record<AppealStatus, "warn" | "ok" | "removed"> = {
  pending: "warn",
  accepted: "ok",
  denied: "removed",
};

/** The first line of what the member wrote, cut to fit a list row. */
export function appealPreview(text: string, max = 120): string {
  const line = text.split(/\r?\n/).find((part) => part.trim() !== "")?.trim() ?? "";
  if (line === "") return "No text.";
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

/** Why a response cannot be sent, or null when it can. A response is optional. */
export function responseProblem(text: string): string | null {
  return text.trim().length > APPEAL_LIMITS.response ? `Keep the message to ${APPEAL_LIMITS.response} characters.` : null;
}

/** The body of an accept or deny request: the response is left out when nothing was written. */
export function decisionBody(text: string): { response?: string } {
  const trimmed = text.trim();
  return trimmed === "" ? {} : { response: trimmed };
}

export interface DecisionResult {
  appeal: AppealDto | null;
  notes: string[];
}

/** Reads the bot's answer to a decision. A reply without the appeal still counts as done. */
export function readDecision(raw: unknown): DecisionResult {
  if (raw === null || typeof raw !== "object") return { appeal: null, notes: [] };
  const value = raw as Record<string, unknown>;
  const appeal = value.appeal && typeof value.appeal === "object" && typeof (value.appeal as { id?: unknown }).id === "number" ? (value.appeal as AppealDto) : null;
  const notes = Array.isArray(value.notes)
    ? value.notes.filter((note): note is string => typeof note === "string" && note.trim() !== "").map((note) => note.trim())
    : [];
  return { appeal, notes };
}

/** "Still banned", "No longer banned", or that it could not be checked. */
export function bannedText(stillBanned: boolean | null): string {
  if (stillBanned === null) return "Discord could not be asked whether they are still banned.";
  return stillBanned ? "Still banned in Discord." : "No longer banned in Discord.";
}

/** The empty list's title, which depends on the filter. */
export function emptyAppealsTitle(status: AppealFilter): string {
  switch (status) {
    case "pending":
      return "No appeals waiting";
    case "accepted":
      return "No accepted appeals";
    case "denied":
      return "No denied appeals";
    default:
      return "No appeals yet";
  }
}
