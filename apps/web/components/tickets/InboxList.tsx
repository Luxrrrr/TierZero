import type { CSSProperties } from "react";
import Link from "next/link";
import type { TicketListFilters, TicketPage, TicketSummaryDto, TicketTypeOption } from "@tier0/core";
import { Avatar, EmptyState, Pager, RelativeTime, displayName } from "../mod/ModUi";
import { InboxIcon, SearchIcon } from "../Icons";
import { activeFilterCount, inboxHref, ticketNumber, ticketTitle } from "../../lib/ticket-format";
import { PriorityTag, TypeTag } from "./TicketBits";

interface Props {
  guildId: string;
  page: TicketPage;
  filters: TicketListFilters;
  selectedId?: number;
  types: TicketTypeOption[];
  /** The list is the viewer's own queue, which has its own way of being empty. */
  myQueue?: boolean;
}

const STATUS_NOUN: Record<TicketListFilters["status"], string> = {
  open: "open ticket",
  closed: "closed ticket",
  all: "ticket",
};

export function listCountText(total: number, status: TicketListFilters["status"]): string {
  const noun = STATUS_NOUN[status];
  return `${total.toLocaleString("en")} ${total === 1 ? noun : `${noun}s`}`;
}

export function InboxList({ guildId, page, filters, selectedId, types, myQueue = false }: Props) {
  const href = (next: Partial<TicketListFilters>, ticketId?: number) => inboxHref(guildId, next, ticketId);
  const emoji = new Map(types.map((type) => [type.id, type.emoji]));
  const filtered = activeFilterCount(filters, ["sort"]) > 0;

  if (page.items.length === 0) {
    return (
      <div className="tk-list tk-list--empty">
        {myQueue && activeFilterCount(filters, ["sort", "handlerId"]) === 0 ? (
          <EmptyState
            icon={<InboxIcon />}
            title="Nothing in your queue"
            compact
            action={
              <Link className="btn btn-secondary btn-sm" href={href({ status: filters.status })}>
                Show every open ticket
              </Link>
            }
          >
            Tickets you claim or answer first show here while they are open.
          </EmptyState>
        ) : filtered ? (
          <EmptyState
            icon={<SearchIcon />}
            title="No tickets match"
            compact
            action={
              <Link className="btn btn-secondary btn-sm" href={href({ status: filters.status })}>
                Clear filters
              </Link>
            }
          >
            Try fewer filters, or a different search.
          </EmptyState>
        ) : (
          <EmptyState icon={<InboxIcon />} title={filters.status === "closed" ? "No closed tickets yet" : "All caught up"} compact>
            {filters.status === "closed"
              ? "Tickets show up here once they are closed."
              : "No ticket is waiting. This list checks for new ones every few seconds while it is open."}
          </EmptyState>
        )}
      </div>
    );
  }

  const anyWaiting = page.items.some((ticket) => ticket.status === "open" && ticket.awaitingStaff);

  return (
    <div className="tk-list">
      <p className="tk-list-count">
        {listCountText(page.total, filters.status)}
        {anyWaiting ? (
          <span className="tk-list-legend">
            <span className="tk-waiting" aria-hidden="true" />
            Waiting on staff
          </span>
        ) : null}
      </p>
      <ul className="tk-rows">
        {page.items.map((ticket, index) => (
          <li key={ticket.id} className="tk-row-item" style={{ "--i": index } as CSSProperties}>
            <InboxRow
              ticket={ticket}
              href={href(filters, ticket.id)}
              selected={ticket.id === selectedId}
              emoji={ticket.typeId ? (emoji.get(ticket.typeId) ?? null) : null}
            />
          </li>
        ))}
      </ul>
      <div className="tk-list-pager" data-unsaved-guard="ignore">
        <Pager page={page.page} pageSize={page.pageSize} total={page.total} hrefFor={(n) => href({ ...filters, page: n })} />
      </div>
    </div>
  );
}

function InboxRow({
  ticket,
  href,
  selected,
  emoji,
}: {
  ticket: TicketSummaryDto;
  href: string;
  selected: boolean;
  emoji: string | null;
}) {
  const waiting = ticket.status === "open" && ticket.awaitingStaff;
  return (
    <Link
      className="tk-row"
      href={href}
      scroll={false}
      aria-current={selected ? "page" : undefined}
      data-waiting={waiting ? "true" : undefined}
      data-closed={ticket.status === "closed" ? "true" : undefined}
    >
      <span className="tk-row-top">
        <span className="tk-row-num">#{ticketNumber(ticket)}</span>
        <PriorityTag priority={ticket.priority} />
        <span className="tk-row-time" title="Last message or change">
          {ticket.status === "open" ? "active " : "closed "}
          <RelativeTime iso={ticket.status === "open" ? ticket.lastActivityAt : (ticket.closedAt ?? ticket.lastActivityAt)} />
        </span>
      </span>
      <span className="tk-row-title">
        {waiting ? (
          <>
            <span className="tk-waiting" aria-hidden="true" title="Waiting on staff: the member wrote last" />
            <span className="visually-hidden">Waiting on staff: </span>
          </>
        ) : null}
        <span className="tk-row-title-text">{ticketTitle(ticket)}</span>
      </span>
      <span className="tk-row-meta">
        <span className="tk-row-opener">
          <Avatar user={ticket.opener} size="sm" />
          <span className="tk-row-name">{displayName(ticket.opener)}</span>
        </span>
        <TypeTag name={ticket.typeName} emoji={emoji} />
        {ticket.claimedBy ? (
          <span className="tk-row-claim" title={`Claimed by ${displayName(ticket.claimedBy)}`}>
            <span className="visually-hidden">Claimed by {displayName(ticket.claimedBy)}</span>
            <Avatar user={ticket.claimedBy} size="sm" />
          </span>
        ) : null}
      </span>
    </Link>
  );
}
