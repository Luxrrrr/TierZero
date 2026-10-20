"use client";

import { useCallback, useEffect, useRef } from "react";
import type { TicketDetailDto } from "@tier0/shared-tickets";
import { ticketsClient } from "../../lib/tickets-client";

/** How often the ticket is read again when the live feed cannot tell the page it changed. */
export const DETAIL_REFRESH_MS = 15_000;

/**
 * Reads the ticket again, so a claim, a priority or a note another member of
 * staff just made shows up without a reload. The live feed calls `refresh`
 * the moment the bot says the ticket changed. Only when that feed has fallen
 * back to asking on a timer (`polling`) does this read on a timer too.
 *
 * A read is put off while the viewer's own change is on its way, whose answer
 * it would overwrite with an older one, and made as soon as that is done.
 */
export function useTicketRefresh({
  guildId,
  ticketId,
  live,
  polling,
  busy,
  onTicket,
}: {
  guildId: string;
  ticketId: number;
  live: boolean;
  polling: boolean;
  busy: boolean;
  onTicket(next: TicketDetailDto): void;
}) {
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const onTicketRef = useRef(onTicket);
  onTicketRef.current = onTicket;
  const waiting = useRef(false);
  const controller = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (busyRef.current) {
      waiting.current = true;
      return;
    }
    waiting.current = false;
    controller.current?.abort();
    const mine = new AbortController();
    controller.current = mine;
    try {
      const result = await ticketsClient.detail(guildId, ticketId, mine.signal);
      if (result.ok && !mine.signal.aborted && !busyRef.current) onTicketRef.current(result.value);
      else if (result.ok && busyRef.current) waiting.current = true;
    } catch {
      // Aborted by a newer read or on the way out; the next change or tick tries again otherwise.
    }
  }, [guildId, ticketId]);

  useEffect(() => {
    if (!busy && waiting.current && live) void refresh();
  }, [busy, live, refresh]);

  useEffect(() => {
    if (!live || !polling) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, DETAIL_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [live, polling, refresh]);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [guildId, ticketId],
  );

  return refresh;
}
