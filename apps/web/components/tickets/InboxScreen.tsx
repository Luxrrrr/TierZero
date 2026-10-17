import Link from "next/link";
import type { TicketContextDto, TicketDetailDto, TicketListFilters, TicketMessagesPage, TicketPage } from "@tier0/core";
import { EmptyState, LoadFailure } from "../mod/ModUi";
import { AlertIcon, InboxIcon, InfoIcon } from "../Icons";
import { inboxHref, isMyQueue } from "../../lib/ticket-format";
import { needsFirstRun } from "../../lib/ticket-health";
import { FirstRun } from "./FirstRun";
import { InboxList } from "./InboxList";
import { InboxLive } from "./InboxLive";
import { InboxShortcuts } from "./InboxShortcuts";
import { TicketFilters } from "./TicketFilters";
import { TicketView } from "./TicketView";

const LIST_ID = "tk-inbox-list";

/** A read that may have failed, with the status the bot gave so the failure can be worded. */
export type Loaded<T> = { ok: true; value: T } | { ok: false; status?: number; message: string };

export interface InboxScreenProps {
  guildId: string;
  viewerId: string;
  filters: TicketListFilters;
  context: Loaded<TicketContextDto>;
  list: Loaded<TicketPage>;
  /** The ticket open beside the list, when one is. */
  selected?: Loaded<{ ticket: TicketDetailDto; messages: TicketMessagesPage }> & { id: number };
  canManage: boolean;
  canModerate: boolean;
  /** Whether a closed ticket's channel is kept, when the page knows. */
  archiveOnClose?: boolean | null;
}

/**
 * The inbox: the list of tickets and, on a wide screen, the one being read
 * beside it. On a narrow screen the list is the page, and a ticket is a page
 * of its own with a way back to the list.
 */
export function InboxScreen({ guildId, viewerId, filters, context, list, selected, canManage, canModerate, archiveOnClose }: InboxScreenProps) {
  if (!context.ok) {
    return (
      <div className="mod-card">
        <LoadFailure status={context.status} what="the inbox" retryHref={inboxHref(guildId, filters)} />
      </div>
    );
  }
  const ctx = context.value;
  const untouched = list.ok && list.value.total === 0 && filters.status === "open" && filters.q === "" && filters.typeIds.length === 0;
  const firstRun = untouched && needsFirstRun(ctx);
  const types = ctx.panels.flatMap((panel) => panel.types);
  const legacyPanel = list.ok && list.value.total === 0 && ctx.health.some((issue) => issue.code === "panelLegacy");

  return (
    <div className="tk-inbox-page">
      {!ctx.moduleEnabled ? (
        <div className="callout callout-attention tk-callout">
          <AlertIcon />
          <div>
            <strong>Tickets is turned off for this server.</strong> Members cannot open tickets, and nothing here can be
            changed until it is on again.{" "}
            {canManage ? <Link href={`/guilds/${guildId}/tickets/settings`}>Turn it on in Settings</Link> : "Someone with Manage Server can turn it on."}
          </div>
        </div>
      ) : null}

      {legacyPanel && !firstRun ? (
        <div className="callout callout-info tk-callout">
          <InfoIcon />
          <div>
            <strong>Your panel from before this update is still up and still opens tickets.</strong> New tickets will appear
            here. It cannot be changed from the dashboard until it is posted again.{" "}
            {canManage ? (
              <Link href={`/guilds/${guildId}/tickets/settings#section-panels`}>Post it again in Settings</Link>
            ) : (
              "Someone with Manage Server can post it again."
            )}
          </div>
        </div>
      ) : null}

      {firstRun ? (
        <FirstRun guildId={guildId} panels={ctx.panels} health={ctx.health} canManage={canManage} />
      ) : (
        <div className="tk-inbox" data-has-ticket={selected ? "true" : undefined}>
          <div className="tk-inbox-list mod-card" id={LIST_ID}>
            <TicketFilters guildId={guildId} filters={filters} panels={ctx.panels} variant="inbox" ticketId={selected?.id} viewerId={viewerId} />
            <div className="tk-list-tools">
              {list.ok ? <InboxLive guildId={guildId} filters={filters} listId={LIST_ID} /> : <span />}
              <InboxShortcuts listId={LIST_ID} />
            </div>
            {list.ok ? (
              <InboxList
                guildId={guildId}
                page={list.value}
                filters={filters}
                selectedId={selected?.id}
                types={types}
                myQueue={isMyQueue(filters, viewerId)}
              />
            ) : (
              <LoadFailure status={list.status} what="the tickets" compact retryHref={inboxHref(guildId, filters)} />
            )}
          </div>

          <div className="tk-inbox-ticket">
            {selected ? (
              selected.ok ? (
                <TicketView
                  key={selected.id}
                  guildId={guildId}
                  ticket={selected.value.ticket}
                  messages={selected.value.messages}
                  viewerId={viewerId}
                  panels={ctx.panels}
                  webhooks={ctx.canUseWebhooks}
                  moduleEnabled={ctx.moduleEnabled}
                  canModerate={canModerate}
                  mode="inbox"
                  backHref={inboxHref(guildId, filters)}
                  split
                  archiveOnClose={archiveOnClose ?? (ctx.closeBehaviour ? ctx.closeBehaviour === "archive" : null)}
                  savedReplies={ctx.savedReplies ?? []}
                  replyFiles={ctx.replyFiles ?? null}
                />
              ) : (
                <div className="mod-card tk-pane-empty">
                  {selected.status === 404 ? (
                    <EmptyState
                      icon={<InboxIcon />}
                      title="This ticket was not found"
                      action={
                        <Link className="btn btn-secondary btn-sm" href={inboxHref(guildId, filters)}>
                          Back to the inbox
                        </Link>
                      }
                    >
                      It may have been opened in another server, or the link is mistyped.
                    </EmptyState>
                  ) : selected.status === 403 ? (
                    <EmptyState
                      icon={<InfoIcon />}
                      title="This ticket is not one you handle"
                      action={
                        <Link className="btn btn-secondary btn-sm" href={inboxHref(guildId, filters)}>
                          Back to the inbox
                        </Link>
                      }
                    >
                      Its type is handled by other roles. A manager or an admin role can open it.
                    </EmptyState>
                  ) : (
                    <LoadFailure status={selected.status} what="this ticket" retryHref={inboxHref(guildId, filters, selected.id)} />
                  )}
                </div>
              )
            ) : (
              <div className="mod-card tk-pane-empty tk-pane-placeholder">
                <EmptyState icon={<InboxIcon />} title="Pick a ticket to read it">
                  The conversation, the member who opened it and your team&apos;s notes show here.
                </EmptyState>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
