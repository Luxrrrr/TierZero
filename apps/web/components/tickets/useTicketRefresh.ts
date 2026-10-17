"use client";

import { useEffect, useRef } from "react";
import type { TicketDetailDto } from "@tier0/core";
import { ticketsClient } from "../../lib/tickets-client";

export const DETAIL_REFRESH_MS = 15_000;

/**
 * Reads the ticket again every so often while it is open and on screen, so a
 * claim, a priority or a note another member of staff just made shows up
 * without a reload. Skipped while the viewer's own change is on its way,
 * whose answer would be overwritten by an older read.
 */
export function useTicketRefresh({
  guildId,
  ticketId,
  live,
  busy,
  onTicket,
}: {
  guildId: string;
  ticketId: number;
  live: boolean;
  busy: boolean;
  onTicket(next: TicketDetailDto): void;
}) {
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const onTicketRef = useRef(onTicket);
  onTicketRef.current = onTicket;

  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible" || busyRef.current) return;
      try {
        const result = await ticketsClient.detail(guildId, ticketId, controller.signal);
        if (result.ok && !busyRef.current) onTicketRef.current(result.value);
      } catch {
        // Aborted on the way out; the next tick tries again otherwise.
      }
    }, DETAIL_REFRESH_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [guildId, ticketId, live]);
}
