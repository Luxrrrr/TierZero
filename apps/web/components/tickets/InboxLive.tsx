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

/**
 * Keeps the inbox list honest while it is open. The count behind the list is
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
  const stopped = useRef(false);
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
    stopped.current = false;
    setChange({ kind: "none" });
    const controller = new AbortController();
    let timer: number | undefined;

    const poll = async () => {
      const result = await ticketsClient.count(guildId, countFilters(filters, base.current), controller.signal).catch(() => null);
      if (controller.signal.aborted || !result) return;
      if (!result.ok) {
        // A bot older than this dashboard has no count to ask; the list then works as before.
        if (result.status === 404 || result.status === 403) stopped.current = true;
        return;
      }
      const count = result.value;
      setWaiting(count.awaitingStaff);
      if (!base.current) {
        base.current = baselineOf(count);
        latest.current = count;
        return;
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
        return;
      }
      if (next.kind === "activity" && !listBusy() && document.visibilityState === "visible") {
        base.current = baselineOf(count);
        setChange({ kind: "none" });
        router.refresh();
        return;
      }
      if (livePillText(next) !== livePillText(shown.current)) setAnnouncement(liveAnnouncement(next));
      setChange(next);
    };

    const schedule = () => {
      window.clearTimeout(timer);
      if (stopped.current) return;
      const visible = document.visibilityState === "visible";
      if (!visible && !alertsOn.current) return;
      timer = window.setTimeout(async () => {
        await poll();
        if (!controller.signal.aborted) schedule();
      }, visible ? LIVE_POLL_MS : LIVE_HIDDEN_POLL_MS);
    };

    const onVisibility = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "visible") {
        void poll().then(() => {
          if (!controller.signal.aborted) schedule();
        });
      } else schedule();
    };

    void poll().then(() => {
      if (!controller.signal.aborted) schedule();
    });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // The filters are compared by value, so a new object with the same filters does not restart the polling.
  }, [guildId, filterKey, listBusy, router]);

  // Next sets the title on every navigation, so the badge is put back each time and on every count.
  useEffect(() => {
    if (waiting === null) return;
    const set = () => {
      const next = titleWithBadge(document.title, waiting);
      if (document.title !== next) document.title = next;
    };
    set();
    const again = window.setTimeout(set, 300);
    return () => window.clearTimeout(again);
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
