"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { MessageBody, VariableValues } from "@tier0/core";
import { ChannelPicker, Switch, useChannels } from "../form";
import { MessagePreview, type PreviewContext } from "./MessagePreview";

interface Props {
  guildId: string;
  message: MessageBody;
  templateId: number | null;
  context: Omit<PreviewContext, "variables"> & { variables: VariableValues };
  onClose(): void;
  onSent(): void;
}

type Result =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; url: string; warnings: string[] }
  | { kind: "error"; message: string };

const TOGGLES: { key: "silent" | "suppressEmbeds" | "tts" | "pin" | "publish" | "allowEveryone"; label: string; hint: string }[] = [
  { key: "silent", label: "Send silently", hint: "Nobody gets a notification for it." },
  { key: "pin", label: "Pin it", hint: "Needs Manage Messages. A channel holds up to 50 pins." },
  { key: "publish", label: "Publish to followers", hint: "Only does anything in an announcement channel." },
  { key: "suppressEmbeds", label: "Hide link previews", hint: "Stops Discord turning links in the text into previews." },
  { key: "tts", label: "Read it out loud", hint: "Text to speech, for members who have it switched on." },
  { key: "allowEveryone", label: "Let @everyone and @here ping", hint: "Off unless you turn it on for this send." },
];

/**
 * Sending is the one step that cannot be taken back from here, so it gets its
 * own confirmation: the channel is named on the button, and the message is
 * shown once more as it will appear in that channel.
 */
export function SendDialog({ guildId, message, templateId, context, onClose, onSent }: Props) {
  const [channelId, setChannelId] = useState<string | undefined>(undefined);
  const [options, setOptions] = useState({ silent: false, suppressEmbeds: false, tts: false, pin: false, publish: false, allowEveryone: false });
  const [threadName, setThreadName] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [asName, setAsName] = useState("");
  const [asAvatarUrl, setAsAvatarUrl] = useState("");
  const [result, setResult] = useState<Result>({ kind: "idle" });
  const titleId = useId();
  const pickerId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const { channels } = useChannels(guildId);
  const channel = channels.find((c) => c.id === channelId);

  // The channel it is going to is known here, so the variables that name it can be shown properly.
  const variables = useMemo(
    () => ({ ...context.variables, ...(channel ? { channel: `#${channel.name}`, "channel.name": channel.name } : {}) }),
    [context.variables, channel],
  );

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function send() {
    if (!channelId) return;
    setResult({ kind: "sending" });
    try {
      const res = await fetch(`/api/guilds/${guildId}/messages/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...message, ...options, channelId, threadName, replyTo, asName, asAvatarUrl, templateId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; url?: string; warnings?: string[] };
      if (!res.ok) {
        setResult({ kind: "error", message: data.error ?? "The message could not be sent." });
        return;
      }
      setResult({ kind: "sent", url: data.url ?? "", warnings: data.warnings ?? [] });
      onSent();
    } catch {
      setResult({ kind: "error", message: "The dashboard could not reach the bot. Check that it is running, then try again." });
    }
  }

  return (
    <div className="sheet-layer">
      <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="msg-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="msg-dialog-head">
          <h2 id={titleId} className="msg-dialog-title">
            Send this message
          </h2>
          <button type="button" ref={closeRef} className="sheet-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="msg-dialog-body">
          <div className="field">
            <label className="field-label" htmlFor={pickerId}>
              Channel
            </label>
            <ChannelPicker id={pickerId} guildId={guildId} value={channelId} onChange={setChannelId} />
          </div>

          <MessagePreview message={message} context={{ ...context, variables }} />

          <fieldset className="send-options">
            <legend className="field-label">Options</legend>
            {TOGGLES.map((toggle) => (
              <div className="send-option" key={toggle.key}>
                <Switch checked={options[toggle.key]} onChange={(next) => setOptions({ ...options, [toggle.key]: next })} aria-label={toggle.label} />
                <span>
                  {toggle.label}
                  <small>{toggle.hint}</small>
                </span>
              </div>
            ))}
            <div className="embed-grid">
              <div className="field">
                <label className="field-label" htmlFor={`${pickerId}-thread`}>
                  Start a thread
                </label>
                <input id={`${pickerId}-thread`} className="input" placeholder="Thread name, or leave empty" maxLength={100} value={threadName} onChange={(event) => setThreadName(event.target.value)} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`${pickerId}-reply`}>
                  Reply to a message
                </label>
                <input id={`${pickerId}-reply`} className="input" placeholder="Message ID or link" value={replyTo} onChange={(event) => setReplyTo(event.target.value)} />
              </div>
            </div>
            <div className="embed-grid">
              <div className="field">
                <label className="field-label" htmlFor={`${pickerId}-as`}>
                  Send as
                </label>
                <input id={`${pickerId}-as`} className="input" placeholder="A name, or leave empty to send as the bot" maxLength={80} value={asName} onChange={(event) => setAsName(event.target.value)} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`${pickerId}-avatar`}>
                  Picture for that name
                </label>
                <input id={`${pickerId}-avatar`} className="input" placeholder="https://" disabled={asName.trim() === ""} value={asAvatarUrl} onChange={(event) => setAsAvatarUrl(event.target.value)} />
              </div>
            </div>
            <p className="field-hint">Sending under another name goes through a webhook, so the bot needs Manage Webhooks in that channel.</p>
          </fieldset>

          {result.kind === "error" ? (
            <p className="field-error" role="alert">
              {result.message}
            </p>
          ) : null}
          {result.kind === "sent" ? (
            <div className="msg-sent" role="status">
              <p>
                Sent.{" "}
                {result.url ? (
                  <a href={result.url} target="_blank" rel="noreferrer">
                    View it in Discord
                  </a>
                ) : null}
              </p>
              {result.warnings.length > 0 ? (
                <ul className="msg-warnings">
                  {result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="msg-dialog-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {result.kind === "sent" ? "Done" : "Cancel"}
          </button>
          <button type="button" className="btn btn-primary" disabled={!channelId || result.kind === "sending"} onClick={() => void send()}>
            {result.kind === "sending" ? "Sending…" : result.kind === "sent" ? "Send again" : channel ? `Send to #${channel.name}` : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
