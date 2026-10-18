"use client";

import { useCallback, useEffect, useState } from "react";
import { UNREACHABLE, readFailure } from "../../lib/bot-errors";
import { useConfirm } from "../ConfirmDialog";
import { ExternalLinkIcon, TrashIcon } from "../Icons";

/** One message the Message creator sent, as the bot lists it. */
export interface SentMessage {
  id: number;
  templateId: number | null;
  templateName: string | null;
  channelId: string;
  messageId: string;
  url: string;
  viaWebhook: boolean;
  sentAt: string;
}

export interface SentPage {
  sends: SentMessage[];
  total: number;
}

/** The newest sends of one template, or of the whole server when `templateId` is null. */
export async function fetchSends(guildId: string, templateId: number | null): Promise<{ ok: true; page: SentPage } | { ok: false; error: string }> {
  try {
    const path = templateId === null ? "sends" : `templates/${templateId}/sends`;
    const res = await fetch(`/api/guilds/${guildId}/messages/${path}`);
    if (!res.ok) return { ok: false, error: (await readFailure(res)).message };
    const body = (await res.json().catch(() => null)) as SentPage | null;
    return { ok: true, page: { sends: Array.isArray(body?.sends) ? body.sends : [], total: typeof body?.total === "number" ? body.total : 0 } };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

/** What a send is called in a list: where it went and when. */
export function sendLabel(entry: SentMessage, channelName: (id: string) => string | undefined): string {
  const where = channelName(entry.channelId);
  const when = new Date(entry.sentAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  return `${where ? `#${where}` : "A channel that no longer exists"} · ${when}`;
}

const SHOWN = 5;

interface Props {
  guildId: string;
  templateId: number;
  /** Bumped after a send, so the list reads again. */
  revision: number;
  channelName(id: string): string | undefined;
  onReplace(entry: SentMessage): void;
}

/**
 * Where a template has been sent, newest first. Each one links to the message
 * in Discord and can be replaced with the template as it is now. Removing an
 * entry only takes it off this list; the message stays in Discord.
 */
export function SentList({ guildId, templateId, revision, channelName, onReplace }: Props) {
  const [page, setPage] = useState<SentPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const result = await fetchSends(guildId, templateId);
    if (result.ok) {
      setPage(result.page);
      setError(null);
    } else setError(result.error);
  }, [guildId, templateId]);

  useEffect(() => {
    setAll(false);
    setPage(null);
    void load();
  }, [load, revision]);

  async function forget(entry: SentMessage) {
    const ok = await confirm.ask({
      title: "Take this message off the list?",
      text: "It stays in Discord, but can then only be replaced by pasting its link.",
      confirmLabel: "Take it off",
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/guilds/${guildId}/messages/sends/${entry.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        setError((await readFailure(res)).message);
        return;
      }
    } catch {
      setError(UNREACHABLE);
      return;
    }
    setPage((current) => (current ? { sends: current.sends.filter((item) => item.id !== entry.id), total: Math.max(0, current.total - 1) } : current));
  }

  const sends = page?.sends ?? [];
  const visible = all ? sends : sends.slice(0, SHOWN);

  return (
    <section className="card msg-sent-list" aria-labelledby={`msg-sent-${templateId}`}>
      <div className="card-header">
        <div className="card-header-text">
          <h2 className="card-title" id={`msg-sent-${templateId}`}>
            Sent
          </h2>
          <p className="card-help">
            Where this template went. Replace one to put the template as it is now in its place.
          </p>
        </div>
      </div>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {page === null && !error ? <p className="msg-empty">Loading…</p> : null}
      {page !== null && sends.length === 0 ? <p className="msg-empty">Not sent from here yet.</p> : null}
      {visible.length > 0 ? (
        <ul className="msg-sent-items">
          {visible.map((entry) => (
            <li key={entry.id} className="msg-sent-item">
              <span className="msg-sent-text">
                {sendLabel(entry, channelName)}
                {entry.viaWebhook ? <small>Sent under another name</small> : null}
              </span>
              <span className="msg-sent-tools">
                <a className="btn btn-ghost btn-sm" href={entry.url} target="_blank" rel="noreferrer">
                  <ExternalLinkIcon /> View
                </a>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onReplace(entry)}>
                  Replace…
                </button>
                <button type="button" className="icon-btn" aria-label="Take it off the list" onClick={() => void forget(entry)}>
                  <TrashIcon />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {page !== null && (sends.length > SHOWN || page.total > sends.length) ? (
        <p className="msg-sent-more">
          {!all && sends.length > SHOWN ? (
            <button type="button" className="link-button" onClick={() => setAll(true)}>
              Show all {sends.length}
            </button>
          ) : null}
          {page.total > sends.length ? <span> The newest {sends.length} of {page.total} are listed.</span> : null}
        </p>
      ) : null}
      {confirm.host}
    </section>
  );
}
