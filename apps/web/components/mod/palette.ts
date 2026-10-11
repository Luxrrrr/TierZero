import type { MemberSearchHit, MemberSummary, UserRef } from "@tier0/core";

/**
 * Keyboard and result rules for the member search palette, apart from React
 * so they can be tested.
 */

export interface ShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/**
 * Ctrl+K or Cmd+K. No single-key shortcut: a lone "/" fires for speech-input
 * users and anyone who types it outside a field (WCAG 2.1.4).
 */
export function opensPalette(event: ShortcutEvent): boolean {
  if (event.altKey) return false;
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
}

/** Arrow movement through a list that wraps at both ends; -1 means nothing is highlighted. */
export function moveActive(current: number, delta: 1 | -1, length: number): number {
  if (length === 0) return -1;
  if (current < 0) return delta === 1 ? 0 : length - 1;
  return (current + delta + length) % length;
}

export interface PaletteResult {
  user: UserRef;
  /** A short second line: what is on their record, or that they have none. */
  detail: string | null;
}

function recordDetail(summary: MemberSummary): string {
  const parts: string[] = [];
  if (summary.infractionCount > 0) {
    parts.push(`${summary.infractionCount} ${summary.infractionCount === 1 ? "action" : "actions"}`);
  }
  if (summary.noteCount > 0) parts.push(`${summary.noteCount} ${summary.noteCount === 1 ? "note" : "notes"}`);
  return parts.length > 0 ? parts.join(" · ") : "No record";
}

export function fromSummaries(summaries: readonly MemberSummary[]): PaletteResult[] {
  return summaries.map((summary) => ({ user: summary.user, detail: recordDetail(summary) }));
}

/**
 * Members with a record first, since that is usually who a moderator is
 * looking for, then live guild members not already listed. Capped so the
 * list stays scannable.
 */
export function mergeResults(
  withRecord: readonly MemberSummary[],
  inServer: readonly MemberSearchHit[],
  limit = 8,
): PaletteResult[] {
  const seen = new Set<string>();
  const out: PaletteResult[] = [];
  for (const result of fromSummaries(withRecord)) {
    if (seen.has(result.user.userId)) continue;
    seen.add(result.user.userId);
    out.push(result);
  }
  for (const hit of inServer) {
    if (seen.has(hit.user.userId)) continue;
    seen.add(hit.user.userId);
    out.push({ user: hit.user, detail: null });
  }
  return out.slice(0, limit);
}

export interface PaletteState {
  query: string;
  /** Null until the recent list has been asked for. */
  recentCount: number | null;
  recentFailed: boolean;
  status: "idle" | "loading" | "ready" | "error";
  resultCount: number;
  /** HTTP status of a failed search, when there was one. */
  failure: number | null;
}

export interface PaletteMessage {
  /** The line shown in the list area, or null when the list speaks for itself. */
  shown: string | null;
  /** What the live region says; set as text on a region that is always present. */
  announce: string;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function paletteMessage(state: PaletteState): PaletteMessage {
  const q = state.query.trim();
  if (q === "") {
    if (state.recentCount === null) return { shown: "Loading recent members", announce: "" };
    if (state.recentFailed) {
      const text = "Recent members could not be loaded. Type a name to search.";
      return { shown: text, announce: text };
    }
    if (state.recentCount === 0) {
      const text = "No one has a record yet. Type a name to search the server.";
      return { shown: text, announce: text };
    }
    return { shown: null, announce: `${count(state.recentCount, "recently actioned member", "recently actioned members")}` };
  }
  if (state.status === "error") {
    const text =
      state.failure === 401 || state.failure === 403
        ? "Your session may have ended. Reload the page and sign in again."
        : "Search is unavailable because the bot did not answer. Try again in a moment.";
    return { shown: text, announce: text };
  }
  if (state.status === "ready") {
    if (state.resultCount === 0) {
      const text = `No members match "${q}".`;
      return { shown: text, announce: text };
    }
    return { shown: null, announce: count(state.resultCount, "result", "results") };
  }
  return { shown: state.resultCount === 0 ? "Searching" : null, announce: "" };
}
