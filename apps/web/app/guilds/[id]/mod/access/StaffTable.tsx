"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABEL, type ListedRole, type StaffDto } from "@tier0/core";
import { useToast } from "../../../../../components/Toaster";
import { AlertIcon, CheckIcon, PlusIcon, TrashIcon, UserIcon } from "../../../../../components/Icons";
import { RoleBadge, displayName, fmtDate, fmtDateTime } from "../../../../../components/mod/ModUi";
import { Person } from "./Person";
import {
  LISTED_ROLES,
  gainedPermissions,
  needsConfirmation,
  pluralPeople,
  removalConsequence,
  sortStaff,
} from "./logic";
import { send } from "./send";
import { ADD_SEARCH_ID } from "./ids";

type RowStatus = { kind: "saving" | "saved" | "error"; message?: string };
type Pending = { kind: "remove" | "promote"; member: StaffDto };

export interface StaffTableProps {
  staff: StaffDto[];
  staffUrl(userId: string): string;
  freshId: string | null;
}

export function StaffTable({ staff, staffUrl, freshId }: StaffTableProps) {
  const router = useRouter();
  const toast = useToast();
  const busy = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [drafts, setDrafts] = useState<Record<string, ListedRole>>({});
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({});
  const [working, setWorking] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  // What to focus once the dialog has closed and handed focus back: the heading after a removal, a row's level control after a save.
  const [refocus, setRefocus] = useState<{ target: "heading" | "level" | "save" | "remove"; userId?: string } | null>(null);

  useEffect(() => {
    const live = timers.current;
    return () => {
      for (const timer of live.values()) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!refocus) return;
    if (refocus.target === "heading") headingRef.current?.focus();
    else if (refocus.userId) {
      const selector = {
        level: `input[name="level-${refocus.userId}"]:checked`,
        save: `[data-save="${refocus.userId}"]`,
        remove: `[data-remove="${refocus.userId}"]`,
      }[refocus.target as "level" | "save" | "remove"];
      tableRef.current?.querySelector<HTMLElement>(selector)?.focus();
    }
    setRefocus(null);
  }, [refocus]);

  function setStatus(userId: string, status: RowStatus | null) {
    setStatuses((current) => {
      const next = { ...current };
      if (status) next[userId] = status;
      else delete next[userId];
      return next;
    });
  }

  function choose(member: StaffDto, role: ListedRole) {
    const userId = member.user.userId;
    if (busy.current) return;
    setStatus(userId, null);
    setDrafts((current) => {
      const next = { ...current };
      if (role === member.role) delete next[userId];
      else next[userId] = role;
      return next;
    });
  }

  function cancelDraft(member: StaffDto) {
    if (busy.current) return;
    const userId = member.user.userId;
    setDrafts((current) => {
      const next = { ...current };
      delete next[userId];
      return next;
    });
    setStatus(userId, null);
    setRefocus({ target: "level", userId });
  }

  function requestSave(member: StaffDto) {
    const draft = drafts[member.user.userId];
    if (busy.current || !draft || draft === member.role) return;
    if (needsConfirmation(member.role, draft)) {
      setDialogError(null);
      setPending({ kind: "promote", member });
    } else {
      void saveRole(member, draft).then((ok) => {
        if (ok) setRefocus({ target: "level", userId: member.user.userId });
      });
    }
  }

  async function saveRole(member: StaffDto, role: ListedRole): Promise<boolean> {
    const userId = member.user.userId;
    if (busy.current) return false;
    busy.current = true;
    setWorking(true);
    clearTimeout(timers.current.get(userId));
    setStatus(userId, { kind: "saving" });
    const outcome = await send(staffUrl(userId), "PUT", { role });
    busy.current = false;
    setWorking(false);
    if (outcome.ok) {
      setDrafts((current) => {
        const next = { ...current };
        delete next[userId];
        return next;
      });
      setStatus(userId, { kind: "saved" });
      timers.current.set(
        userId,
        setTimeout(() => setStatus(userId, null), 3500),
      );
      router.refresh();
      return true;
    }
    setStatus(userId, { kind: "error", message: outcome.error });
    return false;
  }

  async function confirmPending() {
    if (!pending || busy.current) return;
    const { kind, member } = pending;
    setDialogError(null);
    if (kind === "promote") {
      const role = drafts[member.user.userId];
      if (!role) return setPending(null);
      const ok = await saveRole(member, role);
      // A failure is reported on the row, so the dialog closes either way and the owner lands back on the control.
      setPending(null);
      setRefocus({ target: ok ? "level" : "save", userId: member.user.userId });
      return;
    }
    busy.current = true;
    setWorking(true);
    const name = displayName(member.user);
    const outcome = await send(staffUrl(member.user.userId), "DELETE", {});
    busy.current = false;
    setWorking(false);
    if (outcome.ok) {
      toast.push({ kind: "success", title: `${name} no longer has access` });
      setPending(null);
      setRefocus({ target: "heading" });
      router.refresh();
    } else {
      setDialogError(outcome.error ?? "The server refused the change.");
    }
  }

  const ordered = sortStaff(staff);

  return (
    <section className="mod-card" aria-labelledby="access-staff-title">
      <div className="mod-card-head">
        <div>
          <h2 className="mod-card-title" id="access-staff-title" ref={headingRef} tabIndex={-1}>
            Staff on this server
          </h2>
          <p className="mod-card-desc">
            {staff.length === 0
              ? "Nobody besides you has access yet."
              : `${pluralPeople(staff.length)} can sign in. Pick a different level, then save it.`}
          </p>
        </div>
      </div>

      {staff.length === 0 ? (
        <div className="mod-empty">
          <span className="mod-empty-icon">
            <UserIcon />
          </span>
          <p className="mod-empty-title">Nobody else has access yet</p>
          <p className="mod-empty-text">
            Right now only you, as instance owner, can open the mod dashboard. Add a moderator or an admin below; they
            sign in with their own Discord account.
          </p>
          <div className="mod-empty-action">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => document.getElementById(ADD_SEARCH_ID)?.focus()}
            >
              <PlusIcon />
              Add the first person
            </button>
          </div>
        </div>
      ) : (
        <div className="mod-table-wrap" ref={tableRef}>
          <table className="mod-table access-staff">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Level</th>
                <th scope="col">Added</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((member) => {
                const id = member.user.userId;
                const name = displayName(member.user);
                const status = statuses[id];
                const draft = drafts[id];
                const shown = draft ?? member.role;
                const dirty = draft !== undefined;
                const saving = status?.kind === "saving";
                return (
                  <tr key={id} data-fresh={freshId === id ? "true" : undefined}>
                    <td data-label="Person">
                      <Person user={member.user} />
                    </td>
                    <td data-label="Level">
                      <div className="access-level">
                        <fieldset className="access-seg" aria-disabled={working || undefined}>
                          <legend className="visually-hidden">Level for {name}</legend>
                          {LISTED_ROLES.map((role) => (
                            <label key={role} data-role={role}>
                              <input
                                type="radio"
                                name={`level-${id}`}
                                value={role}
                                checked={shown === role}
                                onChange={() => choose(member, role)}
                              />
                              <CheckIcon />
                              <span>{ROLE_LABEL[role]}</span>
                            </label>
                          ))}
                        </fieldset>
                        {dirty ? (
                          <span className="access-draft-actions">
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              data-save={id}
                              aria-disabled={working || undefined}
                              onClick={() => requestSave(member)}
                            >
                              {saving ? "Saving…" : `Save as ${ROLE_LABEL[shown].toLowerCase()}`}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              aria-disabled={working || undefined}
                              onClick={() => cancelDraft(member)}
                            >
                              Cancel
                            </button>
                          </span>
                        ) : null}
                        <RowStatusText status={status} dirty={dirty} />
                      </div>
                    </td>
                    <td data-label="Added">
                      <div className="access-added">
                        <span>by {displayName(member.addedBy)}</span>
                        <time dateTime={member.addedAt} title={fmtDateTime(member.addedAt)} suppressHydrationWarning>
                          {fmtDate(member.addedAt)}
                        </time>
                      </div>
                    </td>
                    <td data-label="" className="access-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm access-remove"
                        aria-label={`Remove ${name}`}
                        data-remove={id}
                        aria-disabled={working || undefined}
                        onClick={() => {
                          if (busy.current) return;
                          setDialogError(null);
                          setPending({ kind: "remove", member });
                        }}
                      >
                        <TrashIcon />
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        pending={pending}
        newRole={pending ? drafts[pending.member.user.userId] : undefined}
        working={working}
        error={dialogError}
        onCancel={() => {
          if (pending) setRefocus({ target: pending.kind === "remove" ? "remove" : "save", userId: pending.member.user.userId });
          setPending(null);
        }}
        onConfirm={() => void confirmPending()}
      />
    </section>
  );
}

function RowStatusText({ status, dirty }: { status: RowStatus | undefined; dirty: boolean }) {
  // One persistent live region per row: text changes inside it are announced, a node that arrives with its text is not.
  return (
    <span className="access-rowstatus" role="status" data-status={status?.kind ?? (dirty ? "dirty" : undefined)}>
      {status?.kind === "saving" ? (
        <>
          <span className="spinner" aria-hidden="true" />
          Saving
        </>
      ) : null}
      {status?.kind === "saved" ? (
        <>
          <CheckIcon />
          Saved
        </>
      ) : null}
      {status?.kind === "error" ? (
        <>
          <AlertIcon />
          <span>Not saved. {status.message}</span>
        </>
      ) : null}
      {!status && dirty ? "Not saved yet" : null}
    </span>
  );
}

function ConfirmDialog({
  pending,
  newRole,
  working,
  error,
  onCancel,
  onConfirm,
}: {
  pending: Pending | null;
  newRole: ListedRole | undefined;
  working: boolean;
  error: string | null;
  onCancel(): void;
  onConfirm(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  // The dialog keeps showing the last request while it closes, so the text does not blank mid-fade.
  const [last, setLast] = useState<Pending | null>(pending);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (pending) {
      setLast(pending);
      if (!dialog.open) dialog.showModal();
      keepRef.current?.focus();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [pending]);

  const shown = pending ?? last;
  const name = shown ? displayName(shown.member.user) : "";
  const promote = shown?.kind === "promote";
  const role = promote && newRole ? newRole : (shown?.member.role ?? "mod");

  let body: ReactNode = null;
  if (shown && promote) {
    const gained = gainedPermissions(shown.member.role, role);
    body = (
      <>
        <p className="access-dialog-text">
          As an admin, {name} will also be able to:
        </p>
        <ul className="access-dialog-list">
          {gained.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
        <p className="access-dialog-text access-dialog-muted">
          Admins cannot purge records or change who has access. You can lower their level again at any time.
        </p>
      </>
    );
  } else if (shown) {
    body = (
      <>
        <p className="access-dialog-text">{removalConsequence(shown.member.role)}</p>
        <p className="access-dialog-text access-dialog-muted">You can add them again at any time.</p>
      </>
    );
  }

  return (
    <dialog
      ref={ref}
      className="access-dialog"
      aria-labelledby="access-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!working) onCancel();
      }}
      onClick={(event) => {
        if (event.target === ref.current && !working) onCancel();
      }}
    >
      {shown ? (
        <div className="access-dialog-body">
          <h3 className="access-dialog-title" id="access-dialog-title">
            {promote ? `Make ${name} an admin?` : `Remove ${name}?`}
          </h3>
          <div className="access-dialog-person">
            <Person user={shown.member.user} size="lg" />
            <RoleBadge role={shown.member.role} />
          </div>
          {body}
          {error ? (
            <div className="callout callout-error" role="alert">
              <AlertIcon />
              <div>
                <strong>Not removed.</strong> {error}
              </div>
            </div>
          ) : null}
          <div className="access-dialog-actions">
            <button
              ref={keepRef}
              type="button"
              className="btn btn-secondary"
              aria-disabled={working || undefined}
              onClick={() => {
                if (!working) onCancel();
              }}
            >
              {promote ? "Not now" : "Keep access"}
            </button>
            <button
              type="button"
              className={promote ? "btn btn-primary" : "btn access-danger"}
              aria-disabled={working || undefined}
              onClick={() => {
                if (!working) onConfirm();
              }}
            >
              {working ? (promote ? "Saving…" : "Removing…") : promote ? "Make admin" : `Remove ${name}`}
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
