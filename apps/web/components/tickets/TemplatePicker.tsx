"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { MessageEmbed } from "@tier0/core";
import type { TicketDetailDto, TicketTemplateDto, TicketTemplatesDto } from "@tier0/shared-tickets";
import { filledTemplate, groupTemplates, insertTemplate, leftOutNote, matchTemplates, templateValues, type TemplateInsert } from "../../lib/ticket-templates";
import { embedProblems } from "../../lib/ticket-embeds";
import { ticketsClient } from "../../lib/tickets-client";
import { MessagePreview } from "../messages/MessagePreview";
import { SearchIcon } from "../Icons";

interface Props {
  guildId: string;
  ticket: Pick<TicketDetailDto, "id" | "number" | "typeName" | "channelId" | "channelName" | "opener">;
  viewerId: string;
  /** The embeds already in the reply, for the count and the allowance they leave. */
  current: readonly MessageEmbed[];
  onUse(insert: TemplateInsert): void;
  onCancel(): void;
}

type Load = { status: "loading" } | { status: "failed"; error: string } | { status: "ready"; data: TicketTemplatesDto };

/**
 * The "From saved messages" half of the embed dialog: the templates the
 * Message creator marks as available in tickets, searchable and grouped by
 * folder, with the one picked drawn as Discord will show it. Choosing one adds
 * its embeds to the reply, and its text too when asked.
 */
export function TemplatePicker({ guildId, ticket, viewerId, current, onUse, onCancel }: Props) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [withText, setWithText] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });
    void ticketsClient.templates(guildId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setLoad(result.ok ? { status: "ready", data: result.value } : { status: "failed", error: result.error });
    });
    return () => controller.abort();
  }, [guildId, attempt]);

  useEffect(() => {
    searchRef.current?.focus();
  }, [load.status]);

  const templates = load.status === "ready" ? load.data.templates : [];
  const matches = useMemo(() => matchTemplates(templates, query), [templates, query]);
  const groups = useMemo(() => groupTemplates(matches), [matches]);
  const picked = templates.find((template) => template.id === pickedId) ?? null;
  // A template with no embed is only its text, so the box starts ticked for it.
  const useText = withText ?? (picked !== null && picked.embeds.length === 0);

  const values = useMemo(
    () => (load.status === "ready" ? templateValues(ticket, viewerId, load.data.variables, new Date()) : {}),
    [load, ticket, viewerId],
  );
  const preview = useMemo(() => {
    if (!picked) return null;
    const filled = filledTemplate(picked, values);
    return { content: useText ? filled.content : "", embeds: filled.embeds, buttons: [], selects: [], reactions: [] };
  }, [picked, values, useText]);
  const previewContext = useMemo(() => ({ guildId, botName: "Your reply", variables: {} }), [guildId]);
  const note = picked ? leftOutNote(picked.leftOut) : null;

  function pick(template: TicketTemplateDto) {
    setPickedId(template.id);
    setWithText(null);
    setError(null);
  }

  function add() {
    if (!picked) return;
    const result = insertTemplate(picked, values, current, useText, embedProblems);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onUse(result.value);
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = matches[0];
      if (first) pick(first);
    }
  }

  return (
    <>
      <div className="msg-dialog-body msg-reply-body">
        <div className="tk-tpl-list">
          {load.status === "loading" ? (
            <p className="tk-saved-empty" role="status">
              <span className="spinner" aria-hidden="true" /> Loading saved messages
            </p>
          ) : null}
          {load.status === "failed" ? (
            <div className="callout callout-attention" role="alert">
              <div>
                <p>{load.error}</p>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAttempt((count) => count + 1)}>
                  Try again
                </button>
              </div>
            </div>
          ) : null}
          {load.status === "ready" && templates.length === 0 ? (
            <p className="tk-saved-empty">
              No saved message is available in tickets yet. In the Message creator, open a message and tick Available in tickets, then save it.
            </p>
          ) : null}
          {load.status === "ready" && templates.length > 0 ? (
            <>
              <div className="search">
                <SearchIcon />
                <input
                  ref={searchRef}
                  type="search"
                  className="input"
                  aria-label="Search saved messages"
                  aria-controls={listId}
                  placeholder="Search saved messages"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onSearchKey}
                />
              </div>
              {matches.length === 0 ? <p className="tk-saved-empty">No saved message matches that.</p> : null}
              <div id={listId} className="tk-tpl-groups">
                {groups.map((group) => (
                  <section key={group.folder ?? "none"} className="tk-tpl-group" aria-label={group.folder ?? "Not in a folder"}>
                    {group.folder !== null || groups.length > 1 ? <h3 className="tk-tpl-folder">{group.folder ?? "No folder"}</h3> : null}
                    <ul className="tk-tpl-items">
                      {group.templates.map((template) => (
                        <li key={template.id}>
                          <button type="button" className="tk-tpl-item" aria-pressed={template.id === pickedId} onClick={() => pick(template)}>
                            <span className="tk-tpl-name">{template.name}</span>
                            <span className="tk-tpl-meta">
                              {template.embeds.length === 0 ? "Text" : template.embeds.length === 1 ? "1 embed" : `${template.embeds.length} embeds`}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className="msg-side">
          <p className="cmd-section-title">Preview</p>
          {preview ? (
            <>
              <MessagePreview message={preview} context={previewContext} />
              {picked && picked.content.trim() !== "" ? (
                <label className="tk-tpl-text">
                  <input type="checkbox" checked={useText} onChange={(event) => setWithText(event.target.checked)} />
                  <span>Also use its text</span>
                </label>
              ) : null}
              {note ? <p className="field-hint">{note}</p> : null}
              {error ? (
                <p className="field-error" role="alert">
                  {error}
                </p>
              ) : null}
            </>
          ) : (
            <p className="field-hint">Pick a saved message to see how it will look in this ticket.</p>
          )}
        </div>
      </div>

      <div className="msg-dialog-foot">
        <span className="msg-dialog-foot-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!picked} onClick={add}>
            Add to reply
          </button>
        </span>
      </div>
    </>
  );
}
