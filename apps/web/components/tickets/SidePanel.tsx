"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { TICKET_NOTE_MAX, type TicketDetailDto, type TicketMemberAccess, type TicketPermission } from "@tier0/core";
import { Avatar, LocalTime, RelativeTime, UserChip, displayName } from "../mod/ModUi";
import { PersonMenuArea, PersonMenuButton } from "../mod/PersonMenuArea";
import { CharacterCount } from "../../app/guilds/[id]/mod/members/[userId]/CharacterCount";
import { ExternalLinkIcon, LockIcon, NoteIcon, PencilIcon, PlusIcon, ShieldIcon, ThreadIcon } from "../Icons";
import { durationText, eventLine, inboxHref, PRIORITY_LABEL } from "../../lib/ticket-format";
import { ticketsClient } from "../../lib/tickets-client";
import { MemberSearch } from "./MemberSearch";
import { Stars } from "./TicketBits";
import { useTicketAction } from "./useTicketAction";

const ACCESS_LABEL: Record<TicketMemberAccess, string> = {
  opener: "Opener",
  handler: "Handler",
  observer: "Observer",
  added: "Added",
};

/** What the bot says this viewer may do on this ticket, which is what it will allow. */
const allowed = (ticket: TicketDetailDto, permission: TicketPermission) => ticket.permissions.includes(permission);

interface Props {
  guildId: string;
  ticket: TicketDetailDto;
  /** The viewer is moderation staff, so the opener's profile there opens for them. */
  canModerate: boolean;
  readOnly: boolean;
  onTicket(next: TicketDetailDto): void;
  /** Opens the rename dialog, when the viewer may rename this ticket. */
  onRename?(): void;
}

/**
 * Everything about a ticket that is not the conversation: who opened it and
 * their history here, what they answered, who can see it, staff notes, and
 * what has happened to it.
 */
export function SidePanel({ guildId, ticket, canModerate, readOnly, onTicket, onRename }: Props) {
  const can = (permission: TicketPermission) => !readOnly && allowed(ticket, permission);
  const firstResponse =
    ticket.firstResponseAt !== null ? Date.parse(ticket.firstResponseAt) - Date.parse(ticket.openedAt) : null;

  return (
    <aside className="tk-side" aria-label="Ticket details">
      <Section title="Opened by">
        <div className="tk-opener">
          <UserChip
            user={ticket.opener}
            size="lg"
            sub={
              ticket.openerLeftAt ? (
                <>
                  Left the server <RelativeTime iso={ticket.openerLeftAt} />
                </>
              ) : ticket.openerJoinedAt ? (
                <>
                  Joined <LocalTime iso={ticket.openerJoinedAt} mode="date" />
                </>
              ) : (
                "Joined date unknown"
              )
            }
          />
          <ul className="tk-opener-links">
            <li>
              <Link href={inboxHref(guildId, { status: "all", openerId: ticket.opener.userId })}>
                {ticket.openerTicketCount === 0
                  ? "No other tickets"
                  : `${ticket.openerTicketCount} other ${ticket.openerTicketCount === 1 ? "ticket" : "tickets"}`}
              </Link>
            </li>
            {ticket.openerHasModRecord && canModerate ? (
              <li>
                <Link href={`/guilds/${guildId}/mod/members/${ticket.opener.userId}`}>
                  <ShieldIcon />
                  Moderation history
                </Link>
              </li>
            ) : null}
          </ul>
        </div>
      </Section>

      <Section title="Details">
        <dl className="tk-facts">
          <Fact label="Type">{ticket.typeName || "Ticket"}</Fact>
          <Fact label="Priority">{PRIORITY_LABEL[ticket.priority]}</Fact>
          <Fact label="Claimed by">{ticket.claimedBy ? displayName(ticket.claimedBy) : <span className="tk-muted">Nobody yet</span>}</Fact>
          <Fact label="Opened">
            <RelativeTime iso={ticket.openedAt} />
          </Fact>
          <Fact label="First answer">
            {firstResponse === null ? <span className="tk-muted">Not answered yet</span> : `After ${durationText(firstResponse).toLowerCase()}`}
          </Fact>
          {ticket.closedAt ? (
            <Fact label="Closed">
              <RelativeTime iso={ticket.closedAt} />
              {ticket.closedBy ? ` by ${ticket.closedBy.name}` : ""}
            </Fact>
          ) : null}
          {ticket.closeReason ? <Fact label="Reason">{ticket.closeReason}</Fact> : null}
          <Fact label={ticket.mode === "thread" ? "Thread" : "Channel"}>
            <span className="tk-channel-fact">
              {ticket.channelExists && ticket.discordUrl ? (
                <a href={ticket.discordUrl} target="_blank" rel="noopener noreferrer" className="tk-ext">
                  {ticket.mode === "thread" ? <ThreadIcon /> : "#"}
                  {ticket.channelName || "ticket"}
                  <ExternalLinkIcon />
                  <span className="visually-hidden"> (opens Discord)</span>
                </a>
              ) : (
                <span className="tk-muted">
                  {ticket.mode === "thread" ? "" : "#"}
                  {ticket.channelName || "ticket"}, deleted
                </span>
              )}
              {onRename && !readOnly ? (
                <button type="button" className="tk-link-button" onClick={onRename}>
                  <PencilIcon />
                  Rename<span className="visually-hidden"> the {ticket.mode === "thread" ? "thread" : "channel"}</span>
                </button>
              ) : null}
            </span>
            {ticket.mode === "thread" && ticket.parentChannelId ? (
              <span className="tk-small tk-muted tk-parent">
                In{" "}
                <a href={`https://discord.com/channels/${guildId}/${ticket.parentChannelId}`} target="_blank" rel="noopener noreferrer" className="tk-ext">
                  #{ticket.parentChannelName || "its channel"}
                  <span className="visually-hidden"> (opens Discord)</span>
                </a>
              </span>
            ) : null}
          </Fact>
          {ticket.reopenedCount > 0 ? <Fact label="Reopened">{ticket.reopenedCount === 1 ? "Once" : `${ticket.reopenedCount} times`}</Fact> : null}
        </dl>
      </Section>

      {ticket.answers.length > 0 ? (
        <Section title="Answers">
          <dl className="tk-answers">
            {ticket.answers.map((answer, index) => (
              <div key={index}>
                <dt>{answer.label}</dt>
                <dd>{answer.value || <span className="tk-muted">No answer</span>}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}

      {ticket.rating !== null ? (
        <Section title="Rating">
          <div className="tk-rating">
            <Stars rating={ticket.rating} />
            {ticket.ratedAt ? (
              <span className="tk-muted">
                <RelativeTime iso={ticket.ratedAt} />
              </span>
            ) : null}
          </div>
          {ticket.ratingComment ? <blockquote className="tk-rating-comment">{ticket.ratingComment}</blockquote> : null}
        </Section>
      ) : null}

      <Members guildId={guildId} ticket={ticket} canChange={can("members")} onTicket={onTicket} />

      <Notes guildId={guildId} ticket={ticket} canWrite={allowed(ticket, "note")} onTicket={onTicket} />

      <Section title="Activity">
        {ticket.events.length === 0 ? (
          <p className="tk-muted tk-small">Nothing has happened yet.</p>
        ) : (
          <ol className="tk-activity">
            {ticket.events.map((event) => {
              const line = eventLine(event);
              return (
                <li key={event.id}>
                  <span className="tk-activity-dot" aria-hidden="true" />
                  <span className="tk-activity-text">
                    {line.text}
                    {line.detail ? <span className="tk-activity-detail">{line.detail}</span> : null}
                    <RelativeTime iso={event.createdAt} className="tk-activity-time" />
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </Section>
    </aside>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="tk-side-section" aria-labelledby={id}>
      <div className="tk-side-head">
        <h3 className="tk-side-title" id={id}>
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Members({
  guildId,
  ticket,
  canChange,
  onTicket,
}: {
  guildId: string;
  ticket: TicketDetailDto;
  canChange: boolean;
  onTicket(next: TicketDetailDto): void;
}) {
  const { run, pending } = useTicketAction((result) => onTicket(result.ticket));
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function add(request: { userId: string; name?: string }, who: string) {
    if (pending !== null) return;
    setProblem(null);
    const outcome = await run("add", {
      call: () => ticketsClient.members(guildId, ticket.id, { action: "add", ...request }),
      success: `${who} was added to the ticket`,
      failure: "The member was not added",
      inline: true,
    });
    if (outcome === true) setAdding(false);
    else setProblem(outcome);
  }

  return (
    <Section
      title={`People (${ticket.members.length})`}
      action={
        canChange && !adding ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>
            <PlusIcon />
            Add
          </button>
        ) : null
      }
    >
      {adding ? (
        <div className="tk-add-member">
          <MemberSearch
            guildId={guildId}
            label="Find a member to add"
            exclude={ticket.members.map((member) => member.user.userId)}
            disabled={pending !== null}
            autoFocus
            onPick={(user) => void add({ userId: user.userId }, displayName(user))}
            onName={(name) => void add({ userId: "", name }, name)}
          />
          <p className="tk-small tk-muted">
            They can then read and write in the ticket. Press Enter on a name you typed to add the one member with it.
          </p>
          {problem ? (
            <p className="field-error" role="alert">
              {problem}
            </p>
          ) : null}
          <div className="tk-inline-actions">
            {pending === "add" ? (
              <span className="tk-small tk-muted" role="status">
                <span className="spinner" aria-hidden="true" /> Adding
              </span>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setAdding(false);
                setProblem(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      <ul className="tk-members">
        {ticket.members.map((member) => (
          <li key={`${member.access}-${member.user.userId}`}>
            <PersonMenuArea user={member.user}>
              <Avatar user={member.user} size="sm" menu={false} />
              <span className="tk-member-name">{displayName(member.user)}</span>
              <span className="tk-tag" data-tone={member.access === "handler" ? "staff" : undefined}>
                {ACCESS_LABEL[member.access]}
              </span>
            </PersonMenuArea>
            <PersonMenuButton user={member.user} />
            {canChange && member.access === "added" ? (
              <button
                type="button"
                className="tk-member-remove"
                aria-disabled={pending !== null || undefined}
                onClick={() =>
                  pending === null &&
                  void run(`remove-${member.user.userId}`, {
                    call: () => ticketsClient.members(guildId, ticket.id, { action: "remove", userId: member.user.userId }),
                    success: `${displayName(member.user)} was removed from the ticket`,
                    failure: "The member was not removed",
                  })
                }
              >
                Remove<span className="visually-hidden"> {displayName(member.user)}</span>
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Notes({
  guildId,
  ticket,
  canWrite,
  onTicket,
}: {
  guildId: string;
  ticket: TicketDetailDto;
  canWrite: boolean;
  onTicket(next: TicketDetailDto): void;
}) {
  const { run, pending } = useTicketAction((result) => onTicket(result.ticket));
  const [body, setBody] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const fieldId = useId();

  async function save() {
    const text = body.trim();
    if (text === "") {
      setProblem("Write the note before saving it.");
      return;
    }
    const outcome = await run("note", {
      call: () => ticketsClient.note(guildId, ticket.id, { body: text }),
      success: "Note saved",
      failure: "The note was not saved",
      inline: true,
    });
    if (outcome === true) setBody("");
    else setProblem(outcome);
  }

  return (
    <Section title={`Staff notes (${ticket.notes.length})`}>
      <p className="tk-notes-hint">
        <LockIcon />
        Only staff see these, here in the dashboard. They are never sent to Discord.
      </p>
      {canWrite ? (
        <form
          className="tk-note-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="pf-field-row">
            <label className="tk-small-label" htmlFor={fieldId}>
              Add a note
            </label>
            <CharacterCount length={body.length} limit={TICKET_NOTE_MAX} />
          </div>
          <textarea
            id={fieldId}
            className="textarea tk-note-input"
            rows={2}
            maxLength={TICKET_NOTE_MAX}
            value={body}
            placeholder="Checked the match history, the report holds up"
            aria-invalid={problem ? true : undefined}
            onChange={(event) => {
              setBody(event.target.value);
              setProblem(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void save();
              }
            }}
          />
          {problem ? (
            <p className="field-error" role="alert">
              {problem}
            </p>
          ) : null}
          <div className="tk-inline-actions">
            <button type="submit" className="btn btn-secondary btn-sm" aria-disabled={pending !== null || undefined}>
              <NoteIcon />
              {pending === "note" ? "Saving…" : "Save note"}
            </button>
          </div>
        </form>
      ) : null}
      {ticket.notes.length > 0 ? (
        <ul className="tk-notes">
          {ticket.notes.map((note) => (
            <li key={note.id} className="tk-note">
              <p className="tk-note-head">
                <span className="tk-note-author">{note.author.name}</span>
                <RelativeTime iso={note.createdAt} />
              </p>
              <p className="tk-note-body">{note.body}</p>
            </li>
          ))}
        </ul>
      ) : canWrite ? null : (
        <p className="tk-muted tk-small">No notes.</p>
      )}
    </Section>
  );
}
