"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { ModActionKind } from "@tier0/core";
import { AlertIcon, ShieldIcon } from "../../../../../../components/Icons";
import { StateIcon } from "../../../../../../components/mod/ModUi";
import {
  ACTION_REASON_LIMIT,
  SWITCHED_OFF,
  BAN_PRESETS,
  DAY_MS,
  DELETE_DAY_OPTIONS,
  TIMEOUT_PRESETS,
  UNIT_OPTIONS,
  actionTitle,
  banMax,
  buildRequest,
  busyLabel,
  clampDeleteDays,
  confirmLabel,
  consequences,
  describeMs,
  draftMs,
  durationProblem,
  endsAt,
  enterKeyAction,
  failureLead,
  initialDuration,
  isHeavy,
  presetsWithin,
  readResult,
  splitMs,
  timeoutMax,
  usesDuration,
  type BanLength,
  type DraftErrors,
  type DurationDraft,
  type DurationPreset,
  type DurationUnit,
  type FormContext,
  type MemberState,
} from "./actions";
import { failureText } from "./a11y";
import { DialogShell, type FocusFallback } from "./Dialog";
import { CharacterCount } from "./CharacterCount";
import { formatDateTime } from "./timeline";
import type { ContextState } from "./useActionContext";

interface DialogProps {
  kind: ModActionKind;
  guildId: string;
  userId: string;
  name: string;
  member: MemberState;
  contextState: ContextState;
  onRetry(): void;
  canConfigure: boolean;
  timeZone: string;
  fallbackFocus: FocusFallback;
  onClose(): void;
  onDone(result: { caseNumber: number | null; notes: string[] }): void;
}

/**
 * One action's dialog. It waits for the server's moderation settings, says so
 * plainly when the feature is off, and otherwise shows the form. The shell
 * stays mounted throughout, so the dialog does not flash or lose its place
 * when the settings arrive.
 */
export function ActionFormDialog(props: DialogProps) {
  const { kind, name, contextState, onClose, onRetry, fallbackFocus } = props;
  const [busy, setBusy] = useState(false);
  const descriptionId = useId();
  const content = useRef<HTMLDivElement>(null);
  const ready = contextState.status === "ready" ? contextState.context : null;
  const view = ready
    ? !ready.moduleEnabled
      ? "off"
      : ready.disabledActions.includes(kind)
        ? "switched-off"
        : "form"
    : contextState.status === "error"
      ? "error"
      : "loading";

  // Each view brings its own buttons. When one replaces another, the button
  // that had focus is gone, so focus moves to the new view's first control
  // rather than falling back to the page behind the scrim.
  useEffect(() => {
    const node = content.current;
    const dialog = node?.closest<HTMLElement>(".pf-dialog");
    if (!node || !dialog) return;
    const focused = document.activeElement;
    if (focused && focused !== dialog && focused !== document.body && dialog.contains(focused)) return;
    node.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [view]);

  return (
    <DialogShell
      title={actionTitle(kind, name)}
      layout="form"
      icon={<StateIcon action={kind} />}
      tone={isHeavy(kind) && view !== "off" && view !== "switched-off" ? "danger" : "default"}
      descriptionId={descriptionId}
      onClose={onClose}
      locked={busy}
      fallbackFocus={fallbackFocus}
    >
      <div ref={content} className="ta-content">
        {view === "form" && ready ? (
          <ActionForm {...props} context={ready} descriptionId={descriptionId} onBusy={setBusy} />
        ) : view === "off" ? (
          <FeatureOff id={descriptionId} guildId={props.guildId} canConfigure={props.canConfigure} onClose={onClose} />
        ) : view === "switched-off" ? (
          <>
            <div className="pf-dialog-body">
              <div className="ta-off" id={descriptionId}>
                <span className="ta-off-icon" aria-hidden="true">
                  <ShieldIcon />
                </span>
                <div className="ta-off-text">
                  <p className="ta-off-title">{SWITCHED_OFF}</p>
                  <p>Nothing has been changed. Someone who manages this server can switch it back on there.</p>
                </div>
              </div>
            </div>
            <div className="pf-dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose} data-autofocus>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="pf-dialog-body" aria-busy={view === "loading" || undefined}>
              {view === "error" && contextState.status === "error" ? (
                <p className="pf-dialog-error" role="alert" id={descriptionId}>
                  The action form could not be opened. {contextState.message}
                </p>
              ) : (
                <div className="ta-loading">
                  <p className="ta-loading-text" role="status" id={descriptionId}>
                    Reading this server’s moderation settings…
                  </p>
                  <span className="skeleton ta-skel" />
                  <span className="skeleton ta-skel ta-skel--tall" />
                  <span className="skeleton ta-skel ta-skel--short" />
                </div>
              )}
            </div>
            <div className="pf-dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose} {...(view === "loading" ? { "data-autofocus": true } : {})}>
                Close
              </button>
              {view === "error" ? (
                <button type="button" className="btn btn-primary" onClick={onRetry} data-autofocus>
                  Try again
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </DialogShell>
  );
}

function FeatureOff({ id, guildId, canConfigure, onClose }: { id: string; guildId: string; canConfigure: boolean; onClose(): void }) {
  return (
    <>
      <div className="pf-dialog-body">
        <div className="ta-off" id={id}>
          <span className="ta-off-icon" aria-hidden="true">
            <ShieldIcon />
          </span>
          <div className="ta-off-text">
            <p className="ta-off-title">Moderation is turned off for this server</p>
            <p>The bot only acts on members while the Moderation feature is on. Nothing has been changed.</p>
            <p>
              {canConfigure
                ? "Turn it on in the Moderation settings, then come back to this record."
                : "Ask someone who manages this server’s settings to turn it on."}
            </p>
          </div>
        </div>
      </div>
      <div className="pf-dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} {...(canConfigure ? {} : { "data-autofocus": true })}>
          Close
        </button>
        {canConfigure ? (
          <Link className="btn btn-primary" href={`/guilds/${guildId}/mod/settings`} data-autofocus>
            Open Moderation settings
          </Link>
        ) : null}
      </div>
    </>
  );
}

/* The form ---------------------------------------------------------------------- */

interface FormProps extends DialogProps {
  context: FormContext;
  /** The consequences summary carries this id: it is what the dialog announces after its title. */
  descriptionId: string;
  onBusy(busy: boolean): void;
}

const REASON_PLACEHOLDER: Record<ModActionKind, string> = {
  warn: "What did they do?",
  timeout: "What did they do?",
  "timeout-clear": "Why is the timeout ending early?",
  kick: "What did they do?",
  ban: "What did they do?",
  unban: "Why are they being let back in?",
};

/** A temporary ban starts at a week when the server allows one that long. */
const BAN_START_MS = 7 * DAY_MS;

function ActionForm({
  kind,
  guildId,
  userId,
  name,
  member,
  context,
  timeZone,
  descriptionId,
  onBusy,
  onClose,
  onDone,
}: FormProps) {
  const banCeiling = banMax(context);
  const ceiling = kind === "timeout" ? timeoutMax(context) : banCeiling;
  const presets = presetsWithin(kind === "timeout" ? TIMEOUT_PRESETS : BAN_PRESETS, ceiling);
  const what = kind === "timeout" ? "timeout" : "ban";

  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState<DurationDraft>(() =>
    initialDuration(presets, kind === "timeout" ? context.defaultTimeoutMs : BAN_START_MS, Math.max(ceiling, 1)),
  );
  const [banLength, setBanLength] = useState<BanLength>("permanent");
  const [deleteDays, setDeleteDays] = useState(() => clampDeleteDays(context.deleteMessageDays));
  // When the chosen length is counted from. It moves only when the reader
  // changes the length, so the end time, which is read out as it changes,
  // does not tick over by itself every minute while the dialog is open.
  const [anchor, setAnchor] = useState(() => new Date());
  const [errors, setErrors] = useState<DraftErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const form = useRef<HTMLFormElement>(null);

  const reasonId = useId();
  const reasonHintId = useId();
  const reasonErrorId = useId();
  const errorId = useId();
  const deleteId = useId();

  const heavy = isHeavy(kind);
  const timed = usesDuration({ kind, banLength });
  const lengthMs = timed ? draftMs(duration) : null;
  const lengthOk = lengthMs !== null && durationProblem(duration, ceiling, what) === null;
  const until = timed && lengthOk ? formatDateTime(endsAt(lengthMs, anchor), timeZone) : null;
  const lines = consequences({ kind, dmOnAction: context.dmOnAction, banLength, deleteDays, until });

  useEffect(() => {
    onBusy(busy);
  }, [busy, onBusy]);

  // On a phone the error can land below the fold of the sheet, behind the
  // pinned buttons, so it is brought to the middle; the alert is read out
  // either way.
  useEffect(() => {
    if (serverError) document.getElementById(errorId)?.scrollIntoView({ block: "center" });
  }, [serverError, errorId]);

  function focusFirstInvalid(found: DraftErrors) {
    const node = form.current;
    if (!node) return;
    const target = found.duration
      ? node.querySelector<HTMLElement>('[data-length-field="true"]')
      : found.reason
        ? document.getElementById(reasonId)
        : null;
    target?.focus();
  }

  async function submit() {
    if (submitting.current) return;
    const check = buildRequest({ kind, reason, duration, banLength, deleteDays }, context);
    if (!check.ok) {
      setErrors(check.errors);
      focusFirstInvalid(check.errors);
      return;
    }
    setErrors({});
    submitting.current = true;
    setBusy(true);
    setServerError(null);
    let outcome: { caseNumber: number | null; notes: string[] } | null = null;
    try {
      const res = await fetch(`/api/guilds/${guildId}/mod/members/${encodeURIComponent(userId)}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(check.request),
      });
      const data: unknown = await res.json().catch(() => null);
      if (res.ok) {
        outcome = readResult(data);
      } else {
        // The bot's sentence already says what went wrong and what to do, so it
        // is shown as written; the lead is only for a reply that carries none.
        const detail = data && typeof data === "object" && "error" in data ? (data as { error: unknown }).error : null;
        setServerError(
          typeof detail === "string" && detail.trim() !== ""
            ? detail.trim()
            : failureText(failureLead(kind, name), null, res.status),
        );
      }
    } catch {
      setServerError(failureText(failureLead(kind, name), "The dashboard could not be reached. Check your connection and try again."));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
    if (outcome) onDone(outcome);
  }

  function clearError(field: keyof DraftErrors) {
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  }

  return (
    <form
      ref={form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      aria-busy={busy || undefined}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        const action = enterKeyAction({
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          tag: target.tagName,
          type: target instanceof HTMLInputElement ? target.type : "",
        });
        if (action === "default") return;
        event.preventDefault();
        if (action === "submit") void submit();
      }}
    >
      <div className="pf-dialog-body">
        {kind === "timeout-clear" && member.timeoutUntil ? (
          <p className="ta-intro">
            Their timeout was due to run until{" "}
            <time dateTime={member.timeoutUntil}>{formatDateTime(member.timeoutUntil, timeZone)}</time>.
          </p>
        ) : null}

        {kind === "ban" && banCeiling > 0 ? (
          <fieldset className="ta-fieldset">
            <legend className="pf-field-label">How long</legend>
            <div className="ta-choices">
              <Choice
                group={`${descriptionId}-length`}
                checked={banLength === "permanent"}
                onSelect={() => {
                  if (busy) return;
                  setBanLength("permanent");
                  setAnchor(new Date());
                }}
                title="Permanent"
                detail="Until someone unbans them"
              />
              <Choice
                group={`${descriptionId}-length`}
                checked={banLength === "temporary"}
                onSelect={() => {
                  if (busy) return;
                  setBanLength("temporary");
                  setAnchor(new Date());
                  clearError("duration");
                }}
                title="For a set time"
                detail="Lifts on its own when the time is up"
              />
            </div>
          </fieldset>
        ) : null}

        {timed ? (
          <LengthField
            label={kind === "timeout" ? "Length" : "Ban length"}
            presets={presets}
            value={duration}
            max={ceiling}
            until={until}
            lengthMs={lengthOk ? lengthMs : null}
            error={errors.duration ?? null}
            busy={busy}
            autoFocus={kind === "timeout"}
            onChange={(next) => {
              setDuration(next);
              setAnchor(new Date());
              clearError("duration");
            }}
          />
        ) : null}

        {kind === "ban" ? (
          <div className="pf-field">
            <label className="pf-field-label" htmlFor={deleteId}>
              Delete their recent messages
            </label>
            <select
              id={deleteId}
              className="select ta-select"
              value={deleteDays}
              onChange={(event) => !busy && setDeleteDays(clampDeleteDays(Number(event.target.value)))}
            >
              {DELETE_DAY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="pf-field">
          <div className="pf-field-row">
            <label className="pf-field-label ta-label" htmlFor={reasonId}>
              Reason
              <span className="ta-tag" data-required={context.requireReason ? "true" : undefined}>
                {context.requireReason ? "Required" : "Optional"}
              </span>
            </label>
            <CharacterCount length={reason.length} limit={ACTION_REASON_LIMIT} />
          </div>
          <textarea
            id={reasonId}
            className="textarea pf-textarea"
            rows={3}
            value={reason}
            maxLength={ACTION_REASON_LIMIT}
            placeholder={REASON_PLACEHOLDER[kind]}
            aria-required={context.requireReason || undefined}
            aria-invalid={errors.reason ? true : undefined}
            aria-describedby={errors.reason ? `${reasonErrorId} ${reasonHintId}` : reasonHintId}
            readOnly={busy}
            onChange={(event) => {
              setReason(event.target.value);
              clearError("reason");
            }}
            // A timeout opens on its length, the choice that matters most.
            // Every other action, the heavy ones included, opens on the reason.
            {...(kind === "timeout" ? {} : { "data-autofocus": true })}
          />
          {errors.reason ? (
            <p className="pf-field-error" id={reasonErrorId} role="alert">
              <AlertIcon />
              {errors.reason}
            </p>
          ) : null}
          <p className="pf-field-hint" id={reasonHintId}>
            {context.dmOnAction
              ? "Saved on their record and included in the direct message they get."
              : "Saved on their record for staff to read."}
          </p>
        </div>

        <div className="ta-summary" data-tone={heavy ? "danger" : undefined} id={descriptionId}>
          <p className="ta-summary-title">{heavy ? "Before you confirm" : "What happens"}</p>
          <ul className="ta-summary-list">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        {serverError ? (
          <p className="pf-dialog-error" role="alert" id={errorId}>
            {serverError}
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
        {/* aria-disabled rather than disabled while sending: a disabled button drops focus to the page. */}
        <button
          type="submit"
          className={heavy ? "btn btn-danger" : "btn btn-primary"}
          aria-disabled={busy || undefined}
          aria-describedby={serverError ? errorId : undefined}
        >
          {busy ? busyLabel(kind) : confirmLabel(kind, name)}
        </button>
      </div>
    </form>
  );
}

function Choice({
  group,
  checked,
  onSelect,
  title,
  detail,
}: {
  group: string;
  checked: boolean;
  onSelect(): void;
  title: string;
  detail: string;
}) {
  const detailId = useId();
  return (
    <label className="ta-choice" data-checked={checked ? "true" : undefined}>
      <input
        type="radio"
        name={group}
        className="ta-choice-input"
        checked={checked}
        onChange={onSelect}
        aria-describedby={detailId}
      />
      <span className="ta-choice-mark" aria-hidden="true" />
      <span className="ta-choice-text">
        <span className="ta-choice-title">{title}</span>
        <span className="ta-choice-detail" id={detailId}>
          {detail}
        </span>
      </span>
    </label>
  );
}

/* Length ----------------------------------------------------------------------------- */

interface LengthProps {
  label: string;
  presets: DurationPreset[];
  value: DurationDraft;
  max: number;
  until: string | null;
  lengthMs: number | null;
  error: string | null;
  busy: boolean;
  autoFocus: boolean;
  onChange(next: DurationDraft): void;
}

/**
 * Common lengths as one tap each, with a custom number and unit for the rest.
 * The presets are native radio buttons, so arrow keys move between them and a
 * screen reader hears one group with a single choice.
 */
function LengthField({ label, presets, value, max, until, lengthMs, error, busy, autoFocus, onChange }: LengthProps) {
  const group = useId();
  const resultId = useId();
  const errorId = useId();
  const amountId = useId();
  const custom = value.choice === "custom";
  const describedBy = error ? `${errorId} ${resultId}` : resultId;

  function pick(choice: number | "custom") {
    if (busy) return;
    if (choice === "custom") {
      onChange({ ...value, choice: "custom" });
      return;
    }
    onChange({ choice, ...splitMs(choice) });
  }

  return (
    <fieldset className="ta-fieldset" aria-describedby={describedBy}>
      <legend className="pf-field-label">{label}</legend>
      <div className="ta-presets">
        {presets.map((preset) => {
          const checked = value.choice === preset.ms;
          return (
            <label key={preset.ms} className="ta-chip" data-checked={checked ? "true" : undefined}>
              <input
                type="radio"
                name={group}
                className="ta-chip-input"
                checked={checked}
                onChange={() => pick(preset.ms)}
                {...(checked && autoFocus ? { "data-autofocus": true } : {})}
              />
              <span>{preset.label}</span>
            </label>
          );
        })}
        <label className="ta-chip" data-checked={custom ? "true" : undefined}>
          <input
            type="radio"
            name={group}
            className="ta-chip-input"
            checked={custom}
            onChange={() => pick("custom")}
            {...(custom && autoFocus ? { "data-autofocus": true } : {})}
          />
          <span>Custom</span>
        </label>
      </div>

      {custom ? (
        <div className="ta-custom">
          <label className="pf-sr" htmlFor={amountId}>
            Custom length
          </label>
          <input
            id={amountId}
            className="input ta-amount"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={value.amount}
            readOnly={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) => onChange({ ...value, amount: event.target.value.replace(/[^0-9]/g, "").slice(0, 6) })}
            data-length-field="true"
          />
          <select
            className="select ta-unit"
            aria-label="Unit"
            value={value.unit}
            onChange={(event) => !busy && onChange({ ...value, unit: event.target.value as DurationUnit })}
          >
            {UNIT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {error ? (
        <p className="pf-field-error" id={errorId} role="alert">
          <AlertIcon />
          {error}
        </p>
      ) : null}
      <p className="ta-until" id={resultId} aria-live="polite" aria-atomic="true">
        {until && lengthMs !== null ? (
          <>
            Lasts {describeMs(lengthMs)}, until <strong>{until}</strong>.
          </>
        ) : (
          `Up to ${describeMs(max)}.`
        )}
      </p>
    </fieldset>
  );
}
