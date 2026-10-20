import { caseStateOf, isWarning, type InfractionDto, type UserRef } from "@tier0/shared-moderation";

/**
 * Query handling and display rules for the action log. Kept free of React so
 * the rules can be tested on their own.
 */

export type StateFilter = "all" | "inforce" | "expired" | "removed";

/** Order matters: it is the order the chips appear in. `timeout-clear` is accepted in a URL but has no chip. */
export const ACTION_CHIPS = ["warn", "timeout", "kick", "ban", "unban"] as const;
const ACTION_FILTERS: string[] = [...ACTION_CHIPS, "timeout-clear"];

export const STATE_CHIPS: { value: StateFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "inforce", label: "In force" },
  { value: "expired", label: "Expired" },
  { value: "removed", label: "Removed" },
];

export type SourceFilter = "all" | "manual" | "automod";

export const SOURCE_CHIPS: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "All sources" },
  { value: "manual", label: "Manual" },
  { value: "automod", label: "Automod" },
];

const ACTIONS_PAGE_SIZE = 25;

export interface ActionsQuery {
  action: string;
  state: StateFilter;
  source: SourceFilter;
  moderatorId: string;
  q: string;
  page: number;
}

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Anything unrecognised falls back to the defaults, so a hand-edited URL never errors. */
export function parseActionsQuery(raw: RawParams): ActionsQuery {
  const action = first(raw.action);
  const state = first(raw.state);
  const source = first(raw.source);
  const moderatorId = first(raw.moderatorId).trim();
  const pageNumber = Number.parseInt(first(raw.page), 10);
  return {
    action: ACTION_FILTERS.includes(action) ? action : "",
    state: state === "inforce" || state === "expired" || state === "removed" ? state : "all",
    source: source === "manual" || source === "automod" ? source : "all",
    moderatorId: /^\d{1,25}$/.test(moderatorId) ? moderatorId : "",
    q: first(raw.q).trim().slice(0, 100),
    page: Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1,
  };
}

export function actionsApiParams(query: ActionsQuery) {
  return {
    action: query.action || undefined,
    state: query.state === "all" ? undefined : query.state,
    source: query.source === "all" ? undefined : query.source,
    moderatorId: query.moderatorId || undefined,
    q: query.q || undefined,
    page: query.page,
    pageSize: ACTIONS_PAGE_SIZE,
  };
}

function searchOf(query: Partial<ActionsQuery>): URLSearchParams {
  const search = new URLSearchParams();
  if (query.action) search.set("action", query.action);
  if (query.state && query.state !== "all") search.set("state", query.state);
  if (query.source && query.source !== "all") search.set("source", query.source);
  if (query.moderatorId) search.set("moderatorId", query.moderatorId);
  if (query.q) search.set("q", query.q);
  return search;
}

/** Leaves out values that match the defaults so shared links stay short. */
export function actionsHref(guildId: string, query: Partial<ActionsQuery>): string {
  const search = searchOf(query);
  if (query.page && query.page > 1) search.set("page", String(query.page));
  const text = search.toString();
  return `/guilds/${guildId}/mod/actions${text ? `?${text}` : ""}`;
}

/**
 * The download for the current filters. It repeats the page's `state`, so
 * the file holds the same set the count above the table describes.
 */
export function actionsExportHref(guildId: string, query: Partial<ActionsQuery>): string {
  const search = new URLSearchParams();
  if (query.action) search.set("action", query.action);
  if (query.moderatorId) search.set("moderatorId", query.moderatorId);
  if (query.q) search.set("q", query.q);
  if (query.state && query.state !== "all") search.set("state", query.state);
  if (query.source && query.source !== "all") search.set("source", query.source);
  const text = search.toString();
  return `/api/guilds/${guildId}/mod/infractions/export${text ? `?${text}` : ""}`;
}

export function hasActionFilters(query: ActionsQuery): boolean {
  return Boolean(query.action || query.moderatorId || query.q || query.state !== "all" || query.source !== "all");
}

export type InfractionState = "removed" | "active" | "expired" | "recorded";

type StateInput = Pick<InfractionDto, "action" | "voided" | "active" | "expiresAt" | "warnExpiresAt">;

const STATE_KEY = { removed: "removed", "in force": "active", expired: "expired", "on record": "recorded" } as const;

/** The shared rule in @tier0/core, which the CSV export uses too, so the file and the page always agree. */
export function infractionState(infraction: StateInput, now: Date = new Date()): InfractionState {
  return STATE_KEY[
    caseStateOf(
      {
        action: infraction.action,
        active: infraction.active,
        expiresAt: infraction.expiresAt,
        removed: infraction.voided !== null,
        warnExpiresAt: infraction.warnExpiresAt ?? null,
      },
      now,
    )
  ];
}

const nameOf = (user: UserRef): string => user.name ?? `User ${user.userId.slice(-4)}`;

/** Always UTC and labelled, because this text is built on the server, whose zone is not the reader's. */
function shortWhen(iso: string, now: Date): string {
  const date = new Date(iso);
  const text = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    ...(date.getUTCFullYear() === now.getUTCFullYear() ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
  return `${text} UTC`;
}

interface StateView {
  state: InfractionState;
  /** Matches the tones of the shared pill. */
  tone: "active" | "expired" | "removed" | "neutral";
  label: string;
  /** A longer sentence for the title attribute. */
  detail: string;
}

export function describeState(infraction: StateInput, now: Date = new Date()): StateView {
  const state = infractionState(infraction, now);
  switch (state) {
    case "removed": {
      const voided = infraction.voided as NonNullable<InfractionDto["voided"]>;
      const why = voided.reason ? ` Reason: ${voided.reason}` : "";
      return {
        state,
        tone: "removed",
        label: `Removed by ${nameOf(voided.by)}`,
        detail: `Removed by ${nameOf(voided.by)} on ${shortWhen(voided.at, now)}.${why}`,
      };
    }
    case "active": {
      const until = infraction.expiresAt ? shortWhen(infraction.expiresAt, now) : null;
      return {
        state,
        tone: "active",
        label: until ? `In force until ${until}` : "In force",
        detail: until ? `Takes effect until ${until}.` : "Stays in force until it is lifted.",
      };
    }
    case "expired": {
      if (isWarning(infraction.action) && infraction.warnExpiresAt) {
        const stopped = shortWhen(infraction.warnExpiresAt, now);
        return { state, tone: "expired", label: "Expired", detail: `Stopped counting on ${stopped}. It stays on the record.` };
      }
      const ended = infraction.expiresAt ? shortWhen(infraction.expiresAt, now) : "";
      return { state, tone: "expired", label: ended ? `Expired ${ended}` : "Expired", detail: `Ran out ${ended}.` };
    }
    default:
      if (isWarning(infraction.action) && infraction.warnExpiresAt) {
        return { state, tone: "neutral", label: "On record", detail: `Counts until ${shortWhen(infraction.warnExpiresAt, now)}.` };
      }
      return { state, tone: "neutral", label: "On record", detail: "Stays on the member's record." };
  }
}

export function memberHref(guildId: string, userId: string): string {
  return `/guilds/${guildId}/mod/members/${encodeURIComponent(userId)}`;
}

/** Staff plus anyone seen in the log (a moderator may have lost their role since), once each, sorted by name. */
export function moderatorOptions(known: UserRef[], seen: UserRef[], selectedId: string): UserRef[] {
  const byId = new Map<string, UserRef>();
  for (const user of [...known, ...seen]) {
    const existing = byId.get(user.userId);
    // A row from the log carries the name Discord gave at query time, which beats an unnamed staff entry.
    if (!existing || (existing.name === null && user.name !== null)) byId.set(user.userId, user);
  }
  if (selectedId && !byId.has(selectedId)) {
    byId.set(selectedId, { userId: selectedId, name: null, avatarUrl: null, inServer: false });
  }
  return [...byId.values()].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
}
