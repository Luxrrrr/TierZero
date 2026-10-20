"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { TicketListFilters, TicketPanelOption, TicketPriority } from "@tier0/shared-tickets";
import { ChevronDownIcon, FilterIcon, SearchIcon, XIcon } from "../Icons";
import { Select } from "../form/Select";
import {
  activeFilterCount,
  inboxHref,
  isMyQueue,
  PRIORITY_LABEL,
  PRIORITY_MENU,
  searchIsBusy,
  transcriptsHref,
  withFilters,
} from "../../lib/ticket-format";

interface Props {
  guildId: string;
  filters: TicketListFilters;
  panels: TicketPanelOption[];
  /** The archive is always closed tickets, so it hides the status switch and offers its own extras. */
  variant: "inbox" | "archive";
  /** The ticket open beside the list, kept open while the filters change. */
  ticketId?: number;
  /** Extra controls for the archive, drawn inside the Filters panel. */
  children?: ReactNode;
  /** The signed-in member, for the My queue switch. */
  viewerId?: string;
}

const STATUS: { value: TicketListFilters["status"]; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

const CLAIMED: { value: TicketListFilters["claimed"]; label: string }[] = [
  { value: "anyone", label: "Everyone's" },
  { value: "me", label: "Mine" },
  { value: "unclaimed", label: "Unclaimed" },
];

const SORTS: { value: TicketListFilters["sort"]; label: string }[] = [
  { value: "activity", label: "Latest activity first" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
];

/**
 * The filters above a list of tickets. The two switches are links, so they
 * work before the page's scripts have loaded; search waits for a pause in
 * typing, and the rest apply as soon as they change. The less used ones fold
 * into a panel that says how many of them are on.
 */
export function TicketFilters({ guildId, filters, panels, variant, ticketId, children, viewerId }: Props) {
  const hrefFor = (next: Partial<TicketListFilters>) =>
    variant === "inbox" ? inboxHref(guildId, next, ticketId) : transcriptsHref(guildId, next);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(filters.q);
  const latest = useRef(filters);
  latest.current = filters;
  const focused = useRef(false);
  const timer = useRef<number | null>(null);

  // Built from the filters as they are when it runs, not when a search was typed.
  const go = (change: Partial<TicketListFilters>) =>
    start(() => router.replace(hrefFor(withFilters(latest.current, change)), { scroll: false }));

  const cancelSearch = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const typed = (value: string) => {
    setQ(value);
    cancelSearch();
    if (value.trim() === latest.current.q) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      go({ q: value.trim() });
    }, 350);
  };

  useEffect(() => cancelSearch, []);

  // The address changed, such as Clear filters being pressed. The box follows
  // it, unless someone is typing in it: the address then lags their typing,
  // and following it would throw away what they typed since.
  useEffect(() => {
    if (!searchIsBusy(focused.current, timer.current !== null)) setQ(filters.q);
  }, [filters.q]);

  const types = panels.flatMap((panel) => panel.types.filter((type) => type.handled));
  const myQueue = variant === "inbox" && viewerId !== undefined && isMyQueue(filters, viewerId);
  // In the inbox the person filter is only ever the viewer's own queue, which has a switch of its own.
  const extra = activeFilterCount(filters, variant === "inbox" ? ["q", "claimed", "handlerId"] : ["q", "claimed"]);

  const toggleType = (id: string) =>
    go({ typeIds: filters.typeIds.includes(id) ? filters.typeIds.filter((t) => t !== id) : [...filters.typeIds, id] });

  return (
    // Changing a filter keeps the open ticket and its reply box as they are, so it never needs to ask about a draft.
    <div className="tk-filters" role="search" aria-label="Filter tickets" data-pending={pending ? "true" : undefined} data-unsaved-guard="ignore">
      <div className="mod-search tk-search">
        <SearchIcon />
        <input
          type="search"
          value={q}
          onChange={(event) => typed(event.target.value)}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              cancelSearch();
              go({ q: q.trim() });
            }
          }}
          placeholder={variant === "inbox" ? "Search subjects, names, messages" : "Search transcripts"}
          aria-label={variant === "inbox" ? "Search tickets" : "Search transcripts"}
        />
      </div>

      <div className="tk-switches">
        {variant === "inbox" ? (
          <nav className="tk-seg" aria-label="Status">
            {STATUS.map((option) => (
              <Link
                key={option.value}
                href={hrefFor(withFilters(filters, { status: option.value }))}
                aria-current={filters.status === option.value ? "true" : undefined}
                scroll={false}
                replace
              >
                {option.label}
              </Link>
            ))}
          </nav>
        ) : null}
        {variant === "inbox" && viewerId ? (
          <Link
            className="mod-chip tk-queue"
            href={hrefFor(withFilters(filters, myQueue ? { handlerId: null } : { handlerId: viewerId, status: "open", claimed: "anyone" }))}
            aria-current={myQueue ? "true" : undefined}
            title="Open tickets you claimed or answered first"
            scroll={false}
            replace
          >
            My queue
          </Link>
        ) : null}
        {variant === "inbox" && filters.handlerId && !myQueue ? (
          // Reached from a handler's row on Stats: their tickets, which the inbox has no other control for.
          <Link className="tk-pill" href={hrefFor(withFilters(filters, { handlerId: null }))} scroll={false} replace>
            Worked by one handler
            <XIcon />
            <span className="visually-hidden">, remove this filter</span>
          </Link>
        ) : null}
        <nav className="tk-seg" aria-label="Claimed by">
          {CLAIMED.map((option) => (
            <Link
              key={option.value}
              href={hrefFor(withFilters(filters, { claimed: option.value }))}
              aria-current={filters.claimed === option.value ? "true" : undefined}
              scroll={false}
              replace
            >
              {option.label}
            </Link>
          ))}
        </nav>
      </div>

      <details className="tk-more" open={extra > 0 ? true : undefined}>
        <summary className="mod-chip">
          <FilterIcon />
          More filters
          {extra > 0 ? <span className="mod-chip-count">{extra} on</span> : null}
          <ChevronDownIcon className="tk-more-chevron" />
        </summary>
        <div className="tk-more-panel">
          {types.length > 1 ? (
            <div className="tk-more-row" role="group" aria-label="Ticket types">
              <span className="tk-more-label" aria-hidden="true">
                Types
              </span>
              <div className="tk-chips">
                {types.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    className="mod-chip"
                    aria-pressed={filters.typeIds.includes(type.id)}
                    onClick={() => toggleType(type.id)}
                  >
                    {type.emoji && !type.emoji.startsWith("<") ? <span aria-hidden="true">{type.emoji}</span> : null}
                    {type.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="tk-more-grid">
            <div className="tk-more-field">
              <span className="tk-more-label" aria-hidden="true">
                Priority
              </span>
              <Select
                size="sm"
                aria-label="Priority"
                value={filters.priority ?? "any"}
                options={[
                  { value: "any", label: "Any priority" },
                  ...PRIORITY_MENU.map((priority) => ({ value: priority, label: PRIORITY_LABEL[priority] })),
                ]}
                onChange={(next) => go({ priority: next === "any" ? null : (next as TicketPriority) })}
              />
            </div>
            <div className="tk-more-field">
              <span className="tk-more-label" aria-hidden="true">
                Order
              </span>
              <Select
                size="sm"
                aria-label="Order"
                value={filters.sort}
                options={SORTS}
                onChange={(next) => go({ sort: next as TicketListFilters["sort"] })}
              />
            </div>
          </div>
          {children}
        </div>
      </details>
    </div>
  );
}
