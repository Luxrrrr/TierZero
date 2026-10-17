"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { TICKET_CLOSE_REASON_MAX, TICKET_RENAME_MAX, type TicketPanelOption } from "@tier0/core";
import { DialogShell } from "../../app/guilds/[id]/mod/members/[userId]/Dialog";
import { CharacterCount } from "../../app/guilds/[id]/mod/members/[userId]/CharacterCount";
import { DoorIcon, LockIcon, PencilIcon, SwapIcon, TrashIcon } from "../Icons";
import { typeProblemText } from "../../lib/ticket-health";

type Outcome = true | string;

function useSubmit(onConfirm: () => Promise<Outcome>, onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const submit = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    let result: Outcome;
    try {
      result = await onConfirm();
    } finally {
      running.current = false;
      setBusy(false);
    }
    if (result === true) onClose();
    else setError(result);
  };
  return { busy, error, submit };
}

function Actions({ busy, confirm, danger, onClose, ready = true }: { busy: boolean; confirm: string; danger?: boolean; onClose(): void; ready?: boolean }) {
  return (
    <div className="pf-dialog-actions">
      <button type="button" className="btn btn-secondary" aria-disabled={busy || undefined} onClick={() => !busy && onClose()}>
        Cancel
      </button>
      <button type="submit" className={danger ? "btn btn-danger" : "btn btn-primary"} aria-disabled={busy || !ready || undefined}>
        {busy ? "Working…" : confirm}
      </button>
    </div>
  );
}

/** Closing asks for a reason, which the opener sees and the transcript keeps. It is optional unless the type requires one, which the bot enforces. */
export function CloseDialog({
  number,
  archive,
  reasonRequired = false,
  onConfirm,
  onClose,
}: {
  /** The number people see. */
  number: number;
  /** The channel is kept and locked rather than deleted, or null when the page does not know which. */
  archive: boolean | null;
  /** The ticket's type asks for a reason, so the bot refuses a close without one. */
  reasonRequired?: boolean;
  onConfirm(reason: string | null): Promise<Outcome>;
  onClose(): void;
}) {
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const bodyId = useId();
  const fieldId = useId();
  const errorId = useId();
  const { busy, error, submit } = useSubmit(() => onConfirm(reason.trim() === "" ? null : reason.trim()), onClose);

  return (
    <DialogShell title={`Close ticket #${number}?`} icon={<LockIcon />} tone="default" descriptionId={bodyId} onClose={onClose} locked={busy}>
      {/* The dialog says what is missing in its own words; the browser's bubble would cover them. */}
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (reasonRequired && reason.trim() === "") {
            setProblem("This type of ticket needs a reason to close. Write one, then close it.");
            document.getElementById(fieldId)?.focus();
            return;
          }
          void submit();
        }}
      >
        <div className="pf-dialog-body">
          <p className="pf-dialog-text" id={bodyId}>
            {archive === true
              ? "The channel is locked and kept, so the ticket can be reopened later. The transcript stays here in the dashboard."
              : archive === false
                ? "The channel is deleted in Discord. The transcript stays here in the dashboard."
                : "The opener is told it has closed, and the channel is deleted or locked as your settings say. The transcript stays here in the dashboard."}
          </p>
          <div className="pf-field">
            <div className="pf-field-row">
              <label className="pf-field-label" htmlFor={fieldId}>
                Reason {reasonRequired ? null : <span className="field-optional">Optional</span>}
              </label>
              <CharacterCount length={reason.length} limit={TICKET_CLOSE_REASON_MAX} />
            </div>
            <textarea
              id={fieldId}
              className="textarea pf-textarea"
              rows={3}
              value={reason}
              maxLength={TICKET_CLOSE_REASON_MAX}
              placeholder="Sorted: the rank was restored"
              readOnly={busy}
              aria-describedby={[error ? errorId : null, problem ? `${fieldId}-problem` : null].filter(Boolean).join(" ") || undefined}
              aria-invalid={problem ? true : undefined}
              required={reasonRequired}
              onChange={(event) => {
                setReason(event.target.value);
                setProblem(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              data-autofocus
            />
            <p className="pf-field-hint">
              {reasonRequired ? "Needed for this type of ticket. " : ""}The opener sees it in the closing message.
            </p>
            {problem ? (
              <p className="pf-field-error" role="alert" id={`${fieldId}-problem`}>
                {problem}
              </p>
            ) : null}
          </div>
          {error ? (
            <p className="pf-dialog-error" role="alert" id={errorId}>
              {error}
            </p>
          ) : null}
        </div>
        <Actions busy={busy} confirm="Close ticket" onClose={onClose} />
      </form>
    </DialogShell>
  );
}

/** Moving a ticket hands it to another type's handlers, so the list says whose they are. */
export function TransferDialog({
  number,
  currentTypeId,
  panels,
  onConfirm,
  onClose,
}: {
  /** The number people see. */
  number: number;
  currentTypeId: string | null;
  panels: TicketPanelOption[];
  onConfirm(typeId: string): Promise<Outcome>;
  onClose(): void;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const bodyId = useId();
  const errorId = useId();
  const groups = panels.map((panel) => ({ ...panel, types: panel.types.filter((type) => type.id !== currentTypeId) })).filter((panel) => panel.types.length > 0);
  const choosable = groups.flatMap((panel) => panel.types).filter((type) => !type.problem);
  const chosen = groups.flatMap((panel) => panel.types).find((type) => type.id === choice);
  const [problem, setProblem] = useState<string | null>(null);
  const { busy, error, submit } = useSubmit(async () => (choice ? onConfirm(choice) : "Pick a type first."), onClose);

  return (
    <DialogShell title={`Move ticket #${number}`} icon={<SwapIcon />} tone="default" descriptionId={bodyId} onClose={onClose} locked={busy} layout="form">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!choice) {
            setProblem("Pick the type to move it to.");
            return;
          }
          setProblem(null);
          void submit();
        }}
      >
        <div className="pf-dialog-body">
          <p className="pf-dialog-text" id={bodyId}>
            The ticket keeps its conversation. The new type&apos;s handlers can see it, are pinged in Discord, and its
            category and rules apply from now on.
          </p>
          {groups.length === 0 ? (
            <p className="pf-dialog-text">There is no other type to move it to. Add one in Settings, under Panels.</p>
          ) : (
            <fieldset className="tk-choices">
              <legend className="visually-hidden">Ticket type</legend>
              {groups.map((panel) => (
                <div key={panel.id} className="tk-choice-group">
                  {groups.length > 1 ? <p className="tk-choice-panel">{panel.name}</p> : null}
                  {panel.types.map((type) => {
                    const why = type.problem ? typeProblemText(type.problem) : null;
                    const noteId = `${bodyId}-${type.id}-note`;
                    const note = why ? `${why} Fix it in Settings first.` : type.handled ? null : "You do not handle this type.";
                    return (
                      <label
                        key={type.id}
                        className="tk-choice"
                        data-checked={choice === type.id ? "true" : undefined}
                        data-unavailable={why ? "true" : undefined}
                      >
                        <input
                          type="radio"
                          name="ticket-type"
                          value={type.id}
                          checked={choice === type.id}
                          onChange={() => {
                            setChoice(type.id);
                            setProblem(null);
                          }}
                          disabled={busy || why !== null}
                          aria-describedby={note ? noteId : undefined}
                          {...(choice === null && type === choosable[0] ? { "data-autofocus": true } : {})}
                        />
                        <span className="tk-choice-text">
                          {type.emoji && !type.emoji.startsWith("<") ? <span aria-hidden="true">{type.emoji} </span> : null}
                          {type.name}
                          {note ? (
                            <span className="tk-choice-why" id={noteId}>
                              {note}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </fieldset>
          )}
          {chosen && !chosen.handled ? (
            <p className="callout callout-attention tk-dialog-warn" role="status">
              You do not handle {chosen.name}, so the ticket leaves your inbox once it is moved.
            </p>
          ) : null}
          {problem ? (
            <p className="pf-field-error" role="alert">
              {problem}
            </p>
          ) : null}
          {error ? (
            <p className="pf-dialog-error" role="alert" id={errorId}>
              {error}
            </p>
          ) : null}
        </div>
        <Actions busy={busy} confirm="Move ticket" onClose={onClose} ready={choosable.length > 0 && choice !== null} />
      </form>
    </DialogShell>
  );
}

/** A new name for the ticket's channel or thread, held to what Discord allows. */
export function RenameDialog({
  number,
  current,
  thread,
  onConfirm,
  onClose,
}: {
  number: number;
  current: string;
  thread: boolean;
  onConfirm(name: string): Promise<Outcome>;
  onClose(): void;
}) {
  const [name, setName] = useState(current);
  const [problem, setProblem] = useState<string | null>(null);
  const bodyId = useId();
  const fieldId = useId();
  const errorId = useId();
  const { busy, error, submit } = useSubmit(() => onConfirm(name.trim()), onClose);
  return (
    <DialogShell title={`Rename ticket #${number}`} icon={<PencilIcon />} tone="default" descriptionId={bodyId} onClose={onClose} locked={busy} layout="form">
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() === "") {
            setProblem("Write the new name first.");
            document.getElementById(fieldId)?.focus();
            return;
          }
          void submit();
        }}
      >
        <div className="pf-dialog-body">
          <p className="pf-dialog-text" id={bodyId}>
            {thread
              ? "The thread is renamed in Discord."
              : "The channel is renamed in Discord, which turns spaces into dashes and capitals into small letters."}{" "}
            Discord lets a channel be renamed twice every ten minutes.
          </p>
          <div className="pf-field">
            <div className="pf-field-row">
              <label className="pf-field-label" htmlFor={fieldId}>
                New name
              </label>
              <CharacterCount length={name.length} limit={TICKET_RENAME_MAX} />
            </div>
            <input
              id={fieldId}
              className="input"
              value={name}
              maxLength={TICKET_RENAME_MAX}
              autoComplete="off"
              readOnly={busy}
              aria-invalid={problem ? true : undefined}
              aria-describedby={[problem ? `${fieldId}-problem` : null, error ? errorId : null].filter(Boolean).join(" ") || undefined}
              onChange={(event) => {
                setName(event.target.value);
                setProblem(null);
              }}
              data-autofocus
            />
            {problem ? (
              <p className="pf-field-error" role="alert" id={`${fieldId}-problem`}>
                {problem}
              </p>
            ) : null}
          </div>
          {error ? (
            <p className="pf-dialog-error" role="alert" id={errorId}>
              {error}
            </p>
          ) : null}
        </div>
        <Actions busy={busy} confirm="Rename" onClose={onClose} />
      </form>
    </DialogShell>
  );
}

/** Asks the opener in Discord whether the ticket can close, the way /ticket request-close does. */
export function RequestCloseDialog({
  number,
  openerName,
  onConfirm,
  onClose,
}: {
  number: number;
  openerName: string;
  onConfirm(reason: string | null): Promise<Outcome>;
  onClose(): void;
}) {
  const [reason, setReason] = useState("");
  const bodyId = useId();
  const fieldId = useId();
  const errorId = useId();
  const { busy, error, submit } = useSubmit(() => onConfirm(reason.trim() === "" ? null : reason.trim()), onClose);
  return (
    <DialogShell title={`Ask to close #${number}?`} icon={<DoorIcon />} tone="default" descriptionId={bodyId} onClose={onClose} locked={busy} layout="form">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="pf-dialog-body">
          <p className="pf-dialog-text" id={bodyId}>
            {openerName} is asked in the ticket whether it can close, with a button to close it and one to keep it open. If
            your settings close unanswered requests after a while, that applies here too.
          </p>
          <div className="pf-field">
            <div className="pf-field-row">
              <label className="pf-field-label" htmlFor={fieldId}>
                Reason <span className="field-optional">Optional</span>
              </label>
              <CharacterCount length={reason.length} limit={TICKET_CLOSE_REASON_MAX} />
            </div>
            <textarea
              id={fieldId}
              className="textarea pf-textarea"
              rows={2}
              value={reason}
              maxLength={TICKET_CLOSE_REASON_MAX}
              placeholder="Your rank is back, so this looks sorted"
              readOnly={busy}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => setReason(event.target.value)}
              data-autofocus
            />
            <p className="pf-field-hint">Shown to {openerName} with the question.</p>
          </div>
          {error ? (
            <p className="pf-dialog-error" role="alert" id={errorId}>
              {error}
            </p>
          ) : null}
        </div>
        <Actions busy={busy} confirm="Ask to close" onClose={onClose} />
      </form>
    </DialogShell>
  );
}

/** A yes or no about something that cannot be taken back. */
export function ConfirmDialog({
  title,
  body,
  confirm,
  onConfirm,
  onClose,
}: {
  title: string;
  body: ReactNode;
  confirm: string;
  onConfirm(): Promise<Outcome>;
  onClose(): void;
}) {
  const bodyId = useId();
  const { busy, error, submit } = useSubmit(onConfirm, onClose);
  return (
    <DialogShell title={title} icon={<TrashIcon />} tone="danger" descriptionId={bodyId} onClose={onClose} locked={busy}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="pf-dialog-body">
          <div className="pf-dialog-text" id={bodyId}>
            {body}
          </div>
          {error ? (
            <p className="pf-dialog-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="pf-dialog-actions">
          <button type="button" className="btn btn-secondary" data-autofocus aria-disabled={busy || undefined} onClick={() => !busy && onClose()}>
            Cancel
          </button>
          <button type="submit" className="btn btn-danger" aria-disabled={busy || undefined}>
            {busy ? "Working…" : confirm}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
