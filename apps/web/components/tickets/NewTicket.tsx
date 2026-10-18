"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TICKET_CREATE_MEMBERS_MAX,
  TICKET_CREATE_MESSAGE_MAX,
  TICKET_CREATE_SUBJECT_MAX,
  type TicketPanelOption,
  type TicketTypeOption,
  type UserRef,
} from "@tier0/core";
import { DialogShell } from "../../app/guilds/[id]/mod/members/[userId]/Dialog";
import { CharacterCount } from "../../app/guilds/[id]/mod/members/[userId]/CharacterCount";
import { Avatar, displayName } from "../mod/ModUi";
import { ChevronDownIcon, PlusIcon, TicketIcon, XIcon } from "../Icons";
import { useToast } from "../Toaster";
import { typeProblemText } from "../../lib/ticket-health";
import { inboxHref } from "../../lib/ticket-format";
import { ticketsClient } from "../../lib/tickets-client";
import {
  creatableTypes,
  createFailureText,
  createRequest,
  draftProblem,
  emptyDraft,
  openableTypes,
  withMember,
  type CreateDraft,
} from "../../lib/ticket-create";
import { MemberSearch } from "./MemberSearch";

/**
 * The inbox's New ticket button. It is there for anyone who handles at least
 * one type, and the shortcut `n` presses it. Staff use it to talk to someone:
 * they pick a type and who joins, and the conversation starts in Discord.
 */
export function NewTicket({ guildId, panels, viewerId, enabled }: { guildId: string; panels: TicketPanelOption[]; viewerId: string; enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const groups = creatableTypes(panels);
  if (groups.length === 0) return null;
  return (
    <>
      <button
        type="button"
        className="btn btn-primary btn-sm tk-new-ticket"
        data-shortcut="new-ticket"
        aria-disabled={!enabled || undefined}
        title={enabled ? undefined : "Tickets is turned off for this server"}
        onClick={() => enabled && setOpen(true)}
      >
        <PlusIcon />
        New ticket
      </button>
      {open ? <NewTicketDialog guildId={guildId} panels={panels} viewerId={viewerId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function NewTicketDialog({ guildId, panels, viewerId, onClose }: { guildId: string; panels: TicketPanelOption[]; viewerId: string; onClose(): void }) {
  const router = useRouter();
  const toast = useToast();
  const groups = creatableTypes(panels);
  const openable = openableTypes(groups);
  const [draft, setDraft] = useState<CreateDraft>(() => emptyDraft(openable.length === 1 ? openable[0]!.id : null));
  const [problem, setProblem] = useState<string | null>(null);
  const [memberProblem, setMemberProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const ids = { body: useId(), subject: useId(), message: useId(), answers: useId() };

  const chosen: TicketTypeOption | undefined = groups.flatMap((group) => group.types).find((type) => type.id === draft.typeId);
  const questions = chosen?.questions ?? [];
  const full = draft.members.length >= TICKET_CREATE_MEMBERS_MAX;

  const change = (next: Partial<CreateDraft>) => {
    setDraft((current) => ({ ...current, ...next }));
    setProblem(null);
    setError(null);
  };

  const pickMember = (user: UserRef) => {
    const result = withMember(draft.members, user);
    setMemberProblem(result.problem);
    if (!result.problem) change({ members: result.members });
  };

  async function submit() {
    if (running.current) return;
    const why = draftProblem(draft, chosen);
    if (why || !chosen) {
      setProblem(why);
      return;
    }
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await ticketsClient.create(guildId, createRequest(draft, chosen));
      if (!result.ok) {
        setError(createFailureText(result.status, result.error));
        return;
      }
      toast.push({
        kind: "success",
        title: `Opened ticket #${result.value.number}`,
        detail: result.value.notes.length > 0 ? result.value.notes.join(" ") : undefined,
      });
      onClose();
      router.push(inboxHref(guildId, {}, result.value.id));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <DialogShell title="New ticket" icon={<TicketIcon />} tone="default" descriptionId={ids.body} onClose={onClose} locked={busy} layout="form">
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="pf-dialog-body">
          <p className="pf-dialog-text" id={ids.body}>
            Opens a ticket in Discord with the members you add, and you are its opener. Nothing is checked against the member
            rules, such as limits or cooldowns, and nobody is asked to rate it.
          </p>

          <fieldset className="tk-choices">
            <legend className="pf-field-label">Type</legend>
            {groups.map((group) => (
              <div key={group.id} className="tk-choice-group">
                {groups.length > 1 ? <p className="tk-choice-panel">{group.name}</p> : null}
                {group.types.map((type) => {
                  const why = type.problem ? typeProblemText(type.problem) : null;
                  const noteId = `${ids.body}-${type.id}-note`;
                  return (
                    <label key={type.id} className="tk-choice" data-checked={draft.typeId === type.id ? "true" : undefined} data-unavailable={why ? "true" : undefined}>
                      <input
                        type="radio"
                        name="new-ticket-type"
                        value={type.id}
                        checked={draft.typeId === type.id}
                        disabled={busy || why !== null}
                        aria-describedby={why ? noteId : undefined}
                        onChange={() => change({ typeId: type.id, answers: [] })}
                        {...(draft.typeId === null && type === openable[0] ? { "data-autofocus": true } : {})}
                      />
                      <span className="tk-choice-text">
                        {type.emoji && !type.emoji.startsWith("<") ? <span aria-hidden="true">{type.emoji} </span> : null}
                        {type.name}
                        {why ? (
                          <span className="tk-choice-why" id={noteId}>
                            {why} Fix it in Settings first.
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}
          </fieldset>

          <div className="pf-field">
            <div className="pf-field-row">
              <label className="pf-field-label" htmlFor={ids.subject}>
                Subject <span className="tk-muted tk-small">Optional</span>
              </label>
              <CharacterCount length={draft.subject.length} limit={TICKET_CREATE_SUBJECT_MAX} />
            </div>
            <input
              id={ids.subject}
              className="input"
              type="text"
              maxLength={TICKET_CREATE_SUBJECT_MAX}
              value={draft.subject}
              disabled={busy}
              placeholder="Ranked match on Friday"
              onChange={(event) => change({ subject: event.target.value })}
            />
          </div>

          {questions.length > 0 ? (
            <details className="tk-more">
              <summary className="mod-chip">
                Form answers
                <ChevronDownIcon className="tk-more-chevron" />
              </summary>
              <div className="tk-more-panel">
                <p className="pf-field-hint">The type&apos;s questions. Staff can leave them all empty.</p>
                {questions.map((question, index) => {
                  const fieldId = `${ids.answers}-${index}`;
                  return (
                    <div key={`${draft.typeId}-${index}`} className="pf-field">
                      <label className="pf-field-label" htmlFor={fieldId}>
                        {question.label}
                      </label>
                      {question.style === "paragraph" ? (
                        <textarea
                          id={fieldId}
                          className="textarea"
                          rows={3}
                          maxLength={question.maxLength ?? 4000}
                          value={draft.answers[index] ?? ""}
                          disabled={busy}
                          onChange={(event) => change({ answers: withAnswer(draft.answers, index, event.target.value) })}
                        />
                      ) : (
                        <input
                          id={fieldId}
                          className="input"
                          type="text"
                          maxLength={question.maxLength ?? 4000}
                          value={draft.answers[index] ?? ""}
                          disabled={busy}
                          onChange={(event) => change({ answers: withAnswer(draft.answers, index, event.target.value) })}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
          ) : null}

          <div className="pf-field">
            <MemberSearch
              guildId={guildId}
              label="Members to add"
              placeholder="Search by name"
              exclude={[viewerId, ...draft.members.map((member) => member.userId)]}
              disabled={busy || full}
              onPick={pickMember}
            />
            <p className="pf-field-hint" aria-live="polite">
              {full
                ? `That is the most a ticket can start with. You can add others from the ticket afterwards.`
                : `${draft.members.length} of ${TICKET_CREATE_MEMBERS_MAX} added. They can see and write in the ticket from the start.`}
            </p>
            {memberProblem ? (
              <p className="pf-field-error" role="alert">
                {memberProblem}
              </p>
            ) : null}
            {draft.members.length > 0 ? (
              <ul className="chip-list" aria-label="Members to add">
                {draft.members.map((member) => (
                  <li key={member.userId} className="chip">
                    <Avatar user={member} size="sm" menu={false} />
                    <span className="chip-text">{displayName(member)}</span>
                    <button
                      type="button"
                      className="chip-remove"
                      aria-label={`Remove ${displayName(member)}`}
                      disabled={busy}
                      onClick={() => {
                        setMemberProblem(null);
                        change({ members: draft.members.filter((other) => other.userId !== member.userId) });
                      }}
                    >
                      <XIcon />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="pf-field">
            <div className="pf-field-row">
              <label className="pf-field-label" htmlFor={ids.message}>
                First message <span className="tk-muted tk-small">Optional</span>
              </label>
              <CharacterCount length={draft.firstMessage.length} limit={TICKET_CREATE_MESSAGE_MAX} />
            </div>
            <textarea
              id={ids.message}
              className="textarea"
              rows={3}
              maxLength={TICKET_CREATE_MESSAGE_MAX}
              value={draft.firstMessage}
              disabled={busy}
              placeholder="Hi, we would like to ask you about the match"
              onChange={(event) => change({ firstMessage: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <p className="pf-field-hint">Posted in the ticket under your name as soon as it opens.</p>
          </div>

          {problem ? (
            <p className="pf-field-error" role="alert">
              {problem}
            </p>
          ) : null}
          {error ? (
            <p className="pf-dialog-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="pf-dialog-actions">
          <button type="button" className="btn btn-secondary" aria-disabled={busy || undefined} onClick={() => !busy && onClose()}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>
            {busy ? "Opening…" : "Open ticket"}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

function withAnswer(answers: readonly string[], index: number, value: string): string[] {
  const next = [...answers];
  while (next.length <= index) next.push("");
  next[index] = value;
  return next;
}
