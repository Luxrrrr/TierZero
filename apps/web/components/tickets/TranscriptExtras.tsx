"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TicketListFilters } from "@tier0/shared-tickets";
import { DateRangePicker } from "../form/DateRangePicker";
import { Select } from "../form/Select";
import { XIcon } from "../Icons";
import { transcriptsHref, withFilters } from "../../lib/ticket-format";

/** The filters only the archive has: rating, the days a ticket opened on, and who handled it. */
export function TranscriptExtras({
  guildId,
  filters,
  handlerName,
}: {
  guildId: string;
  filters: TicketListFilters;
  /** The name of the handler being filtered on, when the page has it. */
  handlerName: string | null;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const go = (change: Partial<TicketListFilters>) =>
    start(() => router.replace(transcriptsHref(guildId, withFilters(filters, change)), { scroll: false }));

  return (
    <>
      <div className="tk-more-grid">
        <div className="tk-more-field">
          <span className="tk-more-label" aria-hidden="true">
            Rating
          </span>
          <Select
            size="sm"
            aria-label="Rating"
            value={filters.rating === null ? "any" : String(filters.rating)}
            options={[
              { value: "any", label: "Any rating" },
              ...[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: n === 1 ? "1 star" : `${n} stars` })),
            ]}
            onChange={(next) => go({ rating: next === "any" ? null : Number(next) })}
          />
        </div>
        <div className="tk-more-field">
          <span className="tk-more-label" aria-hidden="true">
            Opened
          </span>
          <DateRangePicker
            since={filters.from ?? ""}
            until={filters.to ?? ""}
            aria-label="Days the ticket was opened"
            onChange={(range) => go({ from: range.since || null, to: range.until || null })}
          />
        </div>
      </div>
      {filters.handlerId ? (
        <div className="tk-more-row">
          <button type="button" className="tk-pill" onClick={() => go({ handlerId: null })}>
            Handled by {handlerName ?? "one person"}
            <XIcon />
            <span className="visually-hidden">, remove this filter</span>
          </button>
        </div>
      ) : (
        <p className="tk-small tk-muted">Select a name in the Handled by column to see only their tickets.</p>
      )}
    </>
  );
}
