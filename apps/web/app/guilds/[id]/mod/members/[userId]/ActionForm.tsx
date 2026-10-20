"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { EvidenceRef, ModActionKind } from "@tier0/shared-moderation";
import { AlertIcon, ShieldIcon } from "../../../../../../components/Icons";
import { Select } from "../../../../../../components/form/Select";
import { Switch } from "../../../../../../components/form/Switch";
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
  applyPreset,
  banMax,
  clampedPresetText,
  presetDescription,
  buildRequest,
  busyLabel,
  clampDeleteDays,
  confirmLabel,
  consequences,
  deletionChoiceText,
  describeMs,
  draftMs,
  durationProblem,
  earlierEndWarning,
  endsAt,
  enterKeyAction,
  failureLead,
  initialDuration,
  isHeavy,
  offersDeletion,
  presetsWithin,
  readResult,
  splitMs,
  timeoutMax,
  unchosenDuration,
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
import { EvidencePicker } from "./EvidencePicker";
import { clearAttach, readAttach } from "../../../../../../lib/attach-handoff";
import { formatDateTime } from "./timeline";
import { useUnsavedGuard } from "../../../../../../lib/unsaved-guard";
import { reasonWithMessageLink } from "../../../../../../lib/person-menu";
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
  /** Messages to attach when the form opens, such as the one a right-click started from. */
  evidence?: EvidenceRef[];
  /** A link to that message. If the bot cannot copy the message into the case, the link goes in the reason instead. */
  messageLink?: string;
}

/**
 * One action's dialog. It waits for the server's moderation settings, says so
 * plainly when the feature is off, and otherwise shows the form. The shell
 * stays mounted throughout, so the dialog does not flash or lose its place
 * when the settings arrive.
 */
export function ActionFormDialog(props: DialogProps) {
  const { kind, name, contextState, onClose, onRetry, fallbackFocus } = props;
  const changing = kind === "timeout" && props.member.timedOut;
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
      title={actionTitle(kind, name, changing)}
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
  evidence: startEvidence,
  messageLink: originLink,
}: FormProps) {
  const banCeiling = banMax(context);
  const ceiling = kind === "timeout" ? timeoutMax(context) : banCeiling;
  const presets = presetsWithin(kind === "timeout" ? TIMEOUT_PRESETS : BAN_PRESETS, ceiling);
  const what = kind === "timeout" ? "timeout" : "ban";
  // A timeout on someone already timed out replaces the running one, so it opens with no length picked.
  const changing = kind === "timeout" && member.timedOut;

  const [reason, setReason] = useState("");
  // Messages picked in the message log wait in session storage until this form opens.
  const [seed] = useState(() => readAttach(guildId, userId));
  const [evidence, setEvidence] = useState<EvidenceRef[]>(() => {
    const picked = seed.map((m) => ({ channelId: m.channelId, messageId: m.id }));
    return [...picked, ...(startEvidence ?? []).filter((ref) => !picked.some((entry) => entry.messageId === ref.messageId))];
  });
  // What the form opened with is not an edit, so only a change from it counts as unsaved.
  const [startCount] = useState(evidence.length);
  const originId = startEvidence?.[0]?.messageId ?? null;
  const [duration, setDuration] = useState<DurationDraft>(() =>
    changing
      ? unchosenDuration()
      : initialDuration(presets, kind === "timeout" ? context.defaultTimeoutMs : BAN_START_MS, Math.max(ceiling, 1)),
  );
  const [banLength, setBanLength] = useState<BanLength>("permanent");
  const [deleteDays, setDeleteDays] = useState(() => clampDeleteDays(context.deleteMessageDays));
  // Starts where the server's setting says, and stays the moderator's to change.
  const [deleteMessages, setDeleteMessages] = useState(context.deleteMessagesByDefault === true);
  // When the chosen length is counted from. It moves only when the reader
  // changes the length, so the end time, which is read out as it changes,
  // does not tick over by itself every minute while the dialog is open.
  const [anchor, setAnchor] = useState(() => new Date());
  const [errors, setErrors] = useState<DraftErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const form = useRef<HTMLFormElement>(null);

  const reasonPresets = context.reasonPresets ?? [];
  const [presetPick, setPresetPick] = useState("");
  const [presetNote, setPresetNote] = useState<string | null>(null);
  const presetId = useId();
  const presetNoteId = useId();

  function pickPreset(next: string) {
    if (busy) return;
    setPresetPick(next);
    const preset = next === "" ? undefined : reasonPresets[Number(next)];
    if (!preset) {
      setPresetNote(null);
      return;
    }
    const applied = applyPreset(preset, kind, { timeoutMax: timeoutMax(context), banMax: banCeiling, presets });
    setReason(applied.reason);
    clearError("reason");
    if (applied.banLength) setBanLength(applied.banLength);
    if (applied.duration) {
      setDuration(applied.duration);
      setAnchor(new Date());
      clearError("duration");
    }
    setPresetNote(
      applied.clampedTo !== null && preset.durationMs !== null
        ? clampedPresetText(preset.durationMs, applied.clampedTo, kind === "timeout" ? "timeout" : "ban")
        : null,
    );
  }

  const reasonId = useId();
  const reasonHintId = useId();
  const reasonErrorId = useId();
  const errorId = useId();
  const deleteId = useId();
  const deleteNoteId = useId();

  // A typed reason or picked messages are lost by leaving the page, so leaving asks first.
  const guard = useUnsavedGuard({ dirty: !busy && (reason.trim() !== "" || evidence.length !== startCount), onDiscard: () => setReason("") });

  const heavy = isHeavy(kind);
  const timed = usesDuration({ kind, banLength });
  const lengthMs = timed ? draftMs(duration) : null;
  const lengthOk = lengthMs !== null && durationProblem(duration, ceiling, what) === null;
  const newEnd = timed && lengthOk ? endsAt(lengthMs, anchor) : null;
  const until = newEnd ? formatDateTime(newEnd, timeZone) : null;
  const current = changing && member.timeoutUntil ? formatDateTime(member.timeoutUntil, timeZone) : null;
  const canDelete = offersDeletion(kind, evidence.length);
  const deleteText = deletionChoiceText(evidence.length);
  const lines = consequences({ kind, dmOnAction: context.dmOnAction, messageCount: context.dmIncludeMessages && kind !== "timeout-clear" && kind !== "unban" ? evidence.length : 0, deleteCount: canDelete && deleteMessages ? evidence.length : 0, banLength, deleteDays, until, replacing: current });
  const sooner = current ? earlierEndWarning(member.timeoutUntil, newEnd, current) : null;

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
    const check = buildRequest({ kind, reason, duration, banLength, deleteDays, evidence, deleteMessages }, context);
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
    if (outcome) {
      clearAttach(guildId, userId);
      onDone(outcome);
    }
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
      {guard.host}
      <div className="pf-dialog-body">
        {kind === "timeout-clear" && member.timeoutUntil ? (
          <p className="ta-intro">
            Their timeout was due to run until{" "}
            <time dateTime={member.timeoutUntil}>{formatDateTime(member.timeoutUntil, timeZone)}</time>.
          </p>
        ) : null}

        {changing && member.timeoutUntil ? (
          <p className="ta-intro">
            Timed out now until <strong><time dateTime={member.timeoutUntil}>{current}</time></strong>. Pick a new length,
            counted from now. It replaces the current one.
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
            <label className="pf-field-label" id={`${deleteId}-label`} htmlFor={deleteId}>
              Delete their recent messages
            </label>
            <Select
              id={deleteId}
              className="ta-select"
              aria-labelledby={`${deleteId}-label`}
              value={String(deleteDays)}
              options={DELETE_DAY_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))}
              onChange={(next) => !busy && setDeleteDays(clampDeleteDays(Number(next)))}
            />
          </div>
        ) : null}

        {reasonPresets.length > 0 ? (
          <div className="pf-field">
            <label className="pf-field-label" id={`${presetId}-label`} htmlFor={presetId}>
              Preset
            </label>
            <Select
              id={presetId}
              className="ta-select"
              aria-labelledby={`${presetId}-label`}
              aria-describedby={presetNote ? presetNoteId : undefined}
              value={presetPick}
              options={[
                { value: "", label: "None" },
                ...reasonPresets.map((preset, index) => ({
                  value: String(index),
                  label: preset.name,
                  description: presetDescription(preset, kind),
                })),
              ]}
              onChange={pickPreset}
            />
            {presetNote ? (
              <p className="pf-field-hint" id={presetNoteId} role="status">
                {presetNote}
              </p>
            ) : null}
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
              ? evidence.length > 0 && context.dmIncludeMessages && kind !== "timeout-clear" && kind !== "unban"
                ? "Saved on their record and sent to them in a direct message, with the messages you attached."
                : "Saved on their record and included in the direct message they get."
              : "Saved on their record for staff to read."}
          </p>
        </div>

        {kind !== "timeout-clear" && kind !== "unban" ? (
          <EvidencePicker guildId={guildId} userId={userId} selected={evidence} onChange={setEvidence} disabled={busy} seed={seed} />
        ) : null}

        {canDelete ? (
          <div className="pf-field">
            <div className="ta-delete">
              <Switch
                checked={deleteMessages}
                disabled={busy}
                onChange={setDeleteMessages}
                aria-labelledby={`${deleteNoteId}-label`}
                aria-describedby={deleteNoteId}
              />
              <span className="pf-field-label ta-delete-label" id={`${deleteNoteId}-label`}>
                {deleteText.label}
              </span>
            </div>
            <p className="pf-field-hint" id={deleteNoteId}>
              {deleteText.note}
            </p>
          </div>
        ) : null}

        <div className="ta-summary" data-tone={heavy ? "danger" : undefined} id={descriptionId}>
          <p className="ta-summary-title">{heavy ? "Before you confirm" : "What happens"}</p>
          <ul className="ta-summary-list">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {sooner ? (
            <p className="ta-sooner" role="status">
              <AlertIcon />
              {sooner}
            </p>
          ) : null}
        </div>

        {serverError ? (
          <p className="pf-dialog-error" role="alert" id={errorId}>
            {serverError}
          </p>
        ) : null}

        {serverError && originLink && originId && /message/i.test(serverError) && evidence.some((ref) => ref.messageId === originId) ? (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setEvidence((current) => current.filter((ref) => ref.messageId !== originId));
              setReason((current) => reasonWithMessageLink(current, originLink, ACTION_REASON_LIMIT));
              setServerError(null);
            }}
          >
            Put the message link in the reason instead of a copy
          </button>
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
          {busy ? busyLabel(kind, changing) : confirmLabel(kind, name, changing)}
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
        {presets.map((preset, index) => {
          const checked = value.choice === preset.ms;
          // With nothing picked yet, focus starts on the first choice instead of on none.
          const focusHere = checked || (value.choice === null && index === 0);
          return (
            <label key={preset.ms} className="ta-chip" data-checked={checked ? "true" : undefined}>
              <input
                type="radio"
                name={group}
                className="ta-chip-input"
                checked={checked}
                onChange={() => pick(preset.ms)}
                {...(focusHere && autoFocus ? { "data-autofocus": true } : {})}
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
          <Select
            className="ta-unit"
            aria-label="Unit"
            value={value.unit}
            options={UNIT_OPTIONS}
            onChange={(next) => !busy && onChange({ ...value, unit: next as DurationUnit })}
          />
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
