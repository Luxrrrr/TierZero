import Link from "next/link";
import type { TicketContextDto, TicketListFilters, TicketPage } from "@tier0/core";
import { EmptyState, LoadFailure, Pager, RelativeTime, UserChip, displayName } from "../mod/ModUi";
import { ArchiveIcon, DownloadIcon, EyeIcon, SearchIcon } from "../Icons";
import { activeFilterCount, archiveRowActions, ticketNumber, ticketTitle, transcriptsHref } from "../../lib/ticket-format";
import { listCountText } from "./InboxList";
import type { Loaded } from "./InboxScreen";
import { Stars, TypeTag } from "./TicketBits";
import { TicketFilters } from "./TicketFilters";
import { TranscriptExtras } from "./TranscriptExtras";

/**
 * Every closed ticket, searchable, each one a transcript that opens read-only
 * and downloads as a web page or as text.
 */
export function TranscriptsScreen({
  guildId,
  filters,
  context,
  list,
  retentionNote,
}: {
  guildId: string;
  filters: TicketListFilters;
  context: Loaded<TicketContextDto>;
  list: Loaded<TicketPage>;
  /** How long messages are kept, when the page knows, said once above the list. */
  retentionNote?: string | null;
}) {
  if (!context.ok) {
    return (
      <div className="mod-card">
        <LoadFailure status={context.status} what="the transcripts" retryHref={transcriptsHref(guildId, filters)} />
      </div>
    );
  }
  const handlerName =
    filters.handlerId && list.ok
      ? (list.value.items.map((item) => item.claimedBy).find((user) => user?.userId === filters.handlerId)?.name ?? null)
      : null;
  const filtered = activeFilterCount(filters, ["sort"]) > 0;

  return (
    <div className="mod-page tk-archive">
      <div className="mod-card tk-archive-filters">
        <TicketFilters guildId={guildId} filters={filters} panels={context.value.panels} variant="archive">
          <TranscriptExtras guildId={guildId} filters={filters} handlerName={handlerName} />
        </TicketFilters>
      </div>

      <p className="tk-archive-note">
        Transcripts are saved as messages are sent, so they survive the channel being deleted. Attached files stay on
        Discord; only links to them are kept.{retentionNote ? ` ${retentionNote}` : ""}
      </p>

      <section className="mod-card" aria-label="Closed tickets">
        {!list.ok ? (
          <LoadFailure status={list.status} what="the transcripts" compact retryHref={transcriptsHref(guildId, filters)} />
        ) : list.value.items.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<SearchIcon />}
              title="No transcripts match"
              action={
                <Link className="btn btn-secondary btn-sm" href={transcriptsHref(guildId)}>
                  Clear filters
                </Link>
              }
            >
              Try fewer filters, or a different search.
            </EmptyState>
          ) : (
            <EmptyState icon={<ArchiveIcon />} title="No closed tickets yet">
              When a ticket closes, its transcript is kept here for staff to read and download.
            </EmptyState>
          )
        ) : (
          <>
            <div className="mod-card-head">
              <p className="tk-list-count">{listCountText(list.value.total, "closed")}</p>
            </div>
            <div className="mod-table-wrap">
              <table className="mod-table tk-archive-table">
                <thead>
                  <tr>
                    <th scope="col">Ticket</th>
                    <th scope="col">Type</th>
                    <th scope="col">Opened by</th>
                    <th scope="col">Handled by</th>
                    <th scope="col">Closed</th>
                    <th scope="col">Rating</th>
                    <th scope="col">
                      <span className="visually-hidden">Download</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.value.items.map((ticket) => {
                    const [read, ...downloads] = archiveRowActions(guildId, ticket.id, filters);
                    return (
                    <tr key={ticket.id} className="tk-archive-row">
                      <td data-label="">
                        <Link className="tk-archive-link" href={read!.href}>
                          <span className="tk-row-num">#{ticketNumber(ticket)}</span>
                          <span className="tk-archive-title">{ticketTitle(ticket)}</span>
                        </Link>
                        <span className="tk-archive-sub">
                          {ticket.messageCount} {ticket.messageCount === 1 ? "message" : "messages"}
                        </span>
                      </td>
                      <td data-label="Type">
                        <TypeTag name={ticket.typeName} />
                      </td>
                      <td data-label="Opened by">
                        <UserChip user={ticket.opener} size="sm" />
                      </td>
                      <td data-label="Handled by">
                        {ticket.claimedBy ? (
                          <Link
                            className="tk-archive-handler"
                            href={transcriptsHref(guildId, { ...filters, handlerId: ticket.claimedBy.userId, page: 1 })}
                            title={`Only tickets ${displayName(ticket.claimedBy)} handled`}
                          >
                            <UserChip user={ticket.claimedBy} size="sm" />
                          </Link>
                        ) : (
                          <span className="tk-muted">Nobody</span>
                        )}
                      </td>
                      <td data-label="Closed">{ticket.closedAt ? <RelativeTime iso={ticket.closedAt} /> : null}</td>
                      <td data-label="Rating">{ticket.rating ? <Stars rating={ticket.rating} size="sm" /> : <span className="tk-muted">Not rated</span>}</td>
                      <td data-label="" className="tk-archive-actions">
                        <Link className="btn btn-secondary btn-sm" href={read!.href} tabIndex={-1} aria-hidden="true">
                          <EyeIcon />
                          {read!.label}
                        </Link>
                        {/* Two downloads per row widened the table past its card, so they fold into one menu. */}
                        <details className="tk-dl">
                          <summary className="btn btn-ghost btn-sm" title="Download">
                            <DownloadIcon />
                            <span className="visually-hidden">Download ticket {ticketNumber(ticket)}</span>
                          </summary>
                          <div className="tk-dl-menu">
                            {downloads.map((action) => (
                              <a key={action.kind} href={action.href} download>
                                {action.kind === "html" ? "As a web page" : "As text"}
                              </a>
                            ))}
                          </div>
                        </details>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="tk-list-pager tk-archive-pager">
              <Pager
                page={list.value.page}
                pageSize={list.value.pageSize}
                total={list.value.total}
                hrefFor={(n) => transcriptsHref(guildId, { ...filters, page: n })}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
