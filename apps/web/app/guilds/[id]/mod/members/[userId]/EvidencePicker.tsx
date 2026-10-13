"use client";

import { useEffect, useId, useRef, useState } from "react";
import { EVIDENCE_LIMITS, evidenceRefFromLink, type EvidenceMessage, type EvidenceRef } from "@tier0/core";
import { Select } from "../../../../../../components/form/Select";
import { When } from "../../../../../../components/mod/ModUi";
import { DeletedTag, Versions, versionLabel } from "../../../../../../components/mod/Evidence";

interface Props {
  guildId: string;
  userId: string;
  selected: EvidenceRef[];
  onChange(next: EvidenceRef[]): void;
  disabled: boolean;
  /** Messages already chosen elsewhere, such as in the message log, shown even when they are not among the latest. */
  seed?: EvidenceMessage[];
  /** The heading of the section. */
  title?: string;
}

type Load = { status: "idle" } | { status: "loading" } | { status: "ready"; messages: EvidenceMessage[] } | { status: "error"; message: string };

/**
 * Lets a moderator pick messages from the member to keep with the action. The
 * list is what the bot remembers of the member's latest messages in channels
 * this moderator can read, deleted ones included. A message the bot did not
 * see, such as an older one, can be added by pasting its link.
 */
export function EvidencePicker({ guildId, userId, selected, onChange, disabled, seed = [], title = "Attach messages" }: Props) {
  const [open, setOpen] = useState(selected.length > 0);
  const [load, setLoad] = useState<Load>({ status: "idle" });
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const id = useId();
  // Set once the first load starts. Keying the effect on the load state instead would cancel the request it just made.
  const started = useRef(false);

  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    setLoad({ status: "loading" });
    let cancelled = false;
    fetch(`/api/guilds/${guildId}/mod/members/${encodeURIComponent(userId)}/messages`)
      .then(async (res) => {
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const detail = data && typeof data === "object" && "error" in data ? (data as { error: unknown }).error : null;
          throw new Error(typeof detail === "string" ? detail : "Their messages could not be loaded.");
        }
        const messages = data && typeof data === "object" && "messages" in data ? (data as { messages: EvidenceMessage[] }).messages : [];
        if (!cancelled) setLoad({ status: "ready", messages });
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoad({ status: "error", message: error instanceof Error ? error.message : "Their messages could not be loaded." });
      });
    return () => {
      cancelled = true;
      started.current = false;
    };
  }, [open, guildId, userId]);

  const isPicked = (messageId: string) => selected.some((ref) => ref.messageId === messageId);
  const full = selected.length >= EVIDENCE_LIMITS.messages;

  function toggle(message: EvidenceMessage) {
    if (isPicked(message.id)) onChange(selected.filter((ref) => ref.messageId !== message.id));
    else if (!full) onChange([...selected, { channelId: message.channelId, messageId: message.id }]);
  }

  function chooseVersion(messageId: string, value: string) {
    const version = Number(value);
    onChange(
      selected.map((ref) => {
        if (ref.messageId !== messageId) return ref;
        const { version: _dropped, ...rest } = ref;
        return Number.isInteger(version) ? { ...rest, version } : rest;
      }),
    );
  }

  function addLink() {
    const ref = evidenceRefFromLink(link);
    if (!ref) {
      setLinkError("That doesn't look like a link to a Discord message. In Discord, right-click a message and choose Copy Message Link.");
      return;
    }
    if (isPicked(ref.messageId)) {
      setLink("");
      setLinkError(null);
      return;
    }
    if (full) {
      setLinkError(`You can attach at most ${EVIDENCE_LIMITS.messages} messages.`);
      return;
    }
    onChange([...selected, ref]);
    setLink("");
    setLinkError(null);
  }

  const loaded = load.status === "ready" ? load.messages : [];
  // A message that is already attached is shown as it was saved, since that is what the case holds.
  const known = [...seed, ...loaded.filter((message) => !seed.some((m) => m.id === message.id))];
  const linked = selected.filter((ref) => !known.some((message) => message.id === ref.messageId));

  return (
    <div className="pf-field ev-picker">
      <button type="button" className="ev-toggle" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen(!open)}>
        <span className="pf-field-label ta-label">
          {title}
          <span className="ta-tag">Optional</span>
        </span>
        <span className="ev-count">
          {selected.length > 0 ? `${selected.length} attached` : "Choose"}
          <svg className="ev-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m4 6 4 4 4-4" />
          </svg>
        </span>
      </button>

      {open ? (
        <div className="ev-panel" id={`${id}-panel`}>
          <p className="pf-field-hint">
            They are copied into the case as they read now, so they stay readable if the member edits or deletes them.
          </p>

          {load.status === "loading" ? <p className="ev-note">Loading their latest messages…</p> : null}
          {load.status === "error" ? (
            <p className="pf-field-error" role="alert">
              {load.message}
            </p>
          ) : null}
          {load.status === "ready" && known.length === 0 ? (
            <p className="ev-note">
              The bot has no recent messages from them in channels you can read. It keeps what it sees while Moderation is on, in memory, for three
              days. Paste a link below to attach an older one.
            </p>
          ) : null}

          {known.length > 0 ? (
            <ul className="ev-choices" aria-label="Their latest messages">
              {known.map((message) => (
                <li key={message.id} className="ev-choice-item" data-checked={isPicked(message.id) ? "true" : undefined}>
                  <label className="ev-choice">
                    <input
                      type="checkbox"
                      checked={isPicked(message.id)}
                      disabled={disabled || (!isPicked(message.id) && full)}
                      onChange={() => toggle(message)}
                    />
                    <span className="ev-choice-body">
                      <span className="ev-head">
                        <span className="ev-channel">#{message.channelName || "unknown"}</span>
                        <When iso={message.createdAt} />
                        {message.deleted ? <DeletedTag deletedAt={message.deletedAt} /> : null}
                      </span>
                      <span className="ev-choice-text" data-deleted={message.deleted ? "true" : undefined}>{message.content !== "" ? message.content : message.attachments.length > 0 ? `${message.attachments.length} attachment${message.attachments.length === 1 ? "" : "s"}` : "No text"}</span>
                    </span>
                  </label>
                  {isPicked(message.id) && message.versions && message.versions.length > 1 ? (
                    <div className="ev-which">
                      <label id={`${id}-v-${message.id}-label`} htmlFor={`${id}-v-${message.id}`}>Which version broke the rules?</label>
                      <Select
                        id={`${id}-v-${message.id}`}
                        size="sm"
                        disabled={disabled}
                        aria-labelledby={`${id}-v-${message.id}-label`}
                        value={String(selected.find((ref) => ref.messageId === message.id)?.version ?? message.versions.length - 1)}
                        options={message.versions.map((version, index) => ({
                          value: String(index),
                          label: `${versionLabel(index, message.versions!.length)}: ${version.content.slice(0, 50) || "No text"}${version.content.length > 50 ? "…" : ""}`,
                        }))}
                        onChange={(next) => chooseVersion(message.id, next)}
                      />
                    </div>
                  ) : null}
                  <Versions versions={message.versions} />
                </li>
              ))}
            </ul>
          ) : null}

          <div className="ev-link">
            <label className="pf-field-label" htmlFor={`${id}-link`}>
              Or paste a message link
            </label>
            <div className="ev-link-row">
              <input
                id={`${id}-link`}
                className="input"
                placeholder="https://discord.com/channels/…"
                value={link}
                disabled={disabled}
                onChange={(event) => {
                  setLink(event.target.value);
                  setLinkError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  // Enter here adds the link. It must not submit the action.
                  event.preventDefault();
                  event.stopPropagation();
                  addLink();
                }}
              />
              <button type="button" className="btn btn-secondary btn-sm" disabled={disabled || link.trim() === ""} onClick={addLink}>
                Add
              </button>
            </div>
            {linkError ? (
              <p className="pf-field-error" role="alert">
                {linkError}
              </p>
            ) : null}
          </div>

          {linked.length > 0 ? (
            <ul className="ev-linked" aria-label="Messages added by link">
              {linked.map((ref) => (
                <li key={ref.messageId}>
                  <span>Message …{ref.messageId.slice(-6)}</span>
                  <button type="button" className="link-button" onClick={() => onChange(selected.filter((r) => r.messageId !== ref.messageId))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
