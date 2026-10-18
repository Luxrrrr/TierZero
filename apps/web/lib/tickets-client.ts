import {
  ticketListQuery,
  type MemberSearchHit,
  type TicketActionResult,
  type TicketCloseRequest,
  type TicketContextDto,
  type TicketCountDto,
  type TicketCreateRequest,
  type TicketCreateResult,
  type TicketDetailDto,
  type TicketListFilters,
  type TicketMembersRequest,
  type TicketMessagesPage,
  type TicketNoteRequest,
  type TicketPage,
  type TicketPanelPostResult,
  type TicketPanelStatusDto,
  type TicketPriorityRequest,
  type TicketRenameRequest,
  type TicketReplyRequest,
  type TicketReplyResult,
  type TicketRequestCloseRequest,
  type TicketTemplatesDto,
  type TicketTransferRequest,
  type TicketTranscriptDeleteResult,
} from "@tier0/core";

/**
 * The browser's side of the ticket workspace. Every call goes to the
 * dashboard's own proxy, which checks the session and adds who is acting; the
 * bot checks again. Free of React so the address building can be tested.
 */

export type TicketCallResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string; code?: string };

const OFFLINE = "The dashboard could not be reached. Check your connection, then try again.";

export function ticketsApiPath(guildId: string, rest: string): string {
  return `/api/guilds/${encodeURIComponent(guildId)}/tickets/${rest.replace(/^\/+/, "")}`;
}

/** The plain-language reason a request failed, from the bot's own answer when it gave one. */
export function failureReason(status: number, error: string | undefined): string {
  if (error && error.trim() !== "") return error;
  if (status === 401) return "Your sign-in has expired. Sign in again, then retry.";
  if (status === 403) return "You do not have access to do that on this ticket.";
  if (status === 404) return "That ticket no longer exists.";
  if (status === 409) return "The ticket changed in the meantime. Reload it and try again.";
  if (status === 429) return "That was a lot of requests at once. Wait a moment, then try again.";
  if (status >= 500) return "The bot could not be reached. Check it is running, then try again.";
  return `The dashboard answered ${status}.`;
}

export async function ticketCall<T>(
  guildId: string,
  method: "GET" | "POST" | "DELETE",
  rest: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<TicketCallResult<T>> {
  let response: Response;
  try {
    response = await fetch(ticketsApiPath(guildId, rest), {
      method,
      signal,
      cache: "no-store",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { ok: false, status: 0, error: OFFLINE };
  }
  const data = (await response.json().catch(() => null)) as unknown;
  if (response.ok) return { ok: true, value: data as T };
  const refusal = (data ?? {}) as { error?: string; code?: string };
  return { ok: false, status: response.status, error: failureReason(response.status, refusal.error), code: refusal.code };
}

const item = (ticketId: number, action: string) => `items/${ticketId}/${action}`;

/** A read the bot may hold: for how many seconds, and the version the page already has, so a change since is answered at once. */
export interface Hold {
  wait: number;
  version?: number | null;
}

/**
 * New messages after `after`, and older ones edited or deleted since
 * `updatedSince`. With a hold, the bot keeps the request until something
 * changes or the wait is up; `version` is the detail version last seen.
 */
export function messagesPath(ticketId: number, after: string | null, updatedSince: string | null = null, hold?: Hold): string {
  const query = new URLSearchParams();
  if (after) query.set("after", after);
  if (updatedSince) query.set("updatedSince", updatedSince);
  if (hold && hold.wait > 0) {
    query.set("wait", String(Math.floor(hold.wait)));
    if (hold.version !== undefined && hold.version !== null) query.set("detailVersion", String(hold.version));
  }
  const text = query.toString();
  return text ? `items/${ticketId}/messages?${text}` : `items/${ticketId}/messages`;
}

export function transcriptHref(guildId: string, ticketId: number, format: "html" | "txt"): string {
  return ticketsApiPath(guildId, `items/${ticketId}/transcript.${format}`);
}

/** The list and its count with the filters a page shows, plus `after` to ask only about tickets newer than the one named. */
export function listPath(root: "list" | "count", filters: Partial<TicketListFilters>, hold?: Hold): string {
  const query = new URLSearchParams(ticketListQuery(filters));
  if (root === "count" && hold && hold.wait > 0) {
    query.set("wait", String(Math.floor(hold.wait)));
    if (hold.version !== undefined && hold.version !== null) query.set("version", String(hold.version));
  }
  const text = query.toString();
  return text ? `${root}?${text}` : root;
}

/** A member search by name, or the names of members already known by id. */
export function membersPath(search: { q: string } | { ids: readonly string[] }): string {
  const query = new URLSearchParams();
  if ("q" in search) query.set("q", search.q.trim().slice(0, 100));
  else query.set("ids", search.ids.slice(0, 50).join(","));
  return `members?${query.toString()}`;
}

export const ticketsClient = {
  context: (guildId: string, signal?: AbortSignal) => ticketCall<TicketContextDto>(guildId, "GET", "context", undefined, signal),
  list: (guildId: string, filters: Partial<TicketListFilters>, signal?: AbortSignal) =>
    ticketCall<TicketPage>(guildId, "GET", listPath("list", filters), undefined, signal),
  count: (guildId: string, filters: Partial<TicketListFilters>, signal?: AbortSignal, hold?: Hold) =>
    ticketCall<TicketCountDto>(guildId, "GET", listPath("count", filters, hold), undefined, signal),
  findMembers: (guildId: string, q: string, signal?: AbortSignal) =>
    ticketCall<MemberSearchHit[]>(guildId, "GET", membersPath({ q }), undefined, signal),
  memberNames: (guildId: string, ids: readonly string[], signal?: AbortSignal) =>
    ticketCall<MemberSearchHit[]>(guildId, "GET", membersPath({ ids }), undefined, signal),
  rename: (guildId: string, ticketId: number, body: TicketRenameRequest) =>
    ticketCall<TicketActionResult>(guildId, "POST", `items/${ticketId}/rename`, body),
  requestClose: (guildId: string, ticketId: number, body: TicketRequestCloseRequest) =>
    ticketCall<TicketActionResult>(guildId, "POST", `items/${ticketId}/request-close`, body),
  messages: (guildId: string, ticketId: number, after: string | null, updatedSince: string | null, signal?: AbortSignal, hold?: Hold) =>
    ticketCall<TicketMessagesPage>(guildId, "GET", messagesPath(ticketId, after, updatedSince, hold), undefined, signal),
  detail: (guildId: string, ticketId: number, signal?: AbortSignal) =>
    ticketCall<TicketDetailDto>(guildId, "GET", `items/${ticketId}`, undefined, signal),
  reply: (guildId: string, ticketId: number, body: TicketReplyRequest) =>
    ticketCall<TicketReplyResult>(guildId, "POST", item(ticketId, "reply"), body),
  claim: (guildId: string, ticketId: number) => ticketCall<TicketActionResult>(guildId, "POST", item(ticketId, "claim"), {}),
  unclaim: (guildId: string, ticketId: number) => ticketCall<TicketActionResult>(guildId, "POST", item(ticketId, "unclaim"), {}),
  priority: (guildId: string, ticketId: number, body: TicketPriorityRequest) =>
    ticketCall<TicketActionResult>(guildId, "POST", item(ticketId, "priority"), body),
  note: (guildId: string, ticketId: number, body: TicketNoteRequest) =>
    ticketCall<TicketActionResult>(guildId, "POST", item(ticketId, "notes"), body),
  members: (guildId: string, ticketId: number, body: TicketMembersRequest) =>
    ticketCall<TicketActionResult>(guildId, "POST", item(ticketId, "members"), body),
  transfer: (guildId: string, ticketId: number, body: TicketTransferRequest) =>
    ticketCall<TicketActionResult>(guildId, "POST", item(ticketId, "transfer"), body),
  close: (guildId: string, ticketId: number, body: TicketCloseRequest) =>
    ticketCall<TicketActionResult>(guildId, "POST", item(ticketId, "close"), body),
  reopen: (guildId: string, ticketId: number) => ticketCall<TicketActionResult>(guildId, "POST", item(ticketId, "reopen"), {}),
  deleteTranscript: (guildId: string, ticketId: number) =>
    ticketCall<TicketTranscriptDeleteResult>(guildId, "DELETE", `items/${ticketId}/transcript`, {}),
  templates: (guildId: string, signal?: AbortSignal) => ticketCall<TicketTemplatesDto>(guildId, "GET", "templates", undefined, signal),
  create: (guildId: string, body: Omit<TicketCreateRequest, "subject" | "firstMessage"> & { subject?: string | null; firstMessage?: string | null }) =>
    ticketCall<TicketCreateResult>(guildId, "POST", "create", body),
  panels: (guildId: string) => ticketCall<TicketPanelStatusDto[]>(guildId, "GET", "panels"),
  postPanel: (guildId: string, panelId: string) =>
    ticketCall<TicketPanelPostResult>(guildId, "POST", `panels/${encodeURIComponent(panelId)}/post`, {}),
};

/**
 * A reply that carries files. `fetch` cannot report how much of a request has
 * been sent, and a few megabytes on a slow link is long enough to need a bar,
 * so this one request goes out the older way. Browser only.
 */
export function replyWithFiles(
  guildId: string,
  ticketId: number,
  body: TicketReplyRequest,
  onProgress: (fraction: number) => void,
): Promise<TicketCallResult<TicketReplyResult>> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("POST", ticketsApiPath(guildId, `items/${ticketId}/reply`));
    request.setRequestHeader("content-type", "application/json");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(1, event.loaded / event.total));
    };
    request.onerror = () => resolve({ ok: false, status: 0, error: OFFLINE });
    request.ontimeout = () => resolve({ ok: false, status: 0, error: OFFLINE });
    request.onload = () => {
      let data: unknown;
      try {
        data = JSON.parse(request.responseText) as unknown;
      } catch {
        data = null;
      }
      if (request.status >= 200 && request.status < 300) {
        resolve({ ok: true, value: data as TicketReplyResult });
        return;
      }
      const refusal = (data ?? {}) as { error?: string; code?: string };
      resolve({ ok: false, status: request.status, error: failureReason(request.status, refusal.error), code: refusal.code });
    };
    request.send(JSON.stringify(body));
  });
}

/** Whether a write answered with the updated ticket, as every ticket change but a reply and a transcript deletion does. */
export function isActionResult(value: unknown): value is TicketActionResult {
  if (typeof value !== "object" || value === null) return false;
  const { ticket, notes } = value as { ticket?: unknown; notes?: unknown };
  return typeof ticket === "object" && ticket !== null && typeof (ticket as { id?: unknown }).id === "number" && Array.isArray(notes);
}
