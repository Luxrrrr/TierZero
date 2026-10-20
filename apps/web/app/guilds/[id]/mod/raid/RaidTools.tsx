"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RaidStatusDto } from "@tier0/shared-moderation";
import { AlertIcon, BellIcon, LockIcon, UndoIcon } from "../../../../../components/Icons";
import { Select } from "../../../../../components/form/Select";
import { useToast } from "../../../../../components/Toaster";
import { LocalTime, Pill, RelativeTime, displayName } from "../../../../../components/mod/ModUi";
import {
  LOCK_LENGTHS,
  groupChannels,
  lockAllTargets,
  lockBody,
  lockConfirmText,
  readLockResult,
} from "../../../../../lib/mod-raid";
import { useUnsavedGuard } from "../../../../../lib/unsaved-guard";
import { CharacterCount } from "../members/[userId]/CharacterCount";
import { DialogShell } from "../members/[userId]/Dialog";
import { MassAction } from "./MassAction";

const LOCK_REASON_LIMIT = 500;

interface Props {
  guildId: string;
  initial: RaidStatusDto;
  canMass: boolean;
  canConfigure: boolean;
}

function errorText(data: unknown, fallback: string): string {
  const detail = data && typeof data === "object" && "error" in data ? (data as { error: unknown }).error : null;
  return typeof detail === "string" && detail.trim() !== "" ? detail.trim() : fallback;
}

export function RaidTools({ guildId, initial, canMass, canConfigure }: Props) {
  const [status, setStatus] = useState(initial);
  return (
    <>
      <Lockdown guildId={guildId} status={status} onStatus={setStatus} canConfigure={canConfigure} />
      <JoinAlert guildId={guildId} status={status} canConfigure={canConfigure} />
      {canMass ? <MassAction guildId={guildId} moduleEnabled={status.moduleEnabled} /> : null}
    </>
  );
}

/* Lockdown ---------------------------------------------------------------------------- */

type LockRequest = { channels: "all" | string[]; count: number };

function Lockdown({
  guildId,
  status,
  onStatus,
  canConfigure,
}: {
  guildId: string;
  status: RaidStatusDto;
  onStatus(next: RaidStatusDto): void;
  canConfigure: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [length, setLength] = useState("none");
  const [chosen, setChosen] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [confirm, setConfirm] = useState<LockRequest | null>(null);
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ what: "lock" | "unlock"; lines: string[] } | null>(null);
  const reasonId = useId();
  const lengthId = useId();
  const pickerId = useId();
  const buttonsRef = useRef<HTMLDivElement>(null);

  const guard = useUnsavedGuard({ dirty: reason.trim() !== "", onDiscard: () => setReason("") });

  const blocked = !status.moduleEnabled || !status.canManageChannels;
  const allTargets = lockAllTargets(status.channels);
  const choosable = status.channels.filter((channel) => !channel.locked);
  const chosenNow = chosen.filter((id) => choosable.some((channel) => channel.id === id));

  function apply(data: unknown, key: "locked" | "unlocked") {
    const result = readLockResult(data, key);
    if (result.status) onStatus(result.status);
    else router.refresh();
    setFailed(result.failed.length > 0 ? { what: key === "locked" ? "lock" : "unlock", lines: result.failed } : null);
    return result;
  }

  async function lock(request: LockRequest): Promise<string | null> {
    try {
      const res = await fetch(`/api/guilds/${guildId}/mod/raid/lock`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(lockBody(request.channels, reason, length)),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) return errorText(data, `Nothing was locked. The server answered ${res.status}. Try again.`);
      const result = apply(data, "locked");
      toast.push({
        kind: result.failed.length > 0 && result.changed === 0 ? "error" : "success",
        title: `Locked ${result.changed} ${result.changed === 1 ? "channel" : "channels"}`,
        ...(result.failed.length > 0 ? { detail: `${result.failed.length} could not be locked. The list is on the page.` } : {}),
      });
      setReason("");
      setChosen([]);
      setPicking(false);
      return null;
    } catch {
      return "The dashboard could not be reached. Check your connection and try again.";
    }
  }

  async function unlock(channels: "all" | string[], key: string) {
    if (unlocking) return;
    setUnlocking(key);
    try {
      const res = await fetch(`/api/guilds/${guildId}/mod/raid/unlock`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channels }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        toast.push({ kind: "error", title: "Nothing was unlocked", detail: errorText(data, `The server answered ${res.status}. Try again.`) });
        return;
      }
      const result = apply(data, "unlocked");
      toast.push({ kind: "success", title: `Unlocked ${result.changed} ${result.changed === 1 ? "channel" : "channels"}` });
    } catch {
      toast.push({ kind: "error", title: "Nothing was unlocked", detail: "The dashboard could not be reached. Check your connection and try again." });
    } finally {
      setUnlocking(null);
    }
  }

  const lockedCount = status.locked.length;

  return (
    <section className="mod-section raid-section" aria-labelledby="raid-lock-title">
      {guard.host}
      <div className="mod-section-head">
        <div className="mod-section-text">
          <h2 className="mod-section-title" id="raid-lock-title">
            Lockdown
          </h2>
          <p className="mod-section-desc">
            Stops members sending messages in the channels you pick, so a raid has nowhere to post. Staff who can manage the
            channels can still talk there.
          </p>
        </div>
      </div>

      {!status.moduleEnabled ? (
        <div className="callout callout-attention">
          <AlertIcon />
          <div>
            <strong>Moderation is turned off for this server, so nothing can be locked.</strong>{" "}
            {canConfigure ? (
              <>
                Turn it on in the <Link href={`/guilds/${guildId}/mod/settings`}>Moderation settings</Link>.
              </>
            ) : (
              "Ask someone who manages this server's settings to turn it on."
            )}
          </div>
        </div>
      ) : !status.canManageChannels ? (
        <div className="callout callout-error">
          <AlertIcon />
          <div>
            <strong>The bot cannot change channel permissions.</strong> Give its role the Manage Channels permission in
            Discord&apos;s server settings, then reload this page. Until then nothing can be locked or unlocked.
          </div>
        </div>
      ) : null}

      <div className="mod-card raid-card">
        <div className="raid-status" role="status">
          <span className="raid-status-icon" data-locked={lockedCount > 0 ? "true" : undefined} aria-hidden="true">
            <LockIcon />
          </span>
          <p className="raid-status-text">
            {lockedCount === 0 ? "No channels locked" : `${lockedCount} ${lockedCount === 1 ? "channel" : "channels"} locked`}
          </p>
          {lockedCount > 0 ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              aria-disabled={!status.canManageChannels || unlocking !== null || undefined}
              onClick={() => status.canManageChannels && void unlock("all", "all")}
            >
              <UndoIcon />
              {unlocking === "all" ? "Unlocking…" : "Unlock all"}
            </button>
          ) : null}
        </div>

        {lockedCount > 0 ? (
          <div className="mod-table-wrap">
            <table className="mod-table raid-locked">
              <caption className="visually-hidden">Locked channels</caption>
              <thead>
                <tr>
                  <th scope="col">Channel</th>
                  <th scope="col">Locked</th>
                  <th scope="col">By</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Ends</th>
                  <th scope="col">
                    <span className="visually-hidden">Unlock</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {status.locked.map((entry) => {
                  const voice = status.channels.find((channel) => channel.id === entry.channelId)?.voice === true;
                  const name = entry.name ? (voice ? entry.name : `#${entry.name}`) : "Deleted channel";
                  return (
                    <tr key={entry.channelId}>
                      <td data-label="Channel" className="raid-channel">
                        {name}
                      </td>
                      <td data-label="Locked">
                        <RelativeTime iso={entry.lockedAt} />
                      </td>
                      <td data-label="By">{displayName(entry.lockedBy)}</td>
                      <td data-label="Reason" className="raid-reason">
                        {entry.reason ?? <span className="raid-dim">No reason given</span>}
                      </td>
                      <td data-label="Ends">{entry.endsAt ? <LocalTime iso={entry.endsAt} /> : <span className="raid-dim">Until unlocked</span>}</td>
                      <td className="raid-row-action">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          aria-label={`Unlock ${name}`}
                          aria-disabled={!status.canManageChannels || unlocking !== null || undefined}
                          onClick={() => status.canManageChannels && void unlock([entry.channelId], entry.channelId)}
                        >
                          {unlocking === entry.channelId ? "Unlocking…" : "Unlock"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {failed ? (
          <div className="callout callout-error raid-failed" role="alert">
            <AlertIcon />
            <div>
              <strong>{failed.lines.length === 1 ? "One channel" : `${failed.lines.length} channels`} could not be {failed.what === "lock" ? "locked" : "unlocked"}.</strong>
              <ul>
                {failed.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        <div className="raid-lock-form">
          <div className="raid-lock-fields">
            <div className="pf-field raid-grow">
              <div className="pf-field-row">
                <label className="pf-field-label" htmlFor={reasonId}>
                  Reason <span className="ta-tag">Optional</span>
                </label>
                <CharacterCount length={reason.length} limit={LOCK_REASON_LIMIT} />
              </div>
              <input
                id={reasonId}
                className="input"
                value={reason}
                maxLength={LOCK_REASON_LIMIT}
                placeholder="Spam raid in #lfg"
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <div className="pf-field">
              <label className="pf-field-label" id={`${lengthId}-label`} htmlFor={lengthId}>
                Length
              </label>
              <Select
                id={lengthId}
                className="raid-length"
                aria-labelledby={`${lengthId}-label`}
                value={length}
                options={LOCK_LENGTHS.map((entry) => ({ value: entry.value, label: entry.label }))}
                onChange={setLength}
              />
            </div>
          </div>

          <div className="raid-lock-buttons" ref={buttonsRef}>
            <button
              type="button"
              className="btn btn-danger"
              aria-disabled={blocked || allTargets.length === 0 || undefined}
              onClick={() => {
                if (!blocked && allTargets.length > 0) setConfirm({ channels: "all", count: allTargets.length });
              }}
            >
              <LockIcon />
              Lock all channels
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              aria-expanded={picking}
              aria-controls={picking ? pickerId : undefined}
              aria-disabled={blocked || choosable.length === 0 || undefined}
              onClick={() => {
                if (!blocked && choosable.length > 0) setPicking((open) => !open);
              }}
            >
              Lock chosen channels
            </button>
            <span className="raid-hint">
              {allTargets.length === 0
                ? "Every channel is locked or exempt already."
                : `Lock all covers ${allTargets.length} ${allTargets.length === 1 ? "channel" : "channels"}${status.channels.some((channel) => channel.exempt) ? ", leaving out exempt ones" : ""}.`}
            </span>
          </div>

          {picking ? (
            <fieldset className="raid-picker" id={pickerId}>
              <legend className="pf-field-label">Channels to lock</legend>
              {groupChannels(status.channels).map((group) => (
                <div key={group.parent ?? "none"} className="raid-picker-group">
                  <p className="raid-picker-parent">{group.parent ?? "No category"}</p>
                  <ul>
                    {group.channels.map((channel) => (
                      <li key={channel.id}>
                        <label className="raid-pick" data-disabled={channel.locked ? "true" : undefined}>
                          <input
                            type="checkbox"
                            checked={channel.locked || chosen.includes(channel.id)}
                            disabled={channel.locked}
                            onChange={() =>
                              setChosen((current) =>
                                current.includes(channel.id) ? current.filter((id) => id !== channel.id) : [...current, channel.id],
                              )
                            }
                          />
                          <span>{channel.voice ? channel.name : `#${channel.name}`}</span>
                          {channel.locked ? <Pill tone="danger">Locked</Pill> : null}
                          {channel.exempt ? (
                            <span className="raid-exempt" title="Left out of Lock all by the Moderation settings">
                              Exempt from Lock all
                            </span>
                          ) : null}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="raid-picker-foot">
                <span role="status">{chosenNow.length === 0 ? "No channels chosen" : `${chosenNow.length} chosen`}</span>
                {chosenNow.length > 0 ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChosen([])}>
                    Clear
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  aria-disabled={blocked || chosenNow.length === 0 || undefined}
                  onClick={() => {
                    if (!blocked && chosenNow.length > 0) setConfirm({ channels: chosenNow, count: chosenNow.length });
                  }}
                >
                  <LockIcon />
                  {chosenNow.length === 0 ? "Lock chosen channels" : `Lock ${chosenNow.length} ${chosenNow.length === 1 ? "channel" : "channels"}`}
                </button>
              </div>
            </fieldset>
          ) : null}
        </div>
      </div>

      {confirm ? (
        <LockDialog
          request={confirm}
          length={length}
          reason={reason}
          fallbackFocus={() => buttonsRef.current?.querySelector<HTMLElement>("button") ?? null}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const problem = await lock(confirm);
            if (problem === null) setConfirm(null);
            return problem;
          }}
        />
      ) : null}
    </section>
  );
}

function LockDialog({
  request,
  length,
  reason,
  fallbackFocus,
  onClose,
  onConfirm,
}: {
  request: LockRequest;
  length: string;
  reason: string;
  fallbackFocus(): HTMLElement | null;
  onClose(): void;
  /** Null when it worked, otherwise the sentence to show. */
  onConfirm(): Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyId = useId();
  const where = `${request.count} ${request.count === 1 ? "channel" : "channels"}`;

  return (
    <DialogShell
      title={request.channels === "all" ? `Lock all ${where}?` : `Lock ${where}?`}
      icon={<LockIcon />}
      tone="danger"
      descriptionId={bodyId}
      onClose={onClose}
      locked={busy}
      fallbackFocus={fallbackFocus}
    >
      <div className="pf-dialog-body">
        <div className="pf-dialog-text" id={bodyId}>
          <p>{lockConfirmText(request.count, length)}</p>
          {reason.trim() !== "" ? <p>Reason: {reason.trim()}</p> : null}
        </div>
        {error ? (
          <p className="pf-dialog-error" role="alert">
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
          data-autofocus
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-danger"
          aria-disabled={busy || undefined}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            setError(null);
            const problem = await onConfirm();
            setBusy(false);
            if (problem) setError(problem);
          }}
        >
          {busy ? "Locking…" : `Lock ${where}`}
        </button>
      </div>
    </DialogShell>
  );
}

/* Join-rate alert ------------------------------------------------------------------------ */

function JoinAlert({ guildId, status, canConfigure }: { guildId: string; status: RaidStatusDto; canConfigure: boolean }) {
  const alert = status.joinAlert;
  return (
    <section className="mod-section raid-section" aria-labelledby="raid-alert-title">
      <div className="mod-section-head">
        <div className="mod-section-text">
          <h2 className="mod-section-title" id="raid-alert-title">
            Join-rate alert
          </h2>
          <p className="mod-section-desc">Warns staff when many members join in a short time, which is how most raids start.</p>
        </div>
        {canConfigure ? (
          <div className="mod-section-actions">
            <Link className="btn btn-secondary btn-sm" href={`/guilds/${guildId}/mod/settings#section-raid`}>
              Change the alert
            </Link>
          </div>
        ) : null}
      </div>
      <div className="mod-card raid-card">
        <dl className="raid-alert">
          <div>
            <dt>Alert</dt>
            <dd>
              <Pill tone={alert.enabled ? "ok" : "neutral"}>{alert.enabled ? "On" : "Off"}</Pill>
            </dd>
          </div>
          <div>
            <dt>Goes off at</dt>
            <dd>
              {alert.joins} {alert.joins === 1 ? "join" : "joins"} in {alert.seconds} {alert.seconds === 1 ? "second" : "seconds"}
            </dd>
          </div>
          <div>
            <dt>When it goes off</dt>
            <dd>{alert.lockdown ? "Locks every channel that is not exempt" : "Only alerts staff"}</dd>
          </div>
          <div>
            <dt>Joined in the last 10 minutes</dt>
            <dd>
              <BellIcon />
              <span className="raid-joins">{status.recentJoins.toLocaleString("en")}</span>
            </dd>
          </div>
        </dl>
        <p className="raid-foot">The join count starts again from zero whenever the bot restarts.</p>
      </div>
    </section>
  );
}
