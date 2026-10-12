"use client";

import { useId, useRef, useState } from "react";
import type { EvidenceRef, InfractionDto } from "@tier0/core";
import { PencilIcon } from "../../../../../../components/Icons";
import { ACTION_REASON_LIMIT, BAN_PRESETS, TIMEOUT_PRESETS } from "./actions";
import { CharacterCount } from "./CharacterCount";
import { DialogShell, type FocusFallback } from "./Dialog";
import { EvidencePicker } from "./EvidencePicker";
import { formatDateTime } from "./timeline";
import type { ModResult, Run } from "./useModAction";

interface Props {
  guildId: string;
  infraction: InfractionDto;
  now: Date;
  timeZone: string;
  run: Run;
  fallbackFocus: FocusFallback;
  onClose(): void;
}

const KEEP = "keep";
const PERMANENT = "permanent";

const refsOf = (infraction: InfractionDto): EvidenceRef[] =>
  infraction.evidence.map((message) => ({
    channelId: message.channelId,
    messageId: message.id,
    ...(message.flagged !== undefined ? { version: message.flagged } : {}),
  }));

/**
 * Edits everything about a case that can change: the reason, how long a
 * running timeout or ban lasts, and which messages are attached. What is left
 * alone is not sent, so the bot only records what actually changed.
 */
export function EditCaseDialog({ guildId, infraction, now, timeZone, run, fallbackFocus, onClose }: Props) {
  const label = `case ${infraction.caseNumber}`;
  const initialRefs = refsOf(infraction);

  const [reason, setReason] = useState(infraction.reason ?? "");
  const [length, setLength] = useState(KEEP);
  const [evidence, setEvidence] = useState<EvidenceRef[]>(initialRefs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const reasonId = useId();
  const lengthId = useId();
  const descriptionId = useId();
  const errorId = useId();

  const timed = infraction.action === "timeout" || infraction.action === "ban";
  const ends = infraction.expiresAt ? new Date(infraction.expiresAt) : null;
  // A length can only change while the timeout or ban is still running.
  const running = timed && infraction.active && (infraction.action === "ban" || (ends !== null && ends.getTime() > now.getTime()));
  const presets = infraction.action === "ban" ? BAN_PRESETS : TIMEOUT_PRESETS;
  const currentEnd = ends ? `Ends ${formatDateTime(ends.toISOString(), timeZone)}` : "Permanent";

  const trimmed = reason.trim();
  const reasonChanged = trimmed !== (infraction.reason ?? "");
  const evidenceChanged = JSON.stringify(evidence) !== JSON.stringify(initialRefs);
  const lengthChanged = running && length !== KEEP;
  const nothingChanged = !reasonChanged && !evidenceChanged && !lengthChanged;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (trimmed === "") {
      setError("A case needs a reason. Write what the member did.");
      document.getElementById(reasonId)?.focus();
      return;
    }
    if (nothingChanged) {
      setError("Nothing has changed yet.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {};
    if (reasonChanged) body.reason = trimmed;
    if (lengthChanged) body.durationMs = length === PERMANENT ? null : Number(length);
    if (evidenceChanged) body.evidence = evidence;
    let result: ModResult;
    try {
      result = await run(
        { method: "PATCH", path: `infractions/${infraction.id}`, body, success: `Updated ${label}.`, failure: "Could not edit the case", inline: true },
        null,
        "after",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
    if (result === true) onClose();
    else setError(result);
  }

  return (
    <DialogShell title={`Edit ${label}`} layout="form" icon={<PencilIcon />} tone="default" descriptionId={descriptionId} onClose={onClose} locked={busy} fallbackFocus={fallbackFocus}>
      <form className="pf-dialog-form" onSubmit={submit} noValidate>
        <div className="pf-dialog-body">
          <p className="pf-dialog-lead" id={descriptionId}>
            The case is marked as edited with your name and the time. Staff activity keeps what it said before. The post in the mod log channel and any
            direct message already sent are not changed.
          </p>

          <div className="pf-field">
            <div className="pf-field-row">
              <label className="pf-field-label" htmlFor={reasonId}>
                Reason
              </label>
              <CharacterCount length={reason.length} limit={ACTION_REASON_LIMIT} />
            </div>
            <textarea
              id={reasonId}
              className="textarea pf-textarea"
              rows={3}
              value={reason}
              maxLength={ACTION_REASON_LIMIT}
              readOnly={busy}
              onChange={(event) => {
                setReason(event.target.value);
                setError(null);
              }}
              data-autofocus
            />
          </div>

          {running ? (
            <div className="pf-field">
              <label className="pf-field-label" htmlFor={lengthId}>
                How long it lasts
              </label>
              <select id={lengthId} className="mod-select" value={length} disabled={busy} onChange={(event) => setLength(event.target.value)}>
                <option value={KEEP}>Keep it as it is ({currentEnd})</option>
                {presets.map((preset) => (
                  <option key={preset.ms} value={String(preset.ms)}>
                    {preset.label} from now
                  </option>
                ))}
                {infraction.action === "ban" ? <option value={PERMANENT}>Make it permanent</option> : null}
              </select>
              <p className="pf-field-hint">
                A new length counts from now and is applied in Discord straight away.
                {infraction.action === "timeout" ? " Discord allows timeouts of up to 28 days." : ""}
              </p>
            </div>
          ) : null}

          <EvidencePicker
            guildId={guildId}
            userId={infraction.user.userId}
            selected={evidence}
            onChange={setEvidence}
            disabled={busy}
            seed={infraction.evidence}
            title="Attached messages"
          />

          {error ? (
            <p className="pf-dialog-error" role="alert" id={errorId}>
              {error}
            </p>
          ) : null}
        </div>

        <div className="pf-dialog-actions">
          <button type="button" className="btn btn-secondary" aria-disabled={busy || undefined} onClick={() => !busy && onClose()}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined} aria-describedby={error ? errorId : undefined}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
