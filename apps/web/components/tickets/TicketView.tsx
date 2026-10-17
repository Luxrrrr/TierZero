"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  TicketDetailDto,
  TicketMessagesPage,
  TicketPanelOption,
  TicketPermission,
  TicketPriority,
  TicketSavedReplyDto,
} from "@tier0/core";
import { displayName, LocalTime, RelativeTime } from "../mod/ModUi";
import { Select } from "../form/Select";
import { useToast } from "../Toaster";
import {
  ArchiveIcon,
  ChevronLeftIcon,
  DoorIcon,
  DownloadIcon,
  ExternalLinkIcon,
  InfoIcon,
  LockIcon,
  SwapIcon,
  ThreadIcon,
  TrashIcon,
  UndoIcon,
  UserIcon,
} from "../Icons";
import {
  PRIORITY_LABEL,
  PRIORITY_MENU,
  removalNotice,
  ticketNumber,
  ticketTitle,
  transcriptDeletedText,
  transcriptIsEmpty,
  transcriptPageHref,
} from "../../lib/ticket-format";
import type { ReplyFileLimits } from "../../lib/ticket-composer";
import { ticketsClient, transcriptHref } from "../../lib/tickets-client";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";
import { SidePanel } from "./SidePanel";
import { CloseDialog, ConfirmDialog, RenameDialog, RequestCloseDialog, TransferDialog } from "./TicketDialogs";
import { PriorityTag, TicketStatusPill, TypeTag } from "./TicketBits";
import { useTicketAction } from "./useTicketAction";
import { useTicketMessages } from "./useTicketMessages";
import { useTicketRefresh } from "./useTicketRefresh";

export interface TicketViewProps {
  guildId: string;
  ticket: TicketDetailDto;
  messages: TicketMessagesPage;
  viewerId: string;
  panels: TicketPanelOption[];
  /** The bot can post replies under the staff member's own name. */
  webhooks: boolean;
  /** The Tickets feature is on; the bot refuses every change while it is off. */
  moduleEnabled: boolean;
  canModerate: boolean;
  /** The workspace, or the read-only archive. */
  mode: "inbox" | "transcript";
  /** Where the back link goes on a narrow screen. */
  backHref: string;
  /** Beside the inbox list, where the pane scrolls on its own. */
  split: boolean;
  /** Whether a closed ticket's channel is kept, when the page knows. */
  archiveOnClose?: boolean | null;
  /** The server's saved replies, for the reply box. */
  savedReplies?: readonly TicketSavedReplyDto[];
  /** What a reply may attach, or null when the bot takes no files from the dashboard. */
  replyFiles?: ReplyFileLimits | null;
}

type Dialog = "close" | "transfer" | "delete" | "rename" | "requestClose" | null;

/**
 * One ticket: its header and controls, the conversation, and the details
 * beside it. Changes the bot confirms replace the ticket shown at once, and
 * the page's server data is read again so the inbox list agrees.
 */
export function TicketView(props: TicketViewProps) {
  const { guildId, viewerId, panels, webhooks, moduleEnabled, canModerate, mode, backHref, split } = props;
  const router = useRouter();
  const [ticket, setTicket] = useState(props.ticket);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pane, setPane] = useState<"conversation" | "details">("conversation");
  const [priority, setPriority] = useState<TicketPriority>(props.ticket.priority);

  useEffect(() => {
    setTicket(props.ticket);
    setPriority(props.ticket.priority);
  }, [props.ticket]);

  const readOnly = mode === "transcript";
  const live = !readOnly && ticket.status === "open";
  const feed = useTicketMessages({ guildId, ticketId: ticket.id, initial: props.messages, viewerId, live });
  const { run, pending } = useTicketAction((result) => {
    setTicket(result.ticket);
    setPriority(result.ticket.priority);
  });
  const toast = useToast();
  useTicketRefresh({
    guildId,
    ticketId: ticket.id,
    live,
    busy: pending !== null || dialog !== null,
    onTicket: (next) => {
      setTicket(next);
      setPriority(next.priority);
    },
  });

  const can = (permission: TicketPermission) => !readOnly && moduleEnabled && ticket.permissions.includes(permission);
  const claimedByMe = ticket.claimedBy?.userId === viewerId;
  const number = ticketNumber(ticket);
  const removal = removalNotice(ticket, props.messages);
  // Nothing is left to download once the messages are gone, and an empty file only looks like a fault.
  const empty = ticket.status === "closed" && transcriptIsEmpty(ticket, { items: feed.messages, pruned: props.messages.pruned });
  const otherTypes = panels.flatMap((panel) => panel.types).filter((type) => type.id !== ticket.typeId);

  const replyBlocked = (() => {
    if (readOnly) return null;
    if (!moduleEnabled) return "Tickets is turned off for this server, so replies cannot be sent. A manager can turn it on in Settings.";
    if (ticket.status !== "open") {
      return ticket.permissions.includes("reopen")
        ? "This ticket is closed. Reopen it to reply."
        : "This ticket is closed, so it cannot be answered any more.";
    }
    if (!ticket.channelExists) return "The ticket's channel no longer exists in Discord, so a reply has nowhere to go.";
    if (ticket.permissions.includes("reply")) return null;
    if (ticket.claimedBy && !claimedByMe) {
      return `${displayName(ticket.claimedBy)} has claimed this ticket, and claimed tickets can only be answered by whoever claimed them.`;
    }
    return "You cannot reply to this ticket.";
  })();

  const changePriority = async (next: TicketPriority) => {
    const before = priority;
    setPriority(next);
    const outcome = await run("priority", {
      call: () => ticketsClient.priority(guildId, ticket.id, { priority: next }),
      success: `Priority set to ${PRIORITY_LABEL[next].toLowerCase()}`,
      failure: "The priority was not changed",
    });
    if (outcome !== true) setPriority(before);
  };

  const claim = () =>
    run("claim", {
      call: () => ticketsClient.claim(guildId, ticket.id),
      success: ticket.claimedBy ? "You took over the ticket" : "You claimed the ticket",
      failure: "The ticket was not claimed",
    });
  const unclaim = () =>
    run("unclaim", {
      call: () => ticketsClient.unclaim(guildId, ticket.id),
      success: "The ticket is unclaimed",
      failure: "The ticket is still claimed",
    });
  const reopen = () =>
    run("reopen", {
      call: () => ticketsClient.reopen(guildId, ticket.id),
      success: "Ticket reopened",
      failure: "The ticket was not reopened",
    });

  const busy = pending !== null;

  return (
    <article className="tk-view" data-split={split ? "true" : undefined} data-pane={pane} aria-labelledby={`ticket-${ticket.id}-title`}>
      <header className="tk-head">
        <div className="tk-head-row">
          <Link className="tk-back" href={backHref} data-always={readOnly || !split ? "true" : undefined}>
            <ChevronLeftIcon />
            {readOnly ? "All transcripts" : "Inbox"}
          </Link>
          <span className="tk-head-num">#{number}</span>
          <TypeTag name={ticket.typeName} />
          {ticket.mode === "thread" ? (
            <span className="tk-tag tk-thread-tag">
              <ThreadIcon />
              Thread
            </span>
          ) : null}
          <TicketStatusPill ticket={ticket} />
          <PriorityTag priority={ticket.priority} />
          <span className="tk-spacer" />
          {ticket.discordUrl && ticket.channelExists ? (
            <a className="btn btn-ghost btn-sm" href={ticket.discordUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon />
              Open in Discord
            </a>
          ) : null}
        </div>
        <h2 className="tk-head-title" id={`ticket-${ticket.id}-title`}>
          {ticketTitle(ticket)}
        </h2>
        <p className="tk-head-sub">
          {displayName(ticket.opener)} opened it <RelativeTime iso={ticket.openedAt} />
          {ticket.claimedBy ? <> · claimed by {claimedByMe ? "you" : displayName(ticket.claimedBy)}</> : <> · unclaimed</>}
          {ticket.status === "open" ? (
            <>
              {" "}
              · last activity <RelativeTime iso={ticket.lastActivityAt} />
            </>
          ) : null}
        </p>

        {readOnly ? (
          <div className="tk-head-actions">
            {empty ? null : (
              <>
                <a className="btn btn-secondary btn-sm" href={transcriptHref(guildId, ticket.id, "html")} download>
                  <DownloadIcon />
                  Download as web page
                </a>
                <a className="btn btn-secondary btn-sm" href={transcriptHref(guildId, ticket.id, "txt")} download>
                  <DownloadIcon />
                  Download as text
                </a>
              </>
            )}
            {ticket.permissions.includes("deleteTranscript") && !empty ? (
              <button type="button" className="btn btn-ghost btn-sm tk-danger-text" onClick={() => setDialog("delete")}>
                <TrashIcon />
                Delete transcript
              </button>
            ) : null}
          </div>
        ) : (
          <div className="tk-head-actions">
            <div className="tk-priority-pick">
              <span className="tk-priority-label" id={`ticket-${ticket.id}-priority`}>
                Priority
              </span>
              <Select
                size="sm"
                aria-labelledby={`ticket-${ticket.id}-priority`}
                value={priority}
                disabled={!can("priority") || busy}
                options={PRIORITY_MENU.map((value) => ({ value, label: PRIORITY_LABEL[value] }))}
                onChange={(next) => void changePriority(next as TicketPriority)}
              />
            </div>
            {can("claim") ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-shortcut="claim"
                aria-disabled={busy || undefined}
                onClick={() => !busy && void claim()}
              >
                <UserIcon />
                {pending === "claim" ? "Claiming…" : ticket.claimedBy ? "Take over" : "Claim"}
              </button>
            ) : null}
            {can("unclaim") ? (
              <button type="button" className="btn btn-ghost btn-sm" aria-disabled={busy || undefined} onClick={() => !busy && void unclaim()}>
                {pending === "unclaim" ? "Unclaiming…" : "Unclaim"}
              </button>
            ) : null}
            {can("transfer") && otherTypes.length > 0 ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog("transfer")}>
                <SwapIcon />
                Move
              </button>
            ) : null}
            <span className="tk-spacer" />
            {ticket.status === "closed" ? (
              <>
                <Link className="btn btn-secondary btn-sm" href={transcriptPageHref(guildId, ticket.id)}>
                  <ArchiveIcon />
                  Open transcript
                </Link>
                {empty ? null : (
                  <a className="btn btn-ghost btn-sm" href={transcriptHref(guildId, ticket.id, "html")} download>
                    <DownloadIcon />
                    Web page<span className="visually-hidden"> of ticket {number}</span>
                  </a>
                )}
              </>
            ) : null}
            {can("requestClose") ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setDialog("requestClose")}
                title={ticket.closeRequestedAt ? "Already asked; asking again sends the question again" : undefined}
              >
                <DoorIcon />
                Ask to close
              </button>
            ) : null}
            {can("close") ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog("close")}>
                <LockIcon />
                Close
              </button>
            ) : null}
            {can("reopen") ? (
              <button type="button" className="btn btn-primary btn-sm" aria-disabled={busy || undefined} onClick={() => !busy && void reopen()}>
                <UndoIcon />
                {pending === "reopen" ? "Reopening…" : "Reopen"}
              </button>
            ) : null}
          </div>
        )}
      </header>

      <div className="tk-pane-switch" role="group" aria-label="Show">
        <button type="button" aria-pressed={pane === "conversation"} onClick={() => setPane("conversation")}>
          Conversation
        </button>
        <button type="button" aria-pressed={pane === "details"} onClick={() => setPane("details")}>
          Details
          {ticket.notes.length > 0 ? <span className="mod-tab-count">{ticket.notes.length}</span> : null}
        </button>
      </div>

      {ticket.openerLeftAt && ticket.status === "open" ? (
        <div className="callout callout-attention tk-callout tk-opener-left">
          <InfoIcon />
          <div>
            <strong>{displayName(ticket.opener)} left the server</strong> <RelativeTime iso={ticket.openerLeftAt} />. They
            cannot read replies here any more. Close the ticket once nothing is left to do, or keep it open in case they
            come back.
          </div>
        </div>
      ) : null}

      {feed.messages.length === 0 && ticket.closedAt && !feed.catchingUp && removal ? (
        <p className="callout callout-muted tk-pruned">
          {removal.kind === "deleted" ? (
            <>
              The messages of this ticket were deleted{removal.by ? ` by ${removal.by}` : ""} on{" "}
              <LocalTime iso={removal.at} mode="date" />. Its details and notes are kept, and there is nothing left to
              download.
            </>
          ) : (
            <>
              The messages of this ticket were deleted
              {removal.at ? (
                <>
                  {" "}
                  on <LocalTime iso={removal.at} mode="date" />,
                </>
              ) : null}{" "}
              after the number of days set under Transcripts. Its details and notes are kept.
            </>
          )}
        </p>
      ) : null}

      <div className="tk-body">
        <Conversation
          ticket={ticket}
          messages={feed.messages}
          catchingUp={feed.catchingUp}
          failed={feed.failed}
          announcement={feed.announcement}
          arrived={feed.arrived}
          viewerId={viewerId}
          contained={split}
          footer={
            readOnly ? null : (
              <Composer
                key={ticket.id}
                guildId={guildId}
                ticket={ticket}
                viewerId={viewerId}
                openerName={displayName(ticket.opener)}
                webhooks={webhooks}
                blocked={replyBlocked}
                savedReplies={props.savedReplies ?? []}
                replyFiles={props.replyFiles ?? null}
                onSent={feed.add}
              />
            )
          }
        />
        <SidePanel
          guildId={guildId}
          ticket={ticket}
          canModerate={canModerate}
          readOnly={readOnly || !moduleEnabled}
          onTicket={setTicket}
          onRename={can("rename") ? () => setDialog("rename") : undefined}
        />
      </div>

      {dialog === "close" ? (
        <CloseDialog
          number={number}
          archive={props.archiveOnClose ?? null}
          reasonRequired={panels.flatMap((panel) => panel.types).find((type) => type.id === ticket.typeId)?.requireReason === true}
          onClose={() => setDialog(null)}
          onConfirm={(reason) =>
            run("close", {
              call: () => ticketsClient.close(guildId, ticket.id, { reason }),
              success: `Ticket #${number} closed`,
              failure: "The ticket was not closed",
              inline: true,
            })
          }
        />
      ) : null}
      {dialog === "transfer" ? (
        <TransferDialog
          number={number}
          currentTypeId={ticket.typeId}
          panels={panels}
          onClose={() => setDialog(null)}
          onConfirm={(typeId) =>
            run("transfer", {
              call: () => ticketsClient.transfer(guildId, ticket.id, { typeId }),
              success: "Ticket moved",
              failure: "The ticket was not moved",
              inline: true,
            })
          }
        />
      ) : null}
      {dialog === "delete" ? (
        <ConfirmDialog
          title={`Delete the transcript of #${number}?`}
          confirm="Delete transcript"
          body={
            <>
              Every saved message of this ticket is deleted for good. Its details, notes and rating stay, and the deletion is
              recorded with your name. Files attached in Discord are not touched.
            </>
          }
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            // Answered with a count rather than a ticket, so it is handled here
            // instead of by the shared runner, which expects the ticket back.
            const result = await ticketsClient.deleteTranscript(guildId, ticket.id);
            if (!result.ok) return result.error;
            toast.push({ kind: "success", title: transcriptDeletedText(number, result.value) });
            router.push(backHref);
            router.refresh();
            return true;
          }}
        />
      ) : null}
      {dialog === "rename" ? (
        <RenameDialog
          number={number}
          current={ticket.channelName}
          thread={ticket.mode === "thread"}
          onClose={() => setDialog(null)}
          onConfirm={(name) =>
            run("rename", {
              call: () => ticketsClient.rename(guildId, ticket.id, { name }),
              success: "Renamed in Discord",
              failure: "The ticket was not renamed",
              inline: true,
            })
          }
        />
      ) : null}
      {dialog === "requestClose" ? (
        <RequestCloseDialog
          number={number}
          openerName={displayName(ticket.opener)}
          onClose={() => setDialog(null)}
          onConfirm={(reason) =>
            run("requestClose", {
              call: () => ticketsClient.requestClose(guildId, ticket.id, { reason }),
              success: `${displayName(ticket.opener)} was asked whether the ticket can close`,
              failure: "The question was not sent",
              inline: true,
            })
          }
        />
      ) : null}
    </article>
  );
}
