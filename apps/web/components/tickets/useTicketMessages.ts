"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TicketMessageDto, TicketMessagesPage } from "@tier0/shared-tickets";
import { arrivalAnnouncement } from "../../lib/ticket-format";
import { startLongPoll, type PollOutcome } from "../../lib/ticket-longpoll";
import { discardPending, mergeArrivals, pendingMessage, settlePending } from "../../lib/ticket-optimistic";
import { ticketsClient } from "../../lib/tickets-client";

/** How often the ticket is asked after when the bot cannot hold requests, which is what polling was before. */
export const POLL_MS = 5_000;
const FINAL_READ_DELAY_MS = 3_000;
/** A very long ticket is read in pages; this many is several thousand messages, past which the transcript download is the better tool. */
const CATCH_UP_PAGES = 40;

interface Options {
  guildId: string;
  ticketId: number;
  initial: TicketMessagesPage;
  viewerId: string;
  /** Keep the conversation current: the ticket is open and on screen. */
  live: boolean;
  /** The side panel's facts changed (a claim, a priority, a note and the like): read the ticket again. */
  onDetailChanged?: () => void;
}

/** A reply on its way, as the composer knows it. */
export interface Draft {
  content: string;
  replyTo: string | null;
}

/**
 * The messages of one ticket, kept current. Whatever the first read did not
 * cover is fetched straight away, page by page. After that the bot is asked
 * for anything newer with a request it holds until something happens, so a
 * message in Discord shows here about as fast as the bot hears of it; each
 * answer is followed by the next request at once. The same answer says when
 * the ticket's other facts changed. A tab in the background asks nothing and
 * catches up as soon as it is looked at again. If holding requests keeps
 * failing, it asks every few seconds instead, as it always did.
 */
export function useTicketMessages({ guildId, ticketId, initial, viewerId, live, onDetailChanged }: Options) {
  const [messages, setMessages] = useState<TicketMessageDto[]>(initial.items);
  const [catchingUp, setCatchingUp] = useState(initial.hasMore);
  const [failed, setFailed] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [arrived, setArrived] = useState<TicketMessageDto[]>([]);
  const [polling, setPolling] = useState(false);
  const cursor = useRef<string | null>(initial.cursor);
  // When the last read happened, so the next one also brings older messages
  // edited or deleted since. Missing from a bot older than this dashboard.
  const updatedSince = useRef<string | null>(initial.updatedSince ?? null);
  // The side panel's version as of the last answer; a different one in the next answer means it changed.
  const detailVersion = useRef<number | null>(initial.detailVersion ?? null);
  const busy = useRef(false);
  const detailChanged = useRef(onDetailChanged);
  detailChanged.current = onDetailChanged;
  const nextToken = useRef(0);

  /** Reads once. `wait` is how many seconds the bot may hold the request. */
  const read = useCallback(
    async (signal: AbortSignal, announce: boolean, wait: number): Promise<{ outcome: PollOutcome; hasMore: boolean }> => {
      let result;
      try {
        result = await ticketsClient.messages(guildId, ticketId, cursor.current, updatedSince.current, signal, wait > 0 ? { wait, version: detailVersion.current } : undefined);
      } catch {
        return { outcome: signal.aborted ? "aborted" : "error", hasMore: false };
      }
      if (signal.aborted) return { outcome: "aborted", hasMore: false };
      if (!result.ok) {
        setFailed(result.error);
        return { outcome: "error", hasMore: false };
      }
      setFailed(null);
      const page = result.value;
      if (page.cursor) cursor.current = page.cursor;
      if (page.updatedSince) updatedSince.current = page.updatedSince;
      const changed = page.changed ?? [];
      if (changed.length > 0) setMessages((current) => mergeArrivals(current, changed, viewerId));
      if (page.items.length > 0) {
        setMessages((current) => mergeArrivals(current, page.items, viewerId));
        if (announce) {
          const text = arrivalAnnouncement(page.items, viewerId);
          if (text) setAnnouncement(text);
          setArrived(page.items);
        }
      }
      if (page.detailVersion !== undefined) {
        const before = detailVersion.current;
        detailVersion.current = page.detailVersion;
        if (before !== null && before !== page.detailVersion) detailChanged.current?.();
      }
      return { outcome: "ok", hasMore: page.hasMore };
    },
    [guildId, ticketId, viewerId],
  );

  const fetchNewer = useCallback(
    async (signal: AbortSignal, announce: boolean): Promise<boolean> => {
      if (busy.current) return false;
      busy.current = true;
      try {
        return (await read(signal, announce, 0)).hasMore;
      } finally {
        busy.current = false;
      }
    },
    [read],
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
    const loop = startLongPoll({
      visible: () => document.visibilityState === "visible",
      intervalMs: POLL_MS,
      onMode: (mode) => setPolling(mode === "interval"),
      poll: async ({ signal, wait }) => {
        // A burst larger than one page is read to the end before holding again.
        let { outcome, hasMore } = await read(signal, true, wait);
        for (let extra = 0; outcome === "ok" && hasMore && extra < 5 && !signal.aborted; extra += 1) {
          ({ outcome, hasMore } = await read(signal, true, 0));
        }
        return outcome;
      },
    });
    const onVisibility = () => loop.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      loop.stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [catchingUp, live, read]);

  // Closing stops the live feed, but the bot's own closing messages arrive just
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

  /** Shows a reply the viewer is sending, before Discord has taken it. Returns what to settle or discard it with. */
  const send = useCallback(
    (draft: Draft): string => {
      nextToken.current += 1;
      const token = `${Date.now().toString(36)}-${nextToken.current}`;
      const message = pendingMessage({ token, content: draft.content, replyTo: draft.replyTo, viewer: { userId: viewerId, name: "You", avatarUrl: null }, at: new Date() });
      setMessages((current) => [...current, message]);
      // Counted as an arrival so the view follows the viewer's own reply down.
      setArrived([message]);
      return token;
    },
    [viewerId],
  );

  /** The reply went through: the stored message takes the place of the pending one, or of nothing if the feed already did. */
  const settle = useCallback((token: string, message: TicketMessageDto) => {
    setMessages((current) => settlePending(current, token, message));
  }, []);

  /** The reply did not go through. */
  const discard = useCallback((token: string) => {
    setMessages((current) => discardPending(current, token));
  }, []);

  /** A reply the viewer just sent that was not shown ahead of time, such as one with files. */
  const add = useCallback((message: TicketMessageDto) => {
    setMessages((current) => mergeArrivals(current, [message], viewerId));
    setArrived([message]);
  }, [viewerId]);

  return { messages, catchingUp, failed, announcement, arrived, polling, send, settle, discard, add };
}
