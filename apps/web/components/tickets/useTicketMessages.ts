"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TicketMessageDto, TicketMessagesPage } from "@tier0/core";
import { arrivalAnnouncement, mergeMessages } from "../../lib/ticket-format";
import { ticketsClient } from "../../lib/tickets-client";

export const POLL_MS = 5_000;
const FINAL_READ_DELAY_MS = 3_000;
/** A very long ticket is read in pages; this many is several thousand messages, past which the transcript download is the better tool. */
const CATCH_UP_PAGES = 40;

interface Options {
  guildId: string;
  ticketId: number;
  initial: TicketMessagesPage;
  viewerId: string;
  /** Ask for new messages every few seconds: the ticket is open and on screen. */
  live: boolean;
}

/**
 * The messages of one ticket, kept current. Whatever the first read did not
 * cover is fetched straight away, page by page; after that the cursor is
 * asked for anything newer every five seconds while the tab is visible and
 * the ticket is open. A tab in the background asks nothing, and catches up
 * as soon as it is looked at again.
 */
export function useTicketMessages({ guildId, ticketId, initial, viewerId, live }: Options) {
  const [messages, setMessages] = useState<TicketMessageDto[]>(initial.items);
  const [catchingUp, setCatchingUp] = useState(initial.hasMore);
  const [failed, setFailed] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [arrived, setArrived] = useState<TicketMessageDto[]>([]);
  const cursor = useRef<string | null>(initial.cursor);
  // When the last read happened, so the next one also brings older messages
  // edited or deleted since. Missing from a bot older than this dashboard.
  const updatedSince = useRef<string | null>(initial.updatedSince ?? null);
  const busy = useRef(false);

  const fetchNewer = useCallback(
    async (signal: AbortSignal, announce: boolean): Promise<boolean> => {
      if (busy.current) return false;
      busy.current = true;
      try {
        const result = await ticketsClient.messages(guildId, ticketId, cursor.current, updatedSince.current, signal);
        if (!result.ok) {
          setFailed(result.error);
          return false;
        }
        setFailed(null);
        const page = result.value;
        if (page.cursor) cursor.current = page.cursor;
        if (page.updatedSince) updatedSince.current = page.updatedSince;
        const changed = page.changed ?? [];
        if (changed.length > 0) setMessages((current) => mergeMessages(current, changed));
        if (page.items.length > 0) {
          setMessages((current) => mergeMessages(current, page.items));
          if (announce) {
            const text = arrivalAnnouncement(page.items, viewerId);
            if (text) setAnnouncement(text);
            setArrived(page.items);
          }
        }
        return page.hasMore;
      } catch {
        return false;
      } finally {
        busy.current = false;
      }
    },
    [guildId, ticketId, viewerId],
  );

  useEffect(() => {
    if (!initial.hasMore) return;
    const controller = new AbortController();
    void (async () => {
      for (let page = 0; page < CATCH_UP_PAGES && !controller.signal.aborted; page += 1) {
        const more = await fetchNewer(controller.signal, false);
        if (!more) break;
      }
      if (!controller.signal.aborted) setCatchingUp(false);
    })();
    return () => controller.abort();
  }, [fetchNewer, initial.hasMore]);

  useEffect(() => {
    if (!live || catchingUp) return;
    const controller = new AbortController();
    let timer: number | undefined;

    const schedule = () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      timer = window.setTimeout(async () => {
        let more = await fetchNewer(controller.signal, true);
        // A burst larger than one page is read to the end before waiting again.
        for (let extra = 0; more && extra < 5 && !controller.signal.aborted; extra += 1) {
          more = await fetchNewer(controller.signal, true);
        }
        if (!controller.signal.aborted) schedule();
      }, POLL_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        window.clearTimeout(timer);
        void fetchNewer(controller.signal, true).then(() => {
          if (!controller.signal.aborted) schedule();
        });
      } else {
        window.clearTimeout(timer);
      }
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [catchingUp, fetchNewer, live]);

  // Closing stops the polling, but the bot's own closing messages arrive just
  // after, so the ticket is read once more straight away and once a moment later.
  const wasLive = useRef(live);
  useEffect(() => {
    const before = wasLive.current;
    wasLive.current = live;
    if (!before || live) return;
    const controller = new AbortController();
    void fetchNewer(controller.signal, true);
    const later = window.setTimeout(() => void fetchNewer(controller.signal, true), FINAL_READ_DELAY_MS);
    return () => {
      controller.abort();
      window.clearTimeout(later);
    };
  }, [fetchNewer, live]);

  /** A reply the viewer just sent, shown before the next poll would bring it. */
  const add = useCallback((message: TicketMessageDto) => {
    setMessages((current) => mergeMessages(current, [message]));
    // Counted as an arrival so the view follows the viewer's own reply down.
    setArrived([message]);
  }, []);

  return { messages, catchingUp, failed, announcement, arrived, add };
}
