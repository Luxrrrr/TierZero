"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { TicketCountDto, TicketListFilters } from "@tier0/core";
import { ArrowUpIcon, BellIcon } from "../Icons";
import {
  LIVE_HIDDEN_POLL_MS,
  LIVE_POLL_MS,
  alertText,
  alertsKey,
  baselineOf,
  countFilters,
  liveAnnouncement,
  liveChange,
  livePillText,
  newSincePrevious,
  titleWithBadge,
  type LiveBaseline,
  type LiveChange,
} from "../../lib/ticket-live";
import { startLongPoll, type PollOutcome } from "../../lib/ticket-longpoll";
import { ticketsClient } from "../../lib/tickets-client";

interface Props {
  guildId: string;
  filters: TicketListFilters;
  /** The list holder, so a refresh can wait while the pointer or focus is in it. */
  listId: string;
}

type AlertState = "unsupported" | "off" | "on" | "blocked";

function readAlerts(guildId: string): boolean {
  try {
    return window.localStorage.getItem(alertsKey(guildId)) === "1";
  } catch {
    return false;
  }
}

function writeAlerts(guildId: string, on: boolean): void {
  try {
    if (on) window.localStorage.setItem(alertsKey(guildId), "1");
    else window.localStorage.removeItem(alertsKey(guildId));
  } catch {
    // A browser that keeps nothing still gets alerts until the tab closes.
  }
}

/** Auto-refreshes of the list are at least this far apart, so a busy server does not re-render it on every message. */
const REFRESH_GAP_MS = 3_000;

/**
 * Keeps the inbox list honest while it is open. The count behind the list is
 * asked with a request the bot holds until a ticket changes, so a new ticket
 * or a new message shows within about a second; if that keeps failing it is
 * asked every fifteen seconds while the tab is in front. New tickets wait
 * behind a button rather than shifting the rows under the reader; other
 * activity is brought in by itself once the pointer and focus are out of the
 * list. The tab's title carries how many tickets wait on staff, and desktop
 * alerts are there for whoever turns them on.
 */
export function InboxLive({ guildId, filters, listId }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [change, setChange] = useState<LiveChange>({ kind: "none" });
  const [announcement, setAnnouncement] = useState("");
  const [waiting, setWaiting] = useState<number | null>(null);
  const [alerts, setAlerts] = useState<AlertState>("unsupported");
  const base = useRef<LiveBaseline | null>(null);
  const latest = useRef<TicketCountDto | null>(null);
  const alertsOn = useRef(false);
  const shown = useRef<LiveChange>(change);
  shown.current = change;
  const filterKey = JSON.stringify({ ...filters, page: 1 });

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const on = readAlerts(guildId) && Notification.permission === "granted";
    setAlerts(Notification.permission === "denied" ? "blocked" : on ? "on" : "off");
    alertsOn.current = on;
  }, [guildId]);

  const listBusy = useCallback(() => {
    const list = document.getElementById(listId);
    if (!list) return false;
    return list.matches(":hover") || list.contains(document.activeElement);
  }, [listId]);

  const apply = useCallback(() => {
    if (latest.current) base.current = baselineOf(latest.current);
    setChange({ kind: "none" });
    router.refresh();
  }, [router]);

  useEffect(() => {
    base.current = null;
    latest.current = null;
    setChange({ kind: "none" });
    let lastRefresh = 0;
    let refreshTimer: number | undefined;

    const refreshSoon = () => {
      window.clearTimeout(refreshTimer);
      const wait = Math.max(0, lastRefresh + REFRESH_GAP_MS - Date.now());
      refreshTimer = window.setTimeout(() => {
        lastRefresh = Date.now();
        router.refresh();
      }, wait);
    };

    const poll = async ({ signal, wait }: { signal: AbortSignal; wait: number }): Promise<PollOutcome> => {
      // The first answer sets the baseline at once; after that the bot holds each request until something changes.
      const hold = base.current ? { wait, version: latest.current?.version ?? null } : undefined;
      const result = await ticketsClient.count(guildId, countFilters(filters, base.current), signal, hold).catch(() => null);
      if (signal.aborted) return "aborted";
      if (!result) return "error";
      if (!result.ok) {
        // A bot older than this dashboard has no count to ask; the list then works as before.
        return result.status === 404 || result.status === 403 ? "stop" : "error";
      }
      const count = result.value;
      setWaiting(count.awaitingStaff);
      if (!base.current) {
        base.current = baselineOf(count);
        latest.current = count;
        return "ok";
      }
      const previous = latest.current ?? count;
      latest.current = count;
      const next = liveChange(base.current, count);
      if (alertsOn.current && document.visibilityState !== "visible") {
        const text = alertText(newSincePrevious(liveChange(base.current, previous), next), previous.awaitingStaff, count.awaitingStaff);
        if (text) {
          try {
            const alert = new Notification(text.title, { body: text.body, tag: `tier0-tickets-${guildId}` });
            alert.onclick = () => window.focus();
          } catch {
            // Some browsers only allow alerts from a service worker; the title badge still counts.
          }
        }
      }
      if (next.kind === "none") {
        setChange(next);
        return "ok";
      }
      if (next.kind === "activity" && !listBusy() && document.visibilityState === "visible") {
        base.current = baselineOf(count);
        setChange({ kind: "none" });
        refreshSoon();
        return "ok";
      }
      if (livePillText(next) !== livePillText(shown.current)) setAnnouncement(liveAnnouncement(next));
      setChange(next);
      return "ok";
    };

    const loop = startLongPoll({
      poll,
      visible: () => document.visibilityState === "visible",
      intervalMs: LIVE_POLL_MS,
      hiddenIntervalMs: () => (alertsOn.current ? LIVE_HIDDEN_POLL_MS : null),
    });
    const onVisibility = () => loop.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      loop.stop();
      window.clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // The filters are compared by value, so a new object with the same filters does not restart the polling.
  }, [guildId, filterKey, listBusy, router]);

  // Next sets the title on every navigation and refresh, so the badge is put back each time and on every count.
  useEffect(() => {
    if (waiting === null) return;
    const set = () => {
      const next = titleWithBadge(document.title, waiting);
      if (document.title !== next) document.title = next;
    };
    set();
    const again = window.setTimeout(set, 300);
    // router.refresh() rewrites the title without a navigation, so the badge is put back whenever the title changes.
    const observer = new MutationObserver(set);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      window.clearTimeout(again);
      observer.disconnect();
    };
  }, [waiting, pathname]);

  useEffect(
    () => () => {
      document.title = titleWithBadge(document.title, 0);
    },
    [],
  );

  async function toggleAlerts() {
    if (!("Notification" in window)) return;
    if (alerts === "on") {
      writeAlerts(guildId, false);
      alertsOn.current = false;
      setAlerts("off");
      return;
    }
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") {
      setAlerts(permission === "denied" ? "blocked" : "off");
      return;
    }
    writeAlerts(guildId, true);
    alertsOn.current = true;
    setAlerts("on");
  }

  const pill = livePillText(change);

  return (
    <div className="tk-live">
      {pill ? (
        <button type="button" className="tk-live-pill" onClick={apply}>
          <ArrowUpIcon />
          {pill}
          <span className="tk-live-pill-action">{change.kind === "new" ? "Show" : "Refresh"}</span>
        </button>
      ) : null}
      {alerts !== "unsupported" ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm tk-live-alerts"
          aria-pressed={alerts === "on"}
          aria-disabled={alerts === "blocked" || undefined}
          title={
            alerts === "blocked"
              ? "Your browser blocks alerts from this dashboard. Allow them in the browser's site settings, then try again."
              : alerts === "on"
                ? "Desktop alerts are on in this browser. Press to turn them off."
                : "Get a desktop alert when a ticket opens or waits on staff while this tab is in the background."
          }
          onClick={() => void toggleAlerts()}
        >
          <BellIcon />
          {alerts === "on" ? "Alerts on" : alerts === "blocked" ? "Alerts blocked" : "Desktop alerts"}
        </button>
      ) : null}
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
