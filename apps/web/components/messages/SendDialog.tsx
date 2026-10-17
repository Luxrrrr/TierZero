"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { MessageBody, VariableValues } from "@tier0/core";
import { UNREACHABLE, readFailure } from "../../lib/bot-errors";
import { ChannelPicker, Switch, useChannels } from "../form";
import { MessagePreview, type PreviewContext } from "./MessagePreview";
import { fetchSends, sendLabel, type SentMessage } from "./SentList";

/** A message queued to go out later, as the bot lists it. */
export interface ScheduledSend {
  id: number;
  runAt: string;
  repeat: "once" | "daily" | "weekly";
  channelId: string;
  label: string;
  templateId: number | null;
  lastError: string | null;
}

interface Props {
  guildId: string;
  message: MessageBody;
  templateId: number | null;
  /** What a scheduled send is listed as. */
  label: string;
  context: Omit<PreviewContext, "variables"> & { variables: VariableValues };
  onClose(): void;
  onSent(): void;
  onScheduled(entry: ScheduledSend): void;
  /** Opens on "Replace a sent message" with this one picked. */
  replacing?: SentMessage | null;
}

type Mode = "now" | "later" | "replace";

type Result =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; url: string; warnings: string[]; edited: boolean }
  | { kind: "scheduled"; at: string }
  | { kind: "error"; message: string };

const TOGGLES: { key: "silent" | "suppressEmbeds" | "tts" | "pin" | "publish" | "allowEveryone"; label: string; hint: string }[] = [
  { key: "silent", label: "Send silently", hint: "Nobody gets a notification for it." },
  { key: "pin", label: "Pin it", hint: "Needs Manage Messages. A channel holds up to 50 pins." },
  { key: "publish", label: "Publish to followers", hint: "Only does anything in an announcement channel." },
  { key: "suppressEmbeds", label: "Hide link previews", hint: "Stops Discord turning links in the text into previews." },
  { key: "tts", label: "Read it out loud", hint: "Text to speech, for members who have it switched on." },
  { key: "allowEveryone", label: "Let @everyone and @here ping", hint: "Off unless you turn it on for this send." },
];

const MODES: { id: Mode; label: string }[] = [
  { id: "now", label: "Send now" },
  { id: "later", label: "Schedule" },
  { id: "replace", label: "Replace a sent message" },
];

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** The value a datetime-local input wants, in the viewer's own time. */
function localInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Sending is the one step that cannot be taken back from here, so it gets its
 * own confirmation: the channel is named on the button, and the message is
 * shown once more as it will appear in that channel. The same dialog queues a
 * message for later, or puts it in place of one the bot already sent.
 */
export function SendDialog({ guildId, message, templateId, label, context, onClose, onSent, onScheduled, replacing = null }: Props) {
  const [mode, setMode] = useState<Mode>(replacing ? "replace" : "now");
  const [channelId, setChannelId] = useState<string | undefined>(undefined);
  const [options, setOptions] = useState({ silent: false, suppressEmbeds: false, tts: false, pin: false, publish: false, allowEveryone: false });
  const [threadName, setThreadName] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [asName, setAsName] = useState("");
  const [asAvatarUrl, setAsAvatarUrl] = useState("");
  const [when, setWhen] = useState(() => localInputValue(new Date(Date.now() + 60 * 60_000)));
  const [repeat, setRepeat] = useState<ScheduledSend["repeat"]>("once");
  const [link, setLink] = useState(replacing?.url ?? "");
  const [recent, setRecent] = useState<SentMessage[] | null>(replacing ? [replacing] : null);
  const [recentError, setRecentError] = useState<string | null>(null);
  const recentAsked = useRef(false);
  const [result, setResult] = useState<Result>({ kind: "idle" });
  const titleId = useId();
  const pickerId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { channels } = useChannels(guildId);
  const channel = channels.find((c) => c.id === channelId);
  const channelName = (id: string) => channels.find((c) => c.id === id)?.name;

  // The recent sends are only needed once someone picks Replace, so they are read then and once.
  useEffect(() => {
    if (mode !== "replace" || recentAsked.current) return;
    recentAsked.current = true;
    void fetchSends(guildId, null).then((result) => {
      if (result.ok) {
        const list = result.page.sends;
        setRecent(replacing && !list.some((entry) => entry.id === replacing.id) ? [replacing, ...list] : list);
      }
      else setRecentError(result.error);
    });
  }, [mode, guildId, replacing]);

  // The channel it is going to is known here, so the variables that name it can be shown properly.
  const variables = useMemo(
    () => ({ ...context.variables, ...(channel ? { channel: `#${channel.name}`, "channel.name": channel.name } : {}) }),
    [context.variables, channel],
  );

  useEffect(() => {
    // Back to whatever opened it, so a keyboard user is not dropped at the top of the page.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Tab and Shift+Tab stay inside the dialog while the page behind it is covered.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((node) => node.offsetParent !== null);
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function post(path: string, body: Record<string, unknown>): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; message: string }> {
    try {
      const res = await fetch(`/api/guilds/${guildId}/messages/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return { ok: false, message: (await readFailure(res)).message };
      return { ok: true, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    } catch {
      return { ok: false, message: UNREACHABLE };
    }
  }

  const sendOptions = { ...options, channelId, threadName, replyTo, asName, asAvatarUrl };

  async function confirm() {
    setResult({ kind: "sending" });
    if (mode === "replace") {
      const reply = await post("edit", { ...message, link, allowEveryone: options.allowEveryone });
      if (!reply.ok) return setResult({ kind: "error", message: reply.message });
      setResult({ kind: "sent", url: String(reply.data.url ?? ""), warnings: (reply.data.warnings as string[] | undefined) ?? [], edited: true });
      return;
    }
    if (!channelId) return setResult({ kind: "idle" });
    if (mode === "later") {
      const at = new Date(when);
      if (Number.isNaN(at.getTime())) return setResult({ kind: "error", message: "Pick a date and time to send it." });
      const reply = await post("schedules", { ...message, ...sendOptions, runAt: at.toISOString(), repeat, templateId, label });
      if (!reply.ok) return setResult({ kind: "error", message: reply.message });
      onScheduled(reply.data as unknown as ScheduledSend);
      setResult({ kind: "scheduled", at: at.toISOString() });
      return;
    }
    const reply = await post("send", { ...message, ...sendOptions, templateId });
    if (!reply.ok) return setResult({ kind: "error", message: reply.message });
    setResult({ kind: "sent", url: String(reply.data.url ?? ""), warnings: (reply.data.warnings as string[] | undefined) ?? [], edited: false });
    onSent();
  }

  const done = result.kind === "sent" || result.kind === "scheduled";
  const ready = mode === "replace" ? link.trim() !== "" : Boolean(channelId);
  const confirmLabel =
    result.kind === "sending"
      ? mode === "replace"
        ? "Replacing…"
        : mode === "later"
          ? "Scheduling…"
          : "Sending…"
      : mode === "replace"
        ? "Replace it"
        : mode === "later"
          ? channel
            ? `Schedule for #${channel.name}`
            : "Schedule"
          : result.kind === "sent"
            ? "Send again"
            : channel
              ? `Send to #${channel.name}`
              : "Send";

  return (
    <div className="sheet-layer">
      <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} className="msg-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <div className="msg-dialog-head">
          <h2 id={titleId} className="msg-dialog-title">
            Send this message
          </h2>
          <button type="button" ref={closeRef} className="sheet-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="msg-dialog-body">
          <div className="cmd-chips send-modes" role="group" aria-label="How to send it">
            {MODES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="cmd-chip"
                aria-pressed={mode === entry.id}
                onClick={() => {
                  setMode(entry.id);
                  setResult({ kind: "idle" });
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {mode === "replace" ? (
            <>
            <div className="field">
              <label className="field-label" htmlFor={`${pickerId}-recent`}>
                Sent from here
              </label>
              <select
                id={`${pickerId}-recent`}
                className="input"
                value={recent?.find((entry) => entry.url === link)?.url ?? ""}
                onChange={(event) => setLink(event.target.value)}
              >
                <option value="">{recent === null ? "Loading…" : recent.length === 0 ? "Nothing sent from the Message creator yet" : "Pick a message, or paste a link below"}</option>
                {(recent ?? []).map((entry) => (
                  <option key={entry.id} value={entry.url}>
                    {(entry.templateName ?? "Not from a template") + " · " + sendLabel(entry, channelName)}
                  </option>
                ))}
              </select>
              {recentError ? <p className="field-hint">The list of sent messages could not be read: {recentError}</p> : null}
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${pickerId}-link`}>
                Link to the message
              </label>
              <input
                id={`${pickerId}-link`}
                className="input"
                placeholder="https://discord.com/channels/…"
                value={link}
                onChange={(event) => setLink(event.target.value)}
              />
              <p className="field-hint">
                In Discord, open the message&apos;s menu and choose Copy Message Link. Only a message TierZero sent can be
                replaced, and its reactions stay as they are.
              </p>
            </div>
            </>
          ) : (
            <div className="field">
              <label className="field-label" htmlFor={pickerId}>
                Channel
              </label>
              <ChannelPicker id={pickerId} guildId={guildId} hideTickets value={channelId} onChange={setChannelId} />
            </div>
          )}

          {mode === "later" ? (
            <div className="embed-grid">
              <div className="field">
                <label className="field-label" htmlFor={`${pickerId}-when`}>
                  When
                </label>
                <input
                  id={`${pickerId}-when`}
                  type="datetime-local"
                  className="input"
                  min={localInputValue(new Date())}
                  value={when}
                  onChange={(event) => setWhen(event.target.value)}
                />
                <p className="field-hint">In your own time zone.</p>
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`${pickerId}-repeat`}>
                  Repeat
                </label>
                <select id={`${pickerId}-repeat`} className="input" value={repeat} onChange={(event) => setRepeat(event.target.value as ScheduledSend["repeat"])}>
                  <option value="once">Just once</option>
                  <option value="daily">Every day</option>
                  <option value="weekly">Every week</option>
                </select>
                <p className="field-hint">The message is sent as it is now. Editing the template later does not change it.</p>
              </div>
            </div>
          ) : null}

          <MessagePreview message={message} context={{ ...context, variables }} />

          {mode === "replace" ? (
            <div className="send-option">
              <Switch checked={options.allowEveryone} onChange={(next) => setOptions({ ...options, allowEveryone: next })} aria-label="Let @everyone and @here ping" />
              <span>
                Let @everyone and @here ping
                <small>Off unless you turn it on for this change.</small>
              </span>
            </div>
          ) : (
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
          )}

          {result.kind === "error" ? (
            <p className="field-error" role="alert">
              {result.message}
            </p>
          ) : null}
          {result.kind === "sent" ? (
            <div className="msg-sent" role="status">
              <p>
                {result.edited ? "Replaced." : "Sent."}{" "}
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
          {result.kind === "scheduled" ? (
            <div className="msg-sent" role="status">
              <p>
                Scheduled for {new Date(result.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}. It is listed under
                Scheduled, where it can be cancelled.
              </p>
            </div>
          ) : null}
        </div>

        <div className="msg-dialog-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {done ? "Done" : "Cancel"}
          </button>
          {result.kind === "scheduled" ? null : (
            <button type="button" className="btn btn-primary" disabled={!ready || result.kind === "sending"} onClick={() => void confirm()}>
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
