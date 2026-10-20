import Link from "next/link";
import type { TicketContextDto, TicketDetailDto, TicketListFilters, TicketMessagesPage } from "@tier0/shared-tickets";
import { EmptyState, LoadFailure } from "../mod/ModUi";
import { InfoIcon } from "../Icons";
import { inboxHref, ticketNumber, transcriptsHref } from "../../lib/ticket-format";
import type { Loaded } from "./InboxScreen";
import { TicketView } from "./TicketView";

/**
 * One transcript, read-only. An open ticket has no transcript yet, so a link
 * to one sends the reader to the inbox where it can be worked.
 */
export function TranscriptScreen({
  guildId,
  viewerId,
  filters,
  context,
  ticket,
  messages,
  canModerate,
}: {
  guildId: string;
  viewerId: string;
  filters: TicketListFilters;
  context: Loaded<TicketContextDto>;
  ticket: Loaded<TicketDetailDto>;
  messages: Loaded<TicketMessagesPage>;
  canModerate: boolean;
}) {
  const back = transcriptsHref(guildId, filters);
  if (!ticket.ok) {
    return (
      <div className="mod-card">
        {ticket.status === 403 ? (
          <EmptyState
            icon={<InfoIcon />}
            title="This transcript is not one you can read"
            action={
              <Link className="btn btn-secondary btn-sm" href={back}>
                All transcripts
              </Link>
            }
          >
            Its type is handled by other roles. A manager or an admin role can open it.
          </EmptyState>
        ) : (
          <LoadFailure status={ticket.status} what="this transcript" retryHref={back} />
        )}
      </div>
    );
  }

  const detail = ticket.value;
  if (detail.status === "open") {
    return (
      <div className="mod-card">
        <EmptyState
          icon={<InfoIcon />}
          title={`Ticket #${ticketNumber(detail)} is still open`}
          action={
            <Link className="btn btn-primary btn-sm" href={inboxHref(guildId, {}, detail.id)}>
              Open it in the inbox
            </Link>
          }
        >
          Its transcript is complete once it closes. Until then it is worked from the inbox.
        </EmptyState>
      </div>
    );
  }

  const page: TicketMessagesPage = messages.ok
    ? messages.value
    : { items: [], cursor: null, hasMore: false, pruned: false, removal: null, changed: [], updatedSince: new Date(0).toISOString() };

  return (
    <div className="tk-transcript">
      {!messages.ok ? (
        <div className="callout callout-error tk-callout" role="alert">
          <InfoIcon />
          <div>
            <strong>The messages could not be loaded.</strong> {messages.message} The details beside them are current.
          </div>
        </div>
      ) : null}
      <TicketView
        guildId={guildId}
        ticket={detail}
        messages={page}
        viewerId={viewerId}
        panels={context.ok ? context.value.panels : []}
        webhooks={context.ok ? context.value.canUseWebhooks : false}
        moduleEnabled={context.ok ? context.value.moduleEnabled : true}
        canModerate={canModerate}
        mode="transcript"
        backHref={back}
        split={false}
      />
    </div>
  );
}
