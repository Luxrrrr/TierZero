"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { emptyEmbed, type MessageEmbed, type TicketDetailDto } from "@tier0/core";
import { embedProblems, embedsUsed, EMBED_BUDGET } from "../../lib/ticket-embeds";
import type { TemplateInsert } from "../../lib/ticket-templates";
import { ChoiceButtons } from "../form/ChoiceButtons";
import { EmbedEditor } from "../messages/EmbedEditor";
import { ToolBar, ToolsProvider } from "../messages/InsertBar";
import { MessagePreview } from "../messages/MessagePreview";
import { previewContextFor } from "../messages/MessageEditorDialog";
import { TemplatePicker } from "./TemplatePicker";

interface Props {
  guildId: string;
  /** The embed being changed, or null for a new one. */
  embed: MessageEmbed | null;
  /** The other embeds of the reply, for what is left of the character allowance. */
  others: readonly MessageEmbed[];
  onSave(embed: MessageEmbed): void;
  onClose(): void;
  /** Offers the Message creator's saved messages beside building one. Only for a new embed. */
  saved?: {
    ticket: Pick<TicketDetailDto, "id" | "number" | "typeName" | "channelId" | "channelName" | "opener">;
    viewerId: string;
    onUse(insert: TemplateInsert): void;
  };
}

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * One embed of a reply, built with the message builder's own editor and shown
 * as Discord will draw it. Nothing is added to the reply until Add embed is
 * pressed, and the buttons, menus and reactions a message could have are not
 * offered, since a reply cannot carry them.
 */
export function ReplyEmbedDialog({ guildId, embed, others, onSave, onClose, saved }: Props) {
  const [tab, setTab] = useState<"build" | "saved">("build");
  const offerSaved = saved !== undefined && embed === null;
  const [draft, setDraft] = useState<MessageEmbed>(embed ?? emptyEmbed());
  const titleId = useId();
  const tabsId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, []);

  const problems = useMemo(() => embedProblems(draft, others), [draft, others]);
  // Only what the person has typed is flagged, so a new embed does not open on a wall of errors.
  const untouched = JSON.stringify(draft) === JSON.stringify(emptyEmbed());
  const shown = untouched ? [] : problems;
  const used = embedsUsed(others) + embedsUsed([draft]);
  const previewContext = useMemo(() => previewContextFor(guildId, []), [guildId]);
  const preview = useMemo(() => ({ content: "", embeds: [draft], buttons: [], selects: [], reactions: [] }), [draft]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((node) => node.offsetParent !== null);
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    event.stopPropagation();
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div className="sheet-layer">
      <div className="sheet-scrim" aria-hidden="true" />
      <div ref={dialogRef} className="msg-dialog msg-dialog-wide" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="msg-dialog-head">
          <div>
            <h2 id={titleId} className="msg-dialog-title">
              {embed ? "Edit embed" : tab === "saved" ? "Add a saved message" : "Add an embed"}
            </h2>
            <p className="field-hint">
              {tab === "saved"
                ? "Messages from the Message creator that are marked available in tickets. Names and the ticket number are filled in for this ticket."
                : "Sent with your reply. Links and pictures must be web addresses, and Discord shows an embed from every part you fill in."}
            </p>
          </div>
          <button type="button" ref={closeRef} className="sheet-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        {offerSaved ? (
          <div className="tk-embed-tabs">
            <span id={tabsId} className="visually-hidden">
              Where the embed comes from
            </span>
            <ChoiceButtons
              variant="segmented"
              aria-labelledby={tabsId}
              value={tab}
              options={[
                { value: "build", label: "Build one" },
                { value: "saved", label: "From saved messages" },
              ]}
              onChange={(next) => setTab(next === "saved" ? "saved" : "build")}
            />
          </div>
        ) : null}

        {saved && offerSaved && tab === "saved" ? (
          <TemplatePicker guildId={guildId} ticket={saved.ticket} viewerId={saved.viewerId} current={others} onUse={saved.onUse} onCancel={onClose} />
        ) : (
          <>
            <div className="msg-dialog-body msg-reply-body">
              <div className="msg-form">
                <ToolsProvider>
                  <ToolBar guildId={guildId} variables={[]} />
                  <EmbedEditor
                    single
                    embed={draft}
                    path="embeds[0]"
                    variables={[]}
                    index={0}
                    total={1}
                    errors={shown}
                    defaultOpen
                    onChange={setDraft}
                    onRemove={onClose}
                    onMove={() => undefined}
                    onDuplicate={() => undefined}
                  />
                </ToolsProvider>
                {shown.length > 0 ? (
                  <div className="msg-problems" role="alert">
                    <p className="msg-problems-title">{shown.length === 1 ? "One thing to fix before this can be added" : `${shown.length} things to fix before this can be added`}</p>
                    <ul>
                      {shown.slice(0, 6).map((error, index) => (
                        <li key={index}>{error.message}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
              <div className="msg-side">
                <p className="cmd-section-title">Preview</p>
                <MessagePreview message={preview} context={{ ...previewContext, botName: "Your reply" }} />
                <p className="field-hint">
                  {used.toLocaleString()} of {EMBED_BUDGET.toLocaleString()} characters used by the embeds of this reply.
                </p>
              </div>
            </div>

            <div className="msg-dialog-foot">
              <span className="msg-dialog-foot-actions">
                <button type="button" className="btn btn-ghost" onClick={onClose}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" disabled={untouched || problems.length > 0} onClick={() => onSave({ ...draft, name: "" })}>
                  {embed ? "Save embed" : "Add embed"}
                </button>
              </span>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
