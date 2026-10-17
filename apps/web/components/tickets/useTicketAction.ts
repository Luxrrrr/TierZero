"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TicketActionResult } from "@tier0/core";
import { useToast } from "../Toaster";
import { isActionResult, type TicketCallResult } from "../../lib/tickets-client";

export interface TicketActionOptions<T> {
  call(): Promise<TicketCallResult<T>>;
  success: string;
  failure: string;
  /** The caller shows the failure itself, as a dialog does: a toast would sit under its scrim. */
  inline?: boolean;
}

/** What a second press says while the first change is still on its way. */
export const STILL_SENDING = "The last change is still being sent. Wait for it to finish, then try again.";

/**
 * Runs one change on a ticket and reports it. On success the server
 * components read the ticket again, so the inbox list and the ticket agree.
 * Returns true, or the sentence explaining why it did not happen. Only one
 * change runs at a time: a double click must not send a note or a member
 * twice, and the button's disabled look arrives a render too late to stop it.
 *
 * `onDone` is only handed an updated ticket; a change that answers with
 * something else, such as a transcript deletion, leaves it out.
 */
export function useTicketAction<T = TicketActionResult>(onDone?: (value: TicketActionResult) => void) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const running = useRef(false);

  const run = useCallback(
    async (key: string, options: TicketActionOptions<T>): Promise<true | string> => {
      if (running.current) return STILL_SENDING;
      running.current = true;
      setPending(key);
      try {
        const result = await options.call();
        if (result.ok) {
          const notes = isActionResult(result.value) ? result.value.notes : [];
          toast.push({ kind: "success", title: options.success, detail: notes.length > 0 ? notes.join(" ") : undefined });
          if (isActionResult(result.value)) onDone?.(result.value);
          router.refresh();
          return true;
        }
        if (!options.inline) toast.push({ kind: "error", title: options.failure, detail: result.error });
        return result.error;
      } finally {
        running.current = false;
        setPending(null);
      }
    },
    [onDone, router, toast],
  );

  return { run, pending };
}
