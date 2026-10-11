"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABEL, type ListedRole, type UserRef } from "@tier0/core";
import { useToast } from "../../../../../components/Toaster";
import { XIcon } from "../../../../../components/Icons";
import { displayName } from "../../../../../components/mod/ModUi";
import { MemberSearch } from "./MemberSearch";
import { Person } from "./Person";
import { ADD_SEARCH_ID } from "./ids";
import { LISTED_ROLES, ROLE_SUMMARY, addState, grantCount, isSnowflake, userIdProblem } from "./logic";
import { send } from "./send";

type AddMode = "search" | "id";

export interface AddStaffProps {
  guildId: string;
  existing: ReadonlySet<string>;
  staffUrl(userId: string): string;
  onAdded(userId: string): void;
}

export function AddStaff({ guildId, existing, staffUrl, onAdded }: AddStaffProps) {
  const router = useRouter();
  const toast = useToast();
  const busy = useRef(false);
  const changeRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<AddMode>("search");
  const [picked, setPicked] = useState<UserRef | null>(null);
  const [rawId, setRawId] = useState("");
  const [role, setRole] = useState<ListedRole>("mod");
  const [submitting, setSubmitting] = useState(false);
  const base = useId();
  const memberLabelId = `${base}-member`;
  const reasonId = `${base}-reason`;

  const trimmedId = rawId.trim();
  const idProblem = mode === "id" && rawId !== "" ? userIdProblem(rawId) : null;
  const targetId = mode === "search" ? (picked?.userId ?? null) : isSnowflake(rawId) ? trimmedId : null;
  const state = addState(targetId, existing);
  const canSubmit = state.ok && !submitting;
  const targetName = mode === "search" && picked ? displayName(picked) : targetId ? `User ${targetId.slice(-4)}` : null;

  // Choosing someone unmounts the search box, which would drop focus to the page; keep it on the next control.
  useEffect(() => {
    if (picked) changeRef.current?.focus();
  }, [picked]);

  async function add() {
    if (!canSubmit || busy.current || targetId === null) return;
    busy.current = true;
    setSubmitting(true);
    const outcome = await send(staffUrl(targetId), "PUT", { role });
    busy.current = false;
    setSubmitting(false);
    if (outcome.ok) {
      toast.push({ kind: "success", title: `${targetName} added as ${ROLE_LABEL[role].toLowerCase()}` });
      onAdded(targetId);
      setPicked(null);
      setRawId("");
      router.refresh();
    } else {
      toast.push({ kind: "error", title: "Could not add that person", detail: outcome.error });
    }
  }

  function switchMode(next: AddMode) {
    setMode(next);
    setPicked(null);
    setRawId("");
  }

  const hint =
    state.reason ??
    (targetName
      ? `${targetName} will be able to sign in as ${ROLE_LABEL[role].toLowerCase()}.`
      : mode === "search"
        ? "Choose a member to continue."
        : "Paste a user id to continue.");

  return (
    <section className="mod-card" aria-labelledby="access-add-title" id="access-add">
      <div className="mod-card-head">
        <div>
          <h2 className="mod-card-title" id="access-add-title">
            Give someone access
          </h2>
          <p className="mod-card-desc">They sign in with Discord. Nothing else about their server permissions changes.</p>
        </div>
      </div>

      <form
        className="mod-card-body access-add"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <div className="access-field">
          {mode === "search" ? (
            <>
              <span className="field-label" id={memberLabelId}>
                Member
              </span>
              {picked ? (
                <div className="access-picked">
                  <Person user={picked} />
                  <button ref={changeRef} type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(null)}>
                    <XIcon />
                    Change
                  </button>
                </div>
              ) : (
                <MemberSearch guildId={guildId} existing={existing} labelId={memberLabelId} onPick={setPicked} />
              )}
            </>
          ) : (
            <>
              <label className="field-label" htmlFor={ADD_SEARCH_ID}>
                Discord user id
              </label>
              <input
                id={ADD_SEARCH_ID}
                className="input access-id-input"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                placeholder="123456789012345678"
                value={rawId}
                aria-invalid={idProblem !== null}
                aria-describedby={idProblem ? `${base}-iderror` : `${base}-idhelp`}
                onChange={(event) => setRawId(event.target.value)}
              />
              {idProblem ? (
                <p className="field-error" id={`${base}-iderror`}>
                  {idProblem}
                </p>
              ) : (
                <p className="field-help" id={`${base}-idhelp`}>
                  For someone who is not in the server right now. In Discord, turn on Developer Mode, right-click the
                  person and choose Copy User ID.
                </p>
              )}
            </>
          )}
          {!picked ? (
            <button
              type="button"
              className="access-quiet"
              onClick={() => switchMode(mode === "search" ? "id" : "search")}
            >
              {mode === "search" ? "Not in the server? Add by user id" : "Back to searching members"}
            </button>
          ) : null}
        </div>

        <fieldset className="access-field access-levels">
          <legend className="field-label">Level</legend>
          <div className="access-level-grid">
            {LISTED_ROLES.map((value) => {
              const { granted, total } = grantCount(value);
              return (
                <label key={value} className="access-level-card" data-role={value}>
                  <input
                    type="radio"
                    name={`${base}-level`}
                    value={value}
                    checked={role === value}
                    onChange={() => setRole(value)}
                  />
                  <span className="access-level-name">{ROLE_LABEL[value]}</span>
                  <span className="access-level-desc">{ROLE_SUMMARY[value]}</span>
                  <span className="access-level-meta">
                    {granted} of {total} permissions
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="access-add-foot">
          <button type="submit" className="btn btn-primary" disabled={!canSubmit} aria-describedby={reasonId}>
            {submitting ? "Adding…" : "Add to staff"}
          </button>
          <p className="access-add-hint" id={reasonId} role="status" data-problem={state.reason ? "true" : undefined}>
            {hint}
          </p>
        </div>
      </form>
    </section>
  );
}
