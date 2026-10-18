"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { APPEAL_LIMITS, readableReason, type AppealDetailDto, type AppealDto } from "@tier0/core";
import { AlertIcon, BanIcon, CheckIcon, UndoIcon, XIcon } from "../../../../../components/Icons";
import { useToast } from "../../../../../components/Toaster";
import { ActionBadge, Avatar, LocalTime, Pill, RelativeTime, displayName, moderatorOf } from "../../../../../components/mod/ModUi";
import {
  APPEAL_STATUS_LABEL,
  APPEAL_STATUS_TONE,
  appealPreview,
  appealsHref,
  bannedText,
  decisionBody,
  readDecision,
  responseProblem,
  type AppealFilter,
} from "../../../../../lib/mod-appeals";
import { useUnsavedGuard } from "../../../../../lib/unsaved-guard";
import { CharacterCount } from "../members/[userId]/CharacterCount";
import { DialogShell } from "../members/[userId]/Dialog";

/** How many of the member's other cases show before the link to the whole record. */
const CASES_SHOWN = 8;

interface Props {
  guildId: string;
  detail: AppealDetailDto;
  closeHref: string;
  status: AppealFilter;
}

type Decision = "accept" | "deny";

export function AppealDetail({ guildId, detail, closeHref, status }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [dialog, setDialog] = useState<Decision | null>(null);
  // What the bot said after a decision, such as a direct message that could not be delivered. Kept until
  // another appeal is opened, which remounts this panel.
  const [after, setAfter] = useState<{ decision: Decision; notes: string[]; appeal: AppealDto | null } | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  const appeal = after?.appeal ?? detail.appeal;
  const profileHref = `/guilds/${guildId}/mod/members/${encodeURIComponent(appeal.user.userId)}`;
  const ban = appeal.ban;
  const cases = detail.infractions.filter((entry) => entry.caseNumber !== appeal.caseNumber);
  const notes = detail.notes.filter((note) => !note.deleted);

  return (
    <article className="mod-card appeal" aria-labelledby="appeal-title">
      <header className="appeal-head">
        <Avatar user={appeal.user} size="lg" />
        <div className="appeal-head-text">
          <h3 className="appeal-title" id="appeal-title">
            <Link href={profileHref}>{displayName(appeal.user)}</Link>
          </h3>
          <p className="appeal-sub">
            Appeal #{appeal.id} against <Link href={`${profileHref}?case=${appeal.caseNumber}`}>case #{appeal.caseNumber}</Link>, sent{" "}
            <RelativeTime iso={appeal.createdAt} />
          </p>
        </div>
        <Pill tone={APPEAL_STATUS_TONE[appeal.status]}>{APPEAL_STATUS_LABEL[appeal.status]}</Pill>
        <Link className="btn btn-ghost btn-sm btn-icon appeal-close" href={closeHref} scroll={false} aria-label="Close this appeal">
          <XIcon />
        </Link>
      </header>

      <div className="appeal-body">
        <section aria-labelledby="appeal-text-title">
          <h4 className="appeal-label" id="appeal-text-title">
            What they wrote
          </h4>
          <p className="appeal-text">{appeal.text}</p>
        </section>

        <section aria-labelledby="appeal-ban-title">
          <h4 className="appeal-label" id="appeal-ban-title">
            The ban
          </h4>
          <dl className="appeal-facts">
            <div>
              <dt>Reason</dt>
              <dd>{readableReason("ban", ban.reason) ?? <span className="appeal-dim">No reason given.</span>}</dd>
            </div>
            <div>
              <dt>Moderator</dt>
              <dd>{displayName(moderatorOf({ action: "ban", moderator: ban.moderator }))}</dd>
            </div>
            <div>
              <dt>Banned</dt>
              <dd>
                <LocalTime iso={ban.createdAt} />
              </dd>
            </div>
            <div>
              <dt>Length</dt>
              <dd>
                {ban.expiresAt ? (
                  <>
                    Temporary, until <LocalTime iso={ban.expiresAt} />
                  </>
                ) : (
                  "Permanent"
                )}
              </dd>
            </div>
            <div>
              <dt>Now</dt>
              <dd>{bannedText(detail.stillBanned)}</dd>
            </div>
          </dl>
          {ban.removed ? (
            <div className="callout callout-info appeal-callout">
              <AlertIcon />
              <div>This ban case has been removed from the record since the appeal was sent.</div>
            </div>
          ) : null}
        </section>

        {appeal.decided ? (
          <section aria-labelledby="appeal-decision-title" className="appeal-decision" data-status={appeal.status}>
            <h4 className="appeal-label" id="appeal-decision-title">
              Decision
            </h4>
            <p>
              {appeal.status === "accepted" ? "Accepted" : "Denied"} by <strong>{displayName(appeal.decided.by)}</strong>{" "}
              <LocalTime iso={appeal.decided.at} />.
            </p>
            {appeal.decided.response ? (
              <blockquote className="appeal-response">{appeal.decided.response}</blockquote>
            ) : (
              <p className="appeal-dim">No message was written for the member.</p>
            )}
          </section>
        ) : null}

        {after ? (
          <div className="callout callout-info appeal-callout" role="status">
            <CheckIcon />
            <div>
              <strong>{after.decision === "accept" ? "Appeal accepted." : "Appeal denied."}</strong>
              {after.notes.length > 0 ? (
                <ul className="appeal-notes">
                  {after.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}

        {appeal.status === "pending" ? (
          <div className="appeal-actions" ref={actionsRef} role="group" aria-label="Decide this appeal">
            <button type="button" className="btn btn-primary" onClick={() => setDialog("accept")}>
              <UndoIcon />
              Accept
            </button>
            <button type="button" className="btn btn-danger" onClick={() => setDialog("deny")}>
              <BanIcon />
              Deny
            </button>
          </div>
        ) : null}

        <section aria-labelledby="appeal-cases-title">
          <h4 className="appeal-label" id="appeal-cases-title">
            Their other cases
          </h4>
          {cases.length === 0 ? (
            <p className="appeal-dim">Nothing else on their record.</p>
          ) : (
            <ul className="appeal-cases">
              {cases.slice(0, CASES_SHOWN).map((entry) => (
                <li key={entry.id} data-removed={entry.voided ? "true" : undefined}>
                  <ActionBadge action={entry.action} voided={entry.voided !== null} />
                  <Link className="appeal-case-link" href={`${profileHref}?case=${entry.caseNumber}`}>
                    #{entry.caseNumber}
                  </Link>
                  <span className="appeal-case-reason">{readableReason(entry.action, entry.reason) ?? "No reason given."}</span>
                  <RelativeTime className="appeal-case-when" iso={entry.createdAt} />
                </li>
              ))}
            </ul>
          )}
          {cases.length > 0 ? (
            <p className="appeal-more">
              <Link href={profileHref}>{cases.length > CASES_SHOWN ? `See all ${cases.length} cases on the full record` : "Open the full record"}</Link>
            </p>
          ) : null}
        </section>

        <section aria-labelledby="appeal-notes-title">
          <h4 className="appeal-label" id="appeal-notes-title">
            Staff notes
          </h4>
          {notes.length === 0 ? (
            <p className="appeal-dim">No staff notes on this member.</p>
          ) : (
            <ul className="appeal-staff-notes">
              {notes.map((note) => (
                <li key={note.id}>
                  <p className="appeal-note-meta">
                    <strong>{displayName(note.author)}</strong> <RelativeTime iso={note.createdAt} />
                  </p>
                  <p className="appeal-note-text">{note.content}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {detail.others.length > 0 ? (
          <section aria-labelledby="appeal-others-title">
            <h4 className="appeal-label" id="appeal-others-title">
              Their other appeals
            </h4>
            <ul className="appeal-others">
              {detail.others.map((other) => (
                <li key={other.id}>
                  <Link href={appealsHref(guildId, { status, appeal: other.id })} scroll={false}>
                    Appeal #{other.id}
                  </Link>
                  <Pill tone={APPEAL_STATUS_TONE[other.status]}>{APPEAL_STATUS_LABEL[other.status]}</Pill>
                  <RelativeTime iso={other.createdAt} />
                  <span className="appeal-others-text">{appealPreview(other.text, 80)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {dialog ? (
        <DecideDialog
          guildId={guildId}
          appeal={appeal}
          decision={dialog}
          fallbackFocus={() => actionsRef.current?.querySelector<HTMLElement>("button") ?? document.getElementById("appeal-title")}
          onClose={() => setDialog(null)}
          onDone={(result) => {
            setDialog(null);
            setAfter({ decision: dialog, notes: result.notes, appeal: result.appeal });
            toast.push({
              kind: "success",
              title: dialog === "accept" ? `Accepted the appeal and unbanned ${displayName(appeal.user)}` : "Denied the appeal",
              ...(result.notes.length > 0 ? { detail: result.notes.join(" ") } : {}),
            });
            router.refresh();
          }}
        />
      ) : null}
    </article>
  );
}

function DecideDialog({
  guildId,
  appeal,
  decision,
  fallbackFocus,
  onClose,
  onDone,
}: {
  guildId: string;
  appeal: AppealDto;
  decision: Decision;
  fallbackFocus(): HTMLElement | null;
  onClose(): void;
  onDone(result: { appeal: AppealDto | null; notes: string[] }): void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const bodyId = useId();
  const fieldId = useId();
  const hintId = useId();
  const errorId = useId();
  const accept = decision === "accept";
  const name = displayName(appeal.user);
  const problem = responseProblem(text);

  const guard = useUnsavedGuard({ dirty: !busy && text.trim() !== "", onDiscard: () => setText("") });

  async function submit() {
    if (submitting.current) return;
    if (problem) {
      setError(problem);
      document.getElementById(fieldId)?.focus();
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/guilds/${guildId}/mod/appeals/${appeal.id}/${decision}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(decisionBody(text)),
      });
      const data: unknown = await res.json().catch(() => null);
      if (res.ok) {
        onDone(readDecision(data));
        return;
      }
      const detail = data && typeof data === "object" && "error" in data ? (data as { error: unknown }).error : null;
      setError(
        typeof detail === "string" && detail.trim() !== ""
          ? detail.trim()
          : `The appeal was not ${accept ? "accepted" : "denied"}. The server answered ${res.status}. Try again.`,
      );
    } catch {
      setError("The dashboard could not be reached. Check your connection and try again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <DialogShell
      title={accept ? `Accept the appeal from ${name}?` : `Deny the appeal from ${name}?`}
      icon={accept ? <UndoIcon /> : <BanIcon />}
      tone={accept ? "default" : "danger"}
      layout="form"
      descriptionId={bodyId}
      onClose={onClose}
      locked={busy}
      fallbackFocus={fallbackFocus}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        aria-busy={busy || undefined}
      >
        {guard.host}
        <div className="pf-dialog-body">
          <div className="pf-dialog-text" id={bodyId}>
            {accept ? (
              <p>Lifts the ban in Discord and messages them. The unban is added to their record as a new case.</p>
            ) : (
              <p>The ban stays. They get a message saying the appeal was denied and when they may appeal again.</p>
            )}
          </div>
          <div className="pf-field">
            <div className="pf-field-row">
              <label className="pf-field-label" htmlFor={fieldId}>
                {accept ? "Message to the member" : "Reason sent to the member"}
                <span className="ta-tag">Optional</span>
              </label>
              <CharacterCount length={text.length} limit={APPEAL_LIMITS.response} />
            </div>
            <textarea
              id={fieldId}
              className="textarea pf-textarea"
              rows={4}
              value={text}
              maxLength={APPEAL_LIMITS.response}
              readOnly={busy}
              aria-describedby={error ? `${errorId} ${hintId}` : hintId}
              aria-invalid={problem ? true : undefined}
              onChange={(event) => {
                setText(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void submit();
                }
              }}
              data-autofocus
            />
            <p className="pf-field-hint" id={hintId}>
              Included in the direct message, and kept with the appeal for staff to read.
            </p>
          </div>
          {error ? (
            <p className="pf-dialog-error" role="alert" id={errorId}>
              {error}
            </p>
          ) : null}
        </div>
        <div className="pf-dialog-actions">
          <button
            type="button"
            className="btn btn-secondary"
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) onClose();
            }}
          >
            Cancel
          </button>
          <button type="submit" className={accept ? "btn btn-primary" : "btn btn-danger"} aria-disabled={busy || undefined}>
            {busy ? "Working…" : accept ? "Accept and unban" : "Deny appeal"}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
