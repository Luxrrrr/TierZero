"use client";

import { EvidenceList } from "../../../../../../components/mod/Evidence";
import Link from "next/link";
import { forwardRef, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AuditDto, InfractionDto, NoteDto, StaffRole, UserRef } from "@tier0/core";
import { ROLE_LABEL } from "@tier0/core";
import { BanIcon, ChevronDownIcon, HistoryIcon, NoteIcon, PencilIcon, TrashIcon, UndoIcon } from "../../../../../../components/Icons";
import { ActionBadge, Avatar, StateIcon, actionLabel, displayName, timeAgo } from "../../../../../../components/mod/ModUi";
import { changeSubject, controlName, infractionSubject, noteSubject, toggleName } from "./a11y";
import { CharacterCount } from "./CharacterCount";
import { ActionDialog } from "./Dialog";
import { EditCaseDialog } from "./EditCaseDialog";
import { canRestoreOwnRemoval, infractionControls, noteControls } from "./permissions";
import { diffSnapshots, expiryState, formatDate, formatDateTime, historyFor, type SnapshotDiff } from "./timeline";
import type { Run } from "./useModAction";

const REASON_LIMIT = 500;
export const NOTE_LIMIT = 2000;

/** The timeline heading takes focus when the entry a dialog belonged to has gone, as after a purge. */
function timelineHeading(): HTMLElement | null {
  return document.getElementById("pf-timeline-title");
}

/* Shared pieces ------------------------------------------------------------- */

/**
 * "3 hours ago" on screen, with the full date read out too. Sighted keyboard
 * and touch users find the same date written out in the entry's details.
 */
export function Stamp({ iso, now, timeZone }: { iso: string; now: Date; timeZone: string }) {
  return (
    <time className="pf-stamp" dateTime={iso} suppressHydrationWarning>
      {timeAgo(iso, now)}
      <span className="pf-sr">, {formatDateTime(iso, timeZone)}</span>
    </time>
  );
}

function QuietButton({
  icon,
  label,
  name,
  onClick,
  danger = false,
  busy = false,
}: {
  icon: ReactNode;
  label: string;
  /** The full accessible name, which starts with the visible label and says which entry it acts on. */
  name: string;
  onClick(): void;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      className="pf-act"
      data-danger={danger ? "true" : undefined}
      aria-label={name}
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy) onClick();
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

interface RowFrame {
  expanded: boolean;
  onToggle(): void;
  pending: boolean;
}

/* History ------------------------------------------------------------------- */

function DiffView({ diff, timeZone }: { diff: SnapshotDiff; timeZone: string }) {
  if (diff.kind === "none") return null;
  if (diff.kind === "text") {
    return (
      <div className="pf-diff-text">
        {diff.before !== null ? (
          <div className="pf-diff-side" data-side="before">
            <span className="pf-diff-tag">{diff.after === null ? "Text" : "Before"}</span>
            <p>{diff.before}</p>
          </div>
        ) : null}
        {diff.after !== null ? (
          <div className="pf-diff-side" data-side="after">
            <span className="pf-diff-tag">{diff.before === null ? "Text" : "After"}</span>
            <p>{diff.after}</p>
          </div>
        ) : null}
      </div>
    );
  }
  const twoSided = diff.rows.some((row) => row.before !== null) && diff.rows.some((row) => row.after !== null);
  const show = (value: string | null, time: boolean) =>
    value === null ? <span className="pf-diff-empty">empty</span> : time ? formatDateTime(value, timeZone) : value;
  return (
    <table className="pf-diff-table">
      {twoSided ? (
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
          </tr>
        </thead>
      ) : null}
      <tbody>
        {diff.rows.map((row) => (
          <tr key={row.field}>
            <th scope="row">{row.label}</th>
            {twoSided ? (
              <>
                <td data-side="before">{show(row.before, row.time)}</td>
                <td data-side="after">{show(row.after, row.time)}</td>
              </>
            ) : (
              <td>{show(row.before ?? row.after, row.time)}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function History({ entries, timeZone }: { entries: AuditDto[]; timeZone: string }) {
  if (entries.length === 0) return null;
  return (
    <div className="pf-history">
      <h4 className="pf-detail-title">
        <HistoryIcon />
        History
      </h4>
      <ol className="pf-history-list">
        {entries.map((entry) => (
          <li key={entry.id} className="pf-history-item">
            <p className="pf-history-line">
              <strong>{entry.actor.name}</strong>
              <span className="pf-dim"> {ROLE_LABEL[entry.actor.role].toLowerCase()}</span>
              <span> {entry.label.charAt(0).toLowerCase() + entry.label.slice(1)}</span>
              <span className="pf-dim"> · </span>
              <time dateTime={entry.at} suppressHydrationWarning>
                {formatDateTime(entry.at, timeZone)}
              </time>
            </p>
            <DiffView timeZone={timeZone} diff={diffSnapshots(entry.before, entry.after)} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pf-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const Toggle = forwardRef<
  HTMLButtonElement,
  { expanded: boolean; onToggle(): void; panelId: string; subject: string }
>(function Toggle({ expanded, onToggle, panelId, subject }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className="pf-toggle"
      aria-expanded={expanded}
      // The panel only exists while open, so pointing at it any other time would dangle.
      aria-controls={expanded ? panelId : undefined}
      aria-label={toggleName(expanded, subject)}
      onClick={onToggle}
    >
      <ChevronDownIcon />
    </button>
  );
});

/* Infraction ---------------------------------------------------------------- */

type EntryDialog = "edit" | "remove" | "restore" | "purge" | null;

export function InfractionRow({
  guildId,
  infraction,
  role,
  viewer,
  audit,
  showHistory,
  run,
  now,
  timeZone,
  expanded,
  onToggle,
  pending,
}: RowFrame & {
  guildId: string;
  infraction: InfractionDto;
  role: StaffRole;
  viewer: UserRef;
  audit: AuditDto[];
  showHistory: boolean;
  run: Run;
  now: Date;
  timeZone: string;
}) {
  const [dialog, setDialog] = useState<EntryDialog>(null);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const controls = infractionControls(role, infraction, viewer.userId);
  const removed = infraction.voided;
  const expiry = expiryState(infraction, now);
  const entries = showHistory ? historyFor(audit, { infractionId: infraction.id }) : [];
  const base = `infractions/${infraction.id}`;
  const label = `case ${infraction.caseNumber}`;
  const subject = infractionSubject(actionLabel(infraction.action), infraction.caseNumber);
  const hasControls = controls.edit || controls.remove || controls.restore || controls.purge;
  const fallbackFocus = () => toggleRef.current ?? timelineHeading();

  return (
    <li
      className="pf-event"
      data-kind="infraction"
      data-removed={removed ? "true" : undefined}
      data-pending={pending ? "true" : undefined}
      aria-busy={pending || undefined}
    >
      <span className="mod-actionicon pf-disc" data-action={removed ? undefined : infraction.action} aria-hidden="true">
        <StateIcon action={infraction.action} />
      </span>
      <article className="pf-card" aria-label={`${actionLabel(infraction.action)}, ${label}`}>
        <div className="pf-card-head">
          <div className="pf-card-line">
            <span className="pf-card-tags">
              <ActionBadge action={infraction.action} voided={removed !== null} />
              <span className="pf-case">#{infraction.caseNumber}</span>
              {removed ? (
                <span className="mod-pill" data-tone="removed">
                  Removed
                </span>
              ) : null}
              {expiry.state === "active" ? (
                <span className="mod-pill" data-tone={infraction.action === "ban" ? "danger" : "active"}>
                  {expiry.until ? `Until ${formatDateTime(expiry.until, timeZone)}` : "In force"}
                </span>
              ) : null}
              {expiry.state === "ended" ? (
                <span className="mod-pill" data-tone="expired">
                  {expiry.at ? "Ended" : "Lifted"}
                </span>
              ) : null}
            </span>
            <span className="pf-card-end">
              {pending ? <span className="pf-saving">Saving</span> : <Stamp iso={infraction.createdAt} now={now} timeZone={timeZone} />}
              <Toggle ref={toggleRef} expanded={expanded} onToggle={onToggle} panelId={panelId} subject={subject} />
            </span>
          </div>
          <p className="pf-text pf-reason" data-clamp={expanded ? undefined : "true"} data-removed={removed ? "true" : undefined}>
            {infraction.reason ?? <span className="pf-dim">No reason given.</span>}
          </p>
          {infraction.edited ? (
            <p className="pf-edit-tip" title="A staff member changed this case after it was made. Staff activity has what it said before.">
              <PencilIcon />
              <span className="case-edited">Case edited by staff</span> <strong>{displayName(infraction.edited.by)}</strong>{" "}
              <Stamp iso={infraction.edited.at} now={now} timeZone={timeZone} />
            </p>
          ) : null}
          <EvidenceList evidence={infraction.evidence} full={expanded} />
          <p className="pf-byline">
            <Avatar user={infraction.moderator} size="sm" />
            <span>
              by <span className="pf-strong">{displayName(infraction.moderator)}</span>
            </span>
          </p>
        </div>

        {removed ? (
          <p className="pf-removed">
            <span className="pf-removed-what">
              Removed by <strong>{displayName(removed.by)}</strong> <Stamp iso={removed.at} now={now} timeZone={timeZone} />
            </span>
            {removed.reason ? <span className="pf-removed-why">{removed.reason}</span> : null}
          </p>
        ) : null}

        {expanded ? (
          <div className="pf-details" id={panelId}>
            <dl className="pf-facts">
              <Detail label="Issued">{formatDateTime(infraction.createdAt, timeZone)}</Detail>
              <Detail label="Moderator">{displayName(infraction.moderator)}</Detail>
              {infraction.expiresAt ? (
                <Detail label={Date.parse(infraction.expiresAt) > now.getTime() ? "Ends" : "Ended"}>
                  {formatDateTime(infraction.expiresAt, timeZone)}
                </Detail>
              ) : null}
              {removed ? <Detail label="Removed">{formatDateTime(removed.at, timeZone)}</Detail> : null}
            </dl>
            <History entries={entries} timeZone={timeZone} />
            {showHistory ? (
              <p className="pf-activity-link">
                <Link href={`/guilds/${guildId}/mod/audit?infractionId=${infraction.id}`}>See everything staff did on this case</Link>
              </p>
            ) : null}
            {hasControls ? (
              <div className="pf-acts" role="group" aria-label={`Actions for ${subject}`}>
                {controls.edit ? (
                  <QuietButton
                    icon={<PencilIcon />}
                    label="Edit case"
                    name={controlName("Edit case", subject)}
                    onClick={() => setDialog("edit")}
                    busy={pending}
                  />
                ) : null}
                {controls.remove ? (
                  <QuietButton
                    icon={<TrashIcon />}
                    label="Remove from record"
                    name={controlName("Remove from record", subject)}
                    onClick={() => setDialog("remove")}
                    busy={pending}
                  />
                ) : null}
                {controls.restore ? (
                  <QuietButton
                    icon={<UndoIcon />}
                    label="Restore"
                    name={controlName("Restore", subject)}
                    onClick={() => setDialog("restore")}
                    busy={pending}
                  />
                ) : null}
                {controls.purge ? (
                  <QuietButton
                    icon={<BanIcon />}
                    label="Purge forever"
                    name={controlName("Purge forever", subject)}
                    danger
                    onClick={() => setDialog("purge")}
                    busy={pending}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </article>

      {dialog === "edit" ? (
        <EditCaseDialog
          guildId={guildId}
          infraction={infraction}
          now={now}
          timeZone={timeZone}
          run={run}
          fallbackFocus={fallbackFocus}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog === "remove" ? (
        <ActionDialog
          title={`Remove ${label} from the record?`}
          icon={<TrashIcon />}
          body={
            <p>
              The {actionLabel(infraction.action).toLowerCase()} stays visible on the record, struck through and marked
              with your name, the time and your reason. It stops counting toward the member&apos;s totals.{" "}
              {canRestoreOwnRemoval(role) ? "It can be restored later." : "An admin or the owner can restore it."}
            </p>
          }
          reason={{
            label: "Reason",
            placeholder: "Why is this coming off the record?",
            maxLength: REASON_LIMIT,
            hint: "Shown to staff next to the entry and kept in the audit log.",
          }}
          confirmLabel="Remove from record"
          fallbackFocus={fallbackFocus}
          onClose={() => setDialog(null)}
          onConfirm={(reason) =>
            run(
              {
                method: "POST",
                path: `${base}/void`,
                body: { reason },
                success: `Removed ${label} from the record.`,
                failure: "Could not remove the entry",
                inline: true,
              },
              { type: "infraction.void", id: infraction.id, by: viewer, reason, at: new Date().toISOString() },
              "after",
            )
          }
        />
      ) : null}

      {dialog === "restore" ? (
        <ActionDialog
          title={`Restore ${label}?`}
          icon={<UndoIcon />}
          body={
            <p>
              The entry goes back on the member&apos;s record and counts toward their totals again. The restore is
              recorded in the audit log.
            </p>
          }
          confirmLabel="Restore"
          fallbackFocus={fallbackFocus}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            run(
              {
                method: "POST",
                path: `${base}/restore`,
                success: `Restored ${label}.`,
                failure: "Could not restore the entry",
                inline: true,
              },
              { type: "infraction.restore", id: infraction.id },
              "after",
            )
          }
        />
      ) : null}

      {dialog === "purge" ? (
        <ActionDialog
          title={`Purge ${label} forever?`}
          icon={<BanIcon />}
          body={
            <p>
              This deletes the entry and every line of its history. Nothing is kept: the audit log will not show that it
              existed, and it cannot be recovered.
            </p>
          }
          danger
          typedConfirm
          confirmLabel="Purge forever"
          fallbackFocus={timelineHeading}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            run(
              {
                method: "DELETE",
                path: `${base}?purge=1`,
                success: `Purged ${label}.`,
                failure: "Could not purge the entry",
                inline: true,
              },
              { type: "infraction.purge", id: infraction.id },
              "after",
            )
          }
        />
      ) : null}
    </li>
  );
}

/* Note ---------------------------------------------------------------------- */

export function NoteRow({
  note,
  role,
  viewer,
  audit,
  showHistory,
  run,
  now,
  timeZone,
  expanded,
  onToggle,
  pending,
}: RowFrame & {
  note: NoteDto;
  role: StaffRole;
  viewer: UserRef;
  audit: AuditDto[];
  showHistory: boolean;
  run: Run;
  now: Date;
  timeZone: string;
}) {
  const [dialog, setDialog] = useState<EntryDialog>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const returnToEdit = useRef(false);
  const fieldId = useId();
  const panelId = useId();
  const hintId = useId();

  const temporary = note.id < 0;
  const controls = temporary
    ? { edit: false, remove: false, restore: false, purge: false }
    : noteControls(role, note, viewer.userId);
  const deleted = note.deleted;
  const entries = showHistory ? historyFor(audit, { noteId: note.id }) : [];
  const base = `notes/${note.id}`;
  const trimmed = draft.trim();
  const unchanged = trimmed === note.content.trim();
  const hasControls = controls.remove || controls.restore || controls.purge;
  const author = displayName(note.author);
  const subject = noteSubject(author, formatDate(note.createdAt, timeZone));
  const fallbackFocus = () => toggleRef.current ?? timelineHeading();

  useEffect(() => {
    if (editing) {
      const node = field.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    } else if (returnToEdit.current) {
      // Runs after the edit box has gone and the Edit button is back in the DOM.
      returnToEdit.current = false;
      (editButton.current ?? toggleRef.current)?.focus();
    }
  }, [editing]);

  function startEdit() {
    setDraft(note.content);
    setEditing(true);
  }

  function stopEdit() {
    returnToEdit.current = true;
    setEditing(false);
  }

  async function save() {
    if (saveLock.current || trimmed === "" || unchanged) return;
    saveLock.current = true;
    setSaving(true);
    try {
      const result = await run(
        { method: "PATCH", path: base, body: { content: trimmed }, success: "Note updated.", failure: "Could not save the note" },
        { type: "note.edit", id: note.id, content: trimmed, at: new Date().toISOString() },
      );
      if (result === true) stopEdit();
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  return (
    <li
      className="pf-event"
      data-kind="note"
      data-removed={deleted ? "true" : undefined}
      data-pending={pending ? "true" : undefined}
      aria-busy={pending || undefined}
    >
      <span className="mod-actionicon pf-disc" data-action={deleted ? undefined : "note"} aria-hidden="true">
        <NoteIcon />
      </span>
      <article className="pf-card pf-note" aria-label={`Note by ${author}`}>
        <div className="pf-card-head">
          <div className="pf-card-line">
            <span className="pf-card-tags">
              <span className="pf-kind" data-kind="note">
                <NoteIcon />
                Note
              </span>
              <span className="pf-byline-inline">
                <Avatar user={note.author} size="sm" />
                <span className="pf-strong pf-ellipsis">{author}</span>
              </span>
              {deleted ? (
                <span className="mod-pill" data-tone="removed">
                  Deleted
                </span>
              ) : null}
              {note.edited && !deleted ? <span className="pf-edited">edited</span> : null}
            </span>
            <span className="pf-card-end">
              {pending ? <span className="pf-saving">Saving</span> : <Stamp iso={note.createdAt} now={now} timeZone={timeZone} />}
              {temporary ? null : (
                <Toggle ref={toggleRef} expanded={expanded} onToggle={onToggle} panelId={panelId} subject={subject} />
              )}
            </span>
          </div>

          {editing ? (
            <div className="pf-field pf-edit">
              <label className="pf-sr" htmlFor={fieldId}>
                Edit {subject}
              </label>
              <textarea
                ref={field}
                id={fieldId}
                className="textarea pf-textarea"
                rows={4}
                value={draft}
                maxLength={NOTE_LIMIT}
                aria-describedby={hintId}
                readOnly={saving}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void save();
                  } else if (event.key === "Escape" && !saving) {
                    event.preventDefault();
                    stopEdit();
                  }
                }}
              />
              <div className="pf-field-row">
                <span className="pf-field-hint" id={hintId}>
                  <kbd className="mod-kbd">Ctrl</kbd> <kbd className="mod-kbd">Enter</kbd> to save,{" "}
                  <kbd className="mod-kbd">Esc</kbd> to cancel
                </span>
                <CharacterCount length={draft.length} limit={NOTE_LIMIT} />
              </div>
              <div className="pf-edit-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-disabled={saving || undefined}
                  onClick={() => {
                    if (!saving) stopEdit();
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  aria-disabled={saving || trimmed === "" || unchanged || undefined}
                  onClick={() => void save()}
                >
                  {saving ? "Saving…" : "Save note"}
                </button>
              </div>
            </div>
          ) : deleted && note.content === "" ? (
            <p className="pf-text pf-note-text pf-dim">This note was deleted.</p>
          ) : (
            <p className="pf-text pf-note-text" data-removed={deleted ? "true" : undefined}>
              {note.content}
            </p>
          )}
        </div>

        {deleted ? (
          <p className="pf-removed">
            <span className="pf-removed-what">
              Deleted by <strong>{displayName(deleted.by)}</strong> <Stamp iso={deleted.at} now={now} timeZone={timeZone} />
            </span>
          </p>
        ) : null}

        {!editing && !deleted && controls.edit ? (
          <div className="pf-acts pf-acts-inline">
            <button
              ref={editButton}
              type="button"
              className="pf-act"
              aria-label={controlName("Edit", subject)}
              aria-disabled={pending || undefined}
              onClick={() => {
                if (!pending) startEdit();
              }}
            >
              <PencilIcon />
              <span>Edit</span>
            </button>
          </div>
        ) : null}

        {expanded && !editing ? (
          <div className="pf-details" id={panelId}>
            <dl className="pf-facts">
              <Detail label="Written">{formatDateTime(note.createdAt, timeZone)}</Detail>
              {note.edited ? <Detail label="Last edited">{formatDateTime(note.updatedAt, timeZone)}</Detail> : null}
              {deleted ? <Detail label="Deleted">{formatDateTime(deleted.at, timeZone)}</Detail> : null}
            </dl>
            <History entries={entries} timeZone={timeZone} />
            {hasControls ? (
              <div className="pf-acts" role="group" aria-label={`Actions for ${subject}`}>
                {controls.remove ? (
                  <QuietButton
                    icon={<TrashIcon />}
                    label="Delete"
                    name={controlName("Delete", subject)}
                    onClick={() => setDialog("remove")}
                    busy={pending}
                  />
                ) : null}
                {controls.restore ? (
                  <QuietButton
                    icon={<UndoIcon />}
                    label="Restore"
                    name={controlName("Restore", subject)}
                    onClick={() => setDialog("restore")}
                    busy={pending}
                  />
                ) : null}
                {controls.purge ? (
                  <QuietButton
                    icon={<BanIcon />}
                    label="Purge forever"
                    name={controlName("Purge forever", subject)}
                    danger
                    onClick={() => setDialog("purge")}
                    busy={pending}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </article>

      {dialog === "remove" ? (
        <ActionDialog
          title="Delete this note?"
          icon={<TrashIcon />}
          body={
            <p>
              The note stays on the record, struck through and marked with your name and the time.{" "}
              {role === "mod" ? "An admin or the owner can restore it." : "It can be restored later."}
            </p>
          }
          confirmLabel="Delete note"
          danger
          fallbackFocus={fallbackFocus}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            run(
              { method: "DELETE", path: base, success: "Note deleted.", failure: "Could not delete the note", inline: true },
              { type: "note.delete", id: note.id, by: viewer, at: new Date().toISOString() },
              "after",
            )
          }
        />
      ) : null}

      {dialog === "restore" ? (
        <ActionDialog
          title="Restore this note?"
          icon={<UndoIcon />}
          body={<p>The note goes back on the member&apos;s record. The restore is recorded in the audit log.</p>}
          confirmLabel="Restore note"
          fallbackFocus={fallbackFocus}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            run(
              {
                method: "POST",
                path: `${base}/restore`,
                success: "Note restored.",
                failure: "Could not restore the note",
                inline: true,
              },
              { type: "note.restore", id: note.id },
              "after",
            )
          }
        />
      ) : null}

      {dialog === "purge" ? (
        <ActionDialog
          title="Purge this note forever?"
          icon={<BanIcon />}
          body={
            <p>
              This deletes the note and every line of its history. Nothing is kept: the audit log will not show that it
              existed, and it cannot be recovered.
            </p>
          }
          danger
          typedConfirm
          confirmLabel="Purge forever"
          fallbackFocus={timelineHeading}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            run(
              {
                method: "DELETE",
                path: `${base}?purge=1`,
                success: "Note purged.",
                failure: "Could not purge the note",
                inline: true,
              },
              { type: "note.purge", id: note.id },
              "after",
            )
          }
        />
      ) : null}
    </li>
  );
}

/* Staff activity -------------------------------------------------------------- */

export function AuditRow({
  entry,
  now,
  timeZone,
  expanded,
  onToggle,
}: {
  entry: AuditDto;
  now: Date;
  timeZone: string;
  expanded: boolean;
  onToggle(): void;
}) {
  const panelId = useId();
  const diff = diffSnapshots(entry.before, entry.after);
  const text = entry.summary || entry.label;
  const subject = changeSubject(entry.actor.name, formatDate(entry.at, timeZone));
  return (
    <li className="pf-event" data-kind="audit">
      <span className="mod-actionicon pf-disc" data-action="staff" aria-hidden="true">
        <HistoryIcon />
      </span>
      <div className="pf-card pf-audit">
        <div className="pf-card-line">
          <span className="pf-audit-text">
            <span className="pf-kind" data-kind="staff">
              <HistoryIcon />
              Staff activity
            </span>{" "}
            <span className="pf-strong">{entry.actor.name}</span>
            <span className="pf-dim"> {ROLE_LABEL[entry.actor.role].toLowerCase()} · </span>
            {text}
          </span>
          <span className="pf-card-end">
            <Stamp iso={entry.at} now={now} timeZone={timeZone} />
            <Toggle expanded={expanded} onToggle={onToggle} panelId={panelId} subject={subject} />
          </span>
        </div>
        {expanded ? (
          <div className="pf-details" id={panelId}>
            <dl className="pf-facts">
              <Detail label="When">{formatDateTime(entry.at, timeZone)}</Detail>
              <Detail label="By">
                {entry.actor.name}, {ROLE_LABEL[entry.actor.role].toLowerCase()}
              </Detail>
            </dl>
            <DiffView diff={diff} timeZone={timeZone} />
          </div>
        ) : null}
      </div>
    </li>
  );
}
