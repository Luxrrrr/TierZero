"use client";

import { useCallback, useRef, useState } from "react";
import type { FormContext } from "./actions";
import { readContext } from "./actions";

export type ContextState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; context: FormContext }
  | { status: "error"; message: string };

/**
 * Settings change rarely, but a moderator who has just turned Moderation on
 * in another tab should not be told it is off, so a copy older than this is
 * fetched again the next time the menu opens.
 */
const FRESH_MS = 30_000;

/**
 * The server's moderation settings for the action form. Loaded when the menu
 * opens rather than with the page, so a record that is only being read costs
 * nothing extra, and usually ready by the time an action is picked.
 */
export function useActionContext(guildId: string): { state: ContextState; load(force?: boolean): void } {
  const [state, setState] = useState<ContextState>({ status: "idle" });
  const loadedAt = useRef(0);
  const inFlight = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const load = useCallback(
    (force = false) => {
      if (inFlight.current) return;
      const current = stateRef.current;
      if (!force && current.status === "ready" && Date.now() - loadedAt.current < FRESH_MS) return;

      inFlight.current = true;
      // A copy already shown stays up while the fresh one loads, so the form
      // does not flash to a loading state under someone's cursor.
      if (current.status !== "ready") setState({ status: "loading" });

      void (async () => {
        try {
          const res = await fetch(`/api/guilds/${guildId}/mod/actions/context`, { cache: "no-store" });
          const data: unknown = await res.json().catch(() => null);
          const context = res.ok ? readContext(data) : null;
          if (context) {
            loadedAt.current = Date.now();
            setState({ status: "ready", context });
          } else {
            const error = data && typeof data === "object" && "error" in data ? (data as { error: unknown }).error : null;
            setState({
              status: "error",
              message:
                typeof error === "string" && error.trim() !== ""
                  ? error
                  : `The moderation settings could not be read. The server answered ${res.status}.`,
            });
          }
        } catch {
          setState({ status: "error", message: "The dashboard could not be reached. Check your connection and try again." });
        } finally {
          inFlight.current = false;
        }
      })();
    },
    [guildId],
  );

  return { state, load };
}
