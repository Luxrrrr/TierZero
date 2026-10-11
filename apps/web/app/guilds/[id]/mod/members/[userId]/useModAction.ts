"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "../../../../../../components/Toaster";
import { failureText } from "./a11y";
import type { PendingOp } from "./timeline";

export interface ModCall {
  method: "POST" | "PATCH" | "DELETE";
  /** Path under `/api/guilds/:id/mod/`, with no leading slash. */
  path: string;
  body?: Record<string, unknown>;
  success: string;
  failure: string;
  /**
   * The caller shows a failure itself, as a dialog does: the toaster sits
   * under the dialog's scrim, so a toast there would be neither seen nor
   * reachable.
   */
  inline?: boolean;
}

/** True when the change went through, otherwise the sentence explaining why not. */
export type ModResult = true | string;

/**
 * Sends a change and shows the profile as it will look afterwards. With
 * `"now"` the guess appears while the request is in flight; with `"after"` it
 * appears once the server agrees, which a dialog needs because the guess may
 * remove the row the dialog belongs to. Pass null for changes with nothing
 * worth predicting.
 */
export type Run = (call: ModCall, op: PendingOp | null, when?: "now" | "after") => Promise<ModResult>;

/**
 * Sends one change to the mod API and reports the outcome. On success the
 * server components re-read the profile, so the page never shows a record the
 * bot has not confirmed. The server's own wording is shown on failure.
 */
export function useModAction(guildId: string): (call: ModCall) => Promise<ModResult> {
  const router = useRouter();
  const toast = useToast();

  return useCallback(
    async (call: ModCall) => {
      let detail: string;
      try {
        const res = await fetch(`/api/guilds/${guildId}/mod/${call.path}`, {
          method: call.method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(call.body ?? {}),
        });
        if (res.ok) {
          toast.push({ kind: "success", title: call.success });
          router.refresh();
          return true;
        }
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        detail = failureText(call.failure, data?.error, res.status);
        if (!call.inline) {
          toast.push({ kind: "error", title: call.failure, detail: data?.error ?? `The server answered ${res.status}.` });
        }
      } catch {
        const reason = "The dashboard could not be reached. Check your connection and try again.";
        detail = failureText(call.failure, reason);
        if (!call.inline) toast.push({ kind: "error", title: call.failure, detail: reason });
      }
      return detail;
    },
    [guildId, router, toast],
  );
}
