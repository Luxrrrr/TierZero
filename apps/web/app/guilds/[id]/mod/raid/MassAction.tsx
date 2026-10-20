"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MASS_ACTION_LIMIT, type MassActionKind, type MassJobDto, type MassPreviewDto } from "@tier0/shared-moderation";
import { AlertIcon, BanIcon, DoorIcon, UsersIcon } from "../../../../../components/Icons";
import { Select } from "../../../../../components/form/Select";
import { Pill, RelativeTime, UserChip } from "../../../../../components/mod/ModUi";
import {
  MASS_POLL_MS,
  MASS_REASON_LIMIT,
  QUICK_WINDOWS,
  buildMassRequest,
  idsSummary,
  jobProgressText,
  massConfirmLabel,
  parseIds,
  previewSummary,
  quickWindow,
  readJob,
  readPreview,
  requestKey,
  type MassDraft,
  type MassTarget,
} from "../../../../../lib/mod-raid";
import { useUnsavedGuard } from "../../../../../lib/unsaved-guard";
import { CharacterCount } from "../members/[userId]/CharacterCount";
import { DELETE_DAY_OPTIONS } from "../members/[userId]/actions";
import { HoldButton } from "../danger/HoldButton";

/** Past this many rows the preview says how many more there are instead of listing them. */
const PREVIEW_ROWS = 100;

/** After this many failed polls in a row the page says it lost track, instead of waiting silently. */
const POLL_GIVE_UP = 5;

function errorText(data: unknown, fallback: string): string {
  const detail = data && typeof data === "object" && "error" in data ? (data as { error: unknown }).error : null;
  return typeof detail === "string" && detail.trim() !== "" ? detail.trim() : fallback;
}

const EMPTY: MassDraft = { action: "ban", target: "ids", idsText: "", joinedAfter: "", joinedBefore: "", reason: "", deleteDays: 0 };

/**
 * Banning or kicking many members at once, for the aftermath of a raid.
 * Nothing runs without a preview of exactly who would be acted on, and any
 * change to the inputs afterwards throws the preview away, so what is
 * confirmed is always what was previewed. The bot checks the count again.
 */
export function MassAction({ guildId, moduleEnabled }: { guildId: string; moduleEnabled: boolean }) {
  const [draft, setDraft] = useState<MassDraft>(EMPTY);
  const [problem, setProblem] = useState<{ field: string; error: string } | null>(null);
  const [preview, setPreview] = useState<{ key: string; data: MassPreviewDto } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [job, setJob] = useState<MassJobDto | null>(null);
  const [lostTrack, setLostTrack] = useState(false);
  const pollFailures = useRef(0);

  const idsId = useId();
  const idsHintId = useId();
  const afterId = useId();
  const beforeId = useId();
  const windowErrorId = useId();
  const reasonId = useId();
  const deleteId = useId();
  const actionGroup = useId();
  const targetGroup = useId();
  const errorId = useId();

  const running = job !== null && job.status === "running";
  const guard = useUnsavedGuard({
    dirty: !running && job === null && (draft.idsText.trim() !== "" || draft.reason.trim() !== ""),
    onDiscard: () => setDraft(EMPTY),
  });

  const check = buildMassRequest(draft);
  const currentKey = check.ok ? requestKey(check.request) : null;
  // A preview only stands while the inputs are exactly the ones it was made from.
  const livePreview = preview && preview.key === currentKey ? preview.data : null;
  const parsed = draft.target === "ids" ? parseIds(draft.idsText) : null;
  const locked = previewing || starting || running;

  function change(patch: Partial<MassDraft>) {
    if (locked) return;
    setDraft((current) => ({ ...current, ...patch }));
    setProblem(null);
    setServerError(null);
  }

  async function runPreview() {
    if (locked) return;
    if (!check.ok) {
      setProblem({ field: check.field, error: check.error });
      const target = check.field === "ids" ? idsId : check.field === "after" ? afterId : check.field === "before" ? beforeId : reasonId;
      document.getElementById(target)?.focus();
      return;
    }
    setPreviewing(true);
    setServerError(null);
    setJob(null);
    try {
      const res = await fetch(`/api/guilds/${guildId}/mod/raid/mass/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(check.request),
      });
      const data: unknown = await res.json().catch(() => null);
      const read = res.ok ? readPreview(data) : null;
      if (read) setPreview({ key: requestKey(check.request), data: read });
      else setServerError(errorText(data, `The preview could not be made. The server answered ${res.status}. Try again.`));
    } catch {
      setServerError("The dashboard could not be reached. Check your connection and try again.");
    } finally {
      setPreviewing(false);
    }
  }

  async function start() {
    if (!check.ok || !livePreview || livePreview.count === 0 || starting) return;
    setStarting(true);
    setServerError(null);
    try {
      const res = await fetch(`/api/guilds/${guildId}/mod/raid/mass`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...check.request, confirm: livePreview.count, token: livePreview.token }),
      });
      const data: unknown = await res.json().catch(() => null);
      const read = res.ok ? readJob(data) : null;
      if (read) {
        pollFailures.current = 0;
        setLostTrack(false);
        setJob(read);
        setPreview(null);
      } else {
        // A 409 means the members matching changed since the preview; the old one is no use any more.
        if (res.status === 409) setPreview(null);
        setServerError(errorText(data, `Nothing was started. The server answered ${res.status}. Preview again and retry.`));
      }
    } catch {
      setServerError("The dashboard could not be reached. Nothing was started. Check your connection and try again.");
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    if (!job || job.status !== "running") return;
    let stopped = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/guilds/${guildId}/mod/raid/mass/${encodeURIComponent(job.id)}`, { cache: "no-store" });
        const data: unknown = await res.json().catch(() => null);
        const read = res.ok ? readJob(data) : null;
        if (stopped) return;
        if (read) {
          pollFailures.current = 0;
          setJob(read);
          return;
        }
      } catch {
        // Counted below like a refusal: either way this poll told us nothing.
      }
      if (stopped) return;
      pollFailures.current += 1;
      if (pollFailures.current >= POLL_GIVE_UP) setLostTrack(true);
      else setJob((current) => (current ? { ...current } : current));
    }, MASS_POLL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [job, guildId]);

  const verb = draft.action === "ban" ? "banned" : "kicked";

  return (
    <section className="mod-section raid-section" aria-labelledby="raid-mass-title">
      {guard.host}
      <div className="mod-section-head">
        <div className="mod-section-text">
          <h2 className="mod-section-title" id="raid-mass-title">
            Mass ban or kick
          </h2>
          <p className="mod-section-desc">
            Removes many raid accounts at once. Preview first to see exactly who would be {verb}; nothing happens until you
            hold the button under the preview.
          </p>
        </div>
      </div>

      <div className="danger-zone raid-mass">
        {!moduleEnabled ? (
          <div className="callout callout-attention raid-mass-callout">
            <AlertIcon />
            <div>Moderation is turned off for this server, so the bot will not ban or kick anyone from here.</div>
          </div>
        ) : null}

        <div className="raid-mass-body">
          <fieldset className="ta-fieldset">
            <legend className="pf-field-label">Action</legend>
            <div className="ta-choices">
              {(["ban", "kick"] as MassActionKind[]).map((action) => (
                <label key={action} className="ta-choice" data-checked={draft.action === action ? "true" : undefined}>
                  <input
                    type="radio"
                    name={actionGroup}
                    className="ta-choice-input"
                    checked={draft.action === action}
                    onChange={() => change({ action })}
                  />
                  <span className="ta-choice-mark" aria-hidden="true" />
                  <span className="ta-choice-text">
                    <span className="ta-choice-title">{action === "ban" ? "Ban" : "Kick"}</span>
                    <span className="ta-choice-detail">
                      {action === "ban" ? "Remove them and stop them rejoining" : "Remove them; they can rejoin with an invite"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="ta-fieldset">
            <legend className="pf-field-label">Who</legend>
            <div className="ta-choices">
              {(
                [
                  { value: "ids", title: "Paste user IDs", detail: `Up to ${MASS_ACTION_LIMIT}, from a list or a log` },
                  { value: "joined", title: "Everyone who joined between", detail: "Members in the server now who joined in a time window" },
                ] as { value: MassTarget; title: string; detail: string }[]
              ).map((option) => (
                <label key={option.value} className="ta-choice" data-checked={draft.target === option.value ? "true" : undefined}>
                  <input
                    type="radio"
                    name={targetGroup}
                    className="ta-choice-input"
                    checked={draft.target === option.value}
                    onChange={() => change({ target: option.value })}
                  />
                  <span className="ta-choice-mark" aria-hidden="true" />
                  <span className="ta-choice-text">
                    <span className="ta-choice-title">{option.title}</span>
                    <span className="ta-choice-detail">{option.detail}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {draft.target === "ids" ? (
            <div className="pf-field">
              <label className="pf-field-label" htmlFor={idsId}>
                User IDs
              </label>
              <textarea
                id={idsId}
                className="textarea pf-textarea raid-ids"
                rows={5}
                value={draft.idsText}
                readOnly={locked}
                spellCheck={false}
                placeholder={"112233445566778899\n<@998877665544332211>"}
                aria-invalid={problem?.field === "ids" ? true : undefined}
                aria-describedby={idsHintId}
                onChange={(event) => change({ idsText: event.target.value })}
              />
              <p className={problem?.field === "ids" ? "pf-field-error" : "pf-field-hint"} id={idsHintId} role={problem?.field === "ids" ? "alert" : undefined}>
                {problem?.field === "ids"
                  ? problem.error
                  : parsed && draft.idsText.trim() !== ""
                    ? idsSummary(parsed) + (parsed.ids.length > MASS_ACTION_LIMIT ? ` That is more than ${MASS_ACTION_LIMIT}; split the list.` : "")
                    : "Separate them with spaces, commas or new lines. Mentions like <@id> work too."}
              </p>
            </div>
          ) : (
            <div className="pf-field">
              <span className="pf-field-label" id={`${afterId}-group`}>
                Joined between, in your local time
              </span>
              <div className="raid-window" role="group" aria-labelledby={`${afterId}-group`}>
                <label className="raid-window-field">
                  <span>From</span>
                  <input
                    id={afterId}
                    type="datetime-local"
                    className="input"
                    value={draft.joinedAfter}
                    readOnly={locked}
                    aria-invalid={problem?.field === "after" ? true : undefined}
                    aria-describedby={problem && (problem.field === "after" || problem.field === "before") ? windowErrorId : undefined}
                    onChange={(event) => change({ joinedAfter: event.target.value })}
                  />
                </label>
                <label className="raid-window-field">
                  <span>To (empty for now)</span>
                  <input
                    id={beforeId}
                    type="datetime-local"
                    className="input"
                    value={draft.joinedBefore}
                    readOnly={locked}
                    aria-invalid={problem?.field === "before" ? true : undefined}
                    aria-describedby={problem && (problem.field === "after" || problem.field === "before") ? windowErrorId : undefined}
                    onChange={(event) => change({ joinedBefore: event.target.value })}
                  />
                </label>
              </div>
              <div className="raid-quick" role="group" aria-label="Quick picks">
                {QUICK_WINDOWS.map((pick) => (
                  <button
                    key={pick.label}
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      const range = quickWindow(pick.ms, new Date());
                      change({ joinedAfter: range.after, joinedBefore: range.before });
                    }}
                  >
                    {pick.label}
                  </button>
                ))}
              </div>
              {problem && (problem.field === "after" || problem.field === "before") ? (
                <p className="pf-field-error" id={windowErrorId} role="alert">
                  <AlertIcon />
                  {problem.error}
                </p>
              ) : null}
            </div>
          )}

          <div className="raid-lock-fields">
            <div className="pf-field raid-grow">
              <div className="pf-field-row">
                <label className="pf-field-label" htmlFor={reasonId}>
                  Reason <span className="ta-tag">Optional</span>
                </label>
                <CharacterCount length={draft.reason.length} limit={MASS_REASON_LIMIT} />
              </div>
              <input
                id={reasonId}
                className="input"
                value={draft.reason}
                maxLength={MASS_REASON_LIMIT}
                readOnly={locked}
                placeholder="Raid accounts spamming #lfg"
                onChange={(event) => change({ reason: event.target.value })}
              />
            </div>
            {draft.action === "ban" ? (
              <div className="pf-field">
                <label className="pf-field-label" id={`${deleteId}-label`} htmlFor={deleteId}>
                  Delete their recent messages
                </label>
                <Select
                  id={deleteId}
                  className="ta-select"
                  aria-labelledby={`${deleteId}-label`}
                  value={String(draft.deleteDays)}
                  options={DELETE_DAY_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))}
                  onChange={(next) => change({ deleteDays: Number(next) })}
                />
              </div>
            ) : null}
          </div>

          <div className="raid-mass-actions">
            <button type="button" className="btn btn-secondary" aria-disabled={locked || undefined} onClick={() => void runPreview()}>
              <UsersIcon />
              {previewing ? "Making the preview…" : livePreview ? "Preview again" : "Preview"}
            </button>
            {preview && !livePreview && !locked ? (
              <span className="raid-hint" role="status">
                The inputs changed since the last preview. Preview again before going ahead.
              </span>
            ) : null}
          </div>

          {serverError ? (
            <p className="pf-dialog-error" role="alert" id={errorId}>
              {serverError}
            </p>
          ) : null}
        </div>

        {livePreview ? <Preview preview={livePreview} /> : null}

        {livePreview ? (
          <div className="danger-foot raid-mass-foot">
            {livePreview.count === 0 ? (
              <p className="raid-hint">Nobody here would be {livePreview.action === "ban" ? "banned" : "kicked"}, so there is nothing to confirm.</p>
            ) : (
              <>
                <p className="raid-hint">
                  {livePreview.action === "ban" ? <BanIcon /> : <DoorIcon />}
                  Each member gets a case on their record, and the reason goes with it.
                </p>
                <HoldButton
                  label={starting ? "Starting…" : massConfirmLabel(livePreview.action, livePreview.count)}
                  disabled={starting || !moduleEnabled}
                  onConfirm={() => void start()}
                />
              </>
            )}
          </div>
        ) : null}

        {job ? (
          <JobProgress
            job={job}
            lostTrack={lostTrack}
            onReset={() => {
              setJob(null);
              setLostTrack(false);
              setDraft(EMPTY);
            }}
          />
        ) : null}
      </div>
    </section>
  );
}

function Preview({ preview }: { preview: MassPreviewDto }) {
  const shown = preview.targets.slice(0, PREVIEW_ROWS);
  const more = preview.targets.length - shown.length;
  const going = preview.action === "ban" ? "Will be banned" : "Will be kicked";
  return (
    <div className="raid-preview">
      <p className="raid-preview-summary" role="status">
        <strong>{previewSummary(preview)}</strong>
      </p>
      {preview.targets.length > 0 ? (
        <div className="mod-table-wrap">
          <table className="mod-table raid-preview-table">
            <caption className="visually-hidden">Who the action would reach</caption>
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Joined</th>
                <th scope="col">Account made</th>
                <th scope="col">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((target) => (
                <tr key={target.user.userId} data-skipped={target.skip ? "true" : undefined}>
                  <td data-label="Member">
                    <UserChip user={target.user} sub={<span className="mod-id">{target.user.userId}</span>} size="sm" />
                  </td>
                  <td data-label="Joined">{target.joinedAt ? <RelativeTime iso={target.joinedAt} /> : <span className="raid-dim">Not in the server</span>}</td>
                  <td data-label="Account made">{target.accountCreatedAt ? <RelativeTime iso={target.accountCreatedAt} /> : <span className="raid-dim">Unknown</span>}</td>
                  <td data-label="Outcome">
                    {target.skip ? (
                      <span className="raid-skip">
                        <Pill tone="neutral">Left alone</Pill> {target.skip}
                      </span>
                    ) : (
                      <Pill tone="danger">{going}</Pill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {more > 0 ? <p className="raid-hint">And {more.toLocaleString("en")} more not listed here.</p> : null}
    </div>
  );
}

function JobProgress({ job, lostTrack, onReset }: { job: MassJobDto; lostTrack: boolean; onReset(): void }) {
  const done = job.status === "done";
  return (
    <div className="raid-job" aria-live="polite">
      <p className="raid-job-title">{done ? "Mass action finished" : job.action === "ban" ? "Banning…" : "Kicking…"}</p>
      <progress className="raid-progress" max={Math.max(1, job.total)} value={Math.min(job.done, job.total)} aria-label="Progress" />
      <p className="raid-job-text">{jobProgressText(job)}</p>
      {lostTrack && !done ? (
        <p className="raid-hint" role="alert">
          The dashboard lost contact with the bot while this was running. It carries on in the bot; check Mod logs to see
          who was {job.action === "ban" ? "banned" : "kicked"}.
        </p>
      ) : null}
      {job.failures.length > 0 ? (
        <details className="raid-failures" open={done}>
          <summary>
            {job.failures.length} {job.failures.length === 1 ? "failure" : "failures"}
          </summary>
          <ul>
            {job.failures.map((line, index) => (
              <li key={`${index}-${line}`}>{line}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {done || lostTrack ? (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onReset}>
          Start another
        </button>
      ) : null}
    </div>
  );
}
